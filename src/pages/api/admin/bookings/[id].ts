// /api/admin/bookings/[id] — PATCH transiciones del pipeline (spec §4.3).
// La máquina de estados vive en el SERVIDOR como datos explícitos; la isla
// muestra botones, pero quien PERMITE la transición es el servidor (§2.9).
import type { APIContext } from 'astro';
import { sql } from '../../../../lib/db';
import { requireAdminApi } from '../../../../lib/auth';
import { bookingPatchSchema } from '../../../../lib/validation';

export const prerender = false;

// "De confirmada puedo entregar (active) o cancelar; de activa solo
// completar; los estados terminales no se mueven."
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  quoted: ['confirmed', 'cancelled'],
  confirmed: ['active', 'cancelled'],
  active: ['completed'],
  completed: [],
  cancelled: [],
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function PATCH(context: APIContext): Promise<Response> {
  const admin = await requireAdminApi(context.cookies);
  if (!admin) return json({ error: 'unauthorized' }, 401);

  const id = parseInt(context.params.id ?? '', 10);
  if (Number.isNaN(id)) return json({ error: 'invalid_id' }, 400);

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const parsed = bookingPatchSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: 'validation', issues: parsed.error.issues }, 400);
  }
  const { status: to, notes } = parsed.data;

  const rows = await sql`SELECT status FROM bookings WHERE id = ${id}`;
  if (rows.length === 0) return json({ error: 'not_found' }, 404);

  const from = rows[0].status as string;
  if (!ALLOWED_TRANSITIONS[from]?.includes(to)) {
    return json({ error: 'invalid_transition', from, to }, 409);
  }

  // Cancelar NO requiere "liberar" nada a mano: la constraint y las queries
  // de disponibilidad filtran por status; al pasar a 'cancelled' la unidad
  // queda libre sola. El inventario es una proyección del estado.
  const updated = await sql`
    UPDATE bookings
    SET status = ${to}, notes = COALESCE(${notes ?? null}, notes)
    WHERE id = ${id}
    RETURNING *
  `;

  return json({ booking: updated[0] });
}

export function ALL(): Response {
  return new Response(null, { status: 405, headers: { Allow: 'PATCH' } });
}
