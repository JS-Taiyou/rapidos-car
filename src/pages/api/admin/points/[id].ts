// /api/admin/points/[id] — PATCH edición · DELETE borrado (los puntos son
// catálogo: física está bien porque NO hay FK desde bookings — la reserva
// guarda el key como snapshot; borrar un punto no rompe historial).
import type { APIContext } from 'astro';
import { z } from 'zod';
import { sql } from '../../../../lib/db';
import { requireAdminApi } from '../../../../lib/auth';
import { logAudit } from '../../../../lib/audit';
import { invalidatePickupPointsCache } from '../../../../lib/pickup-points';

export const prerender = false;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const pointPatchSchema = z.object({
  name: z.string().min(3).max(80).optional(),
  feeCents: z.number().int().min(0).nullable().optional(),
  location: z
    .object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })
    .nullable()
    .optional(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
});

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
  const parsed = pointPatchSchema.safeParse(body);
  if (!parsed.success) return json({ error: 'validation', issues: parsed.error.issues }, 400);
  const d = parsed.data;

  const columns: Record<string, unknown> = {};
  if (d.name !== undefined) columns.name = d.name;
  if (d.feeCents !== undefined) columns.fee_cents = d.feeCents;
  if (d.location !== undefined) {
    columns.lat = d.location?.lat ?? null;
    columns.lng = d.location?.lng ?? null;
  }
  if (d.active !== undefined) columns.active = d.active;
  if (d.sortOrder !== undefined) columns.sort_order = d.sortOrder;

  if (Object.keys(columns).length === 0) return json({ error: 'nothing_to_update' }, 400);

  const rows = await sql`UPDATE pickup_points SET ${sql(columns)} WHERE id = ${id} RETURNING *`;
  if (rows.length === 0) return json({ error: 'not_found' }, 404);
  invalidatePickupPointsCache();
  await logAudit(sql, admin, {
    action: 'update',
    entity: 'point',
    entityId: id,
    summary: `Punto "${rows[0].name}" actualizado (${Object.keys(columns).join(', ')})`,
    diff: Object.fromEntries(Object.entries(columns).map(([k, v]) => [k, { after: v }])),
  }, context);
  return json({ point: rows[0] });
}

export async function DELETE(context: APIContext): Promise<Response> {
  const admin = await requireAdminApi(context.cookies, ['admin', 'desk']);
  if (!admin) return json({ error: 'unauthorized' }, 401);

  const id = parseInt(context.params.id ?? '', 10);
  if (Number.isNaN(id)) return json({ error: 'invalid_id' }, 400);

  const rows = await sql`DELETE FROM pickup_points WHERE id = ${id} RETURNING key`;
  if (rows.length === 0) return json({ error: 'not_found' }, 404);
  invalidatePickupPointsCache();
  await logAudit(sql, admin, {
    action: 'delete',
    entity: 'point',
    entityId: id,
    summary: `Punto de entrega "${rows[0].key}" eliminado`,
  }, context);
  return json({ ok: true });
}

export function ALL(): Response {
  return new Response(null, { status: 405, headers: { Allow: 'PATCH, DELETE' } });
}
