// /api/admin/points — CRUD de puntos de entrega/recogida (spec §4.5).
// Tarifa opcional (NULL = gratuito) y ubicación lat/lng para el mapa.
import type { APIContext } from 'astro';
import { z } from 'zod';
import { sql } from '../../../lib/db';
import { requireAdminApi } from '../../../lib/auth';
import { logAudit } from '../../../lib/audit';
import { invalidatePickupPointsCache, getPickupPoints } from '../../../lib/pickup-points';

export const prerender = false;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const latLng = z
  .object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })
  .nullable();

const pointSchema = z.object({
  key: z.string().min(2).max(40).regex(/^[a-z0-9-]+$/, 'Solo minúsculas, dígitos y guiones'),
  name: z.string().min(3).max(80),
  // NULL/omitido = gratuito.
  feeCents: z.number().int().min(0).nullable().optional(),
  location: latLng.optional(),
  active: z.boolean().optional(),
});

export async function GET(context: APIContext): Promise<Response> {
  const admin = await requireAdminApi(context.cookies);
  if (!admin) return json({ error: 'unauthorized' }, 401);
  return json({ points: await getPickupPoints(false) });
}

export async function POST(context: APIContext): Promise<Response> {
  const admin = await requireAdminApi(context.cookies);
  if (!admin) return json({ error: 'unauthorized' }, 401);

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }
  const parsed = pointSchema.safeParse(body);
  if (!parsed.success) return json({ error: 'validation', issues: parsed.error.issues }, 400);
  const d = parsed.data;

  try {
    const rows = await sql`
      INSERT INTO pickup_points (key, name, fee_cents, lat, lng, active)
      VALUES (${d.key}, ${d.name}, ${d.feeCents ?? null}, ${d.location?.lat ?? null}, ${d.location?.lng ?? null}, ${d.active ?? true})
      RETURNING *
    `;
    invalidatePickupPointsCache();
    await logAudit(sql, admin, {
      action: 'create',
      entity: 'point',
      entityId: Number(rows[0].id),
      summary: `Punto de entrega "${d.name}" (${d.key}) creado`,
    }, context);
    return json({ point: rows[0] }, 201);
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      return json({ error: 'duplicate_key', key: d.key }, 409);
    }
    console.error('POST /api/admin/points falló:', err);
    return json({ error: 'internal' }, 500);
  }
}

export function ALL(): Response {
  return new Response(null, { status: 405, headers: { Allow: 'GET, POST' } });
}
