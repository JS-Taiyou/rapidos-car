// /api/admin/seasons/[id] — PATCH editar · DELETE borrar (Fase 6).
import type { APIContext } from 'astro';
import { z } from 'zod';
import { sql } from '../../../../lib/db';
import { requireAdminApi } from '../../../../lib/auth';
import { logAudit } from '../../../../lib/audit';

export const prerender = false;

const patchSchema = z
  .object({
    name: z.string().min(2).max(60).optional(),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    multiplier: z.number().min(0.5).max(3).optional(),
    priority: z.number().int().min(0).max(99).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'Nada que actualizar' })
  .refine((d) => !d.from || !d.to || d.to > d.from, { message: 'La fecha fin debe ser posterior al inicio' });

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function PATCH(context: APIContext): Promise<Response> {
  const admin = await requireAdminApi(context.cookies, ['admin', 'desk']);
  if (!admin) return json({ error: 'unauthorized' }, 401);
  const id = parseInt(context.params.id ?? '', 10);
  if (Number.isNaN(id)) return json({ error: 'invalid_id' }, 400);

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return json({ error: 'validation', issues: parsed.error.issues }, 400);
  const d = parsed.data;

  const existing = await sql`SELECT * FROM seasons WHERE id = ${id}`;
  if (existing.length === 0) return json({ error: 'not_found' }, 404);

  // El período se reconstruye completo: from/to nuevos con fallback a los
  // actuales (daterange no admite tocar un solo borde).
  const current = existing[0] as unknown as { name: string; period: string; multiplier: string; priority: number };
  const [, currentFrom, currentTo] = current.period.match(/\[([^,]+),([^\)]+)\)/) ?? [];
  const from = d.from ?? currentFrom;
  const to = d.to ?? currentTo;

  const rows = await sql`
    UPDATE seasons SET
      name = COALESCE(${d.name ?? null}, name),
      period = daterange(${from}::date, ${to}::date, '[)'),
      multiplier = COALESCE(${d.multiplier ?? null}, multiplier),
      priority = COALESCE(${d.priority ?? null}, priority)
    WHERE id = ${id}
    RETURNING *
  `;
  await logAudit(sql, admin, {
    action: 'update',
    entity: 'season',
    entityId: id,
    summary: `Temporada "${rows[0].name}" actualizada (${from} → ${to}, ×${rows[0].multiplier})`,
  }, context);
  return json({ season: rows[0] });
}

export async function DELETE(context: APIContext): Promise<Response> {
  const admin = await requireAdminApi(context.cookies, ['admin', 'desk']);
  if (!admin) return json({ error: 'unauthorized' }, 401);
  const id = parseInt(context.params.id ?? '', 10);
  if (Number.isNaN(id)) return json({ error: 'invalid_id' }, 400);

  const rows = await sql`DELETE FROM seasons WHERE id = ${id} RETURNING name`;
  if (rows.length === 0) return json({ error: 'not_found' }, 404);
  await logAudit(sql, admin, {
    action: 'delete',
    entity: 'season',
    entityId: id,
    summary: `Temporada "${rows[0].name}" eliminada`,
  }, context);
  return json({ ok: true });
}

export function ALL(): Response {
  return new Response(null, { status: 405, headers: { Allow: 'PATCH, DELETE' } });
}
