// /api/admin/seasons — CRUD de temporadas del motor de precios (Fase 6).
// period daterange [from, to); multiplier 0.5–3; priority desempata solapes
// (mayor gana). Solapar NO se bloquea (negocio real) pero se advierte en la
// UI; el motor ya tiene la regla.
import type { APIContext } from 'astro';
import { z } from 'zod';
import { sql } from '../../../lib/db';
import { requireAdminApi } from '../../../lib/auth';
import { logAudit } from '../../../lib/audit';

export const prerender = false;

const seasonSchema = z
  .object({
    name: z.string().min(2).max(60),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    multiplier: z.number().min(0.5).max(3),
    priority: z.number().int().min(0).max(99).default(0),
  })
  .refine((d) => d.to > d.from, { message: 'La fecha fin debe ser posterior al inicio' });

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function GET(context: APIContext): Promise<Response> {
  const admin = await requireAdminApi(context.cookies, ['admin', 'desk']);
  if (!admin) return json({ error: 'unauthorized' }, 401);
  const rows = await sql`
    SELECT id, name, period, multiplier, priority,
           lower(period) AS from_date, upper(period) AS to_date
    FROM seasons ORDER BY lower(period)
  `;
  return json({ seasons: rows });
}

export async function POST(context: APIContext): Promise<Response> {
  const admin = await requireAdminApi(context.cookies, ['admin', 'desk']);
  if (!admin) return json({ error: 'unauthorized' }, 401);

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }
  const parsed = seasonSchema.safeParse(body);
  if (!parsed.success) return json({ error: 'validation', issues: parsed.error.issues }, 400);
  const d = parsed.data;

  try {
    const rows = await sql`
      INSERT INTO seasons (name, period, multiplier, priority)
      VALUES (${d.name}, daterange(${d.from}::date, ${d.to}::date, '[)'), ${d.multiplier}, ${d.priority})
      RETURNING *
    `;
    await logAudit(sql, admin, {
      action: 'create',
      entity: 'season',
      entityId: Number(rows[0].id),
      summary: `Temporada "${d.name}" creada (${d.from} → ${d.to}, ×${d.multiplier})`,
    }, context);
    return json({ season: rows[0] }, 201);
  } catch (err) {
    console.error('POST /api/admin/seasons falló:', err);
    return json({ error: 'internal' }, 500);
  }
}

export function ALL(): Response {
  return new Response(null, { status: 405, headers: { Allow: 'GET, POST' } });
}
