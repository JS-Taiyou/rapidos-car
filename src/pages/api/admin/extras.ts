// /api/admin/extras — catálogo de extras (Fase 6: ahora con escritura).
// GET lista · POST crea · PATCH edita (?id=) · DELETE borra (?id=). El
// precio que ve el staff es la BASE del catálogo; el precio final de cada
// reserva es editable y queda en el snapshot pricing.
import type { APIContext } from 'astro';
import { z } from 'zod';
import { sql } from '../../../lib/db';
import { requireAdminApi } from '../../../lib/auth';
import { logAudit } from '../../../lib/audit';

export const prerender = false;

const extraSchema = z.object({
  name: z.string().min(2).max(60),
  priceCents: z.number().int().min(0),
  per: z.enum(['day', 'rental']),
  active: z.boolean().default(true),
});
const extraPatchSchema = z.object({
  name: z.string().min(2).max(60).optional(),
  priceCents: z.number().int().min(0).optional(),
  per: z.enum(['day', 'rental']).optional(),
  active: z.boolean().optional(),
});

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function GET(context: APIContext): Promise<Response> {
  const admin = await requireAdminApi(context.cookies);
  if (!admin) return json({ error: 'unauthorized' }, 401);

  const rows = await sql`SELECT id, name, price_cents, per, active FROM extras ORDER BY id`;
  return json({
    extras: rows.map((r) => ({
      id: Number(r.id),
      name: r.name,
      priceCents: Number(r.price_cents),
      per: r.per,
      active: r.active,
    })),
  });
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
  const parsed = extraSchema.safeParse(body);
  if (!parsed.success) return json({ error: 'validation', issues: parsed.error.issues }, 400);
  const d = parsed.data;

  try {
    const rows = await sql`
      INSERT INTO extras (name, price_cents, per, active)
      VALUES (${d.name}, ${d.priceCents}, ${d.per}, ${d.active})
      RETURNING id
    `;
    await logAudit(sql, admin, {
      action: 'create',
      entity: 'extra',
      entityId: Number(rows[0].id),
      summary: `Extra "${d.name}" creado (${(d.priceCents / 100).toFixed(2)} / ${d.per === 'day' ? 'día' : 'renta'})`,
    }, context);
    return json({ ok: true }, 201);
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      return json({ error: 'duplicate_name' }, 409);
    }
    console.error('POST /api/admin/extras falló:', err);
    return json({ error: 'internal' }, 500);
  }
}

export async function PATCH(context: APIContext): Promise<Response> {
  const admin = await requireAdminApi(context.cookies);
  if (!admin) return json({ error: 'unauthorized' }, 401);
  const id = parseInt(context.url.searchParams.get('id') ?? '', 10);
  if (Number.isNaN(id)) return json({ error: 'invalid_id' }, 400);

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }
  const parsed = extraPatchSchema.safeParse(body);
  if (!parsed.success) return json({ error: 'validation', issues: parsed.error.issues }, 400);
  const d = parsed.data;
  if (Object.keys(d).length === 0) return json({ error: 'nothing_to_update' }, 400);

  const rows = await sql`
    UPDATE extras SET
      name = COALESCE(${d.name ?? null}, name),
      price_cents = COALESCE(${d.priceCents ?? null}, price_cents),
      per = COALESCE(${d.per ?? null}, per),
      active = COALESCE(${d.active ?? null}, active)
    WHERE id = ${id}
    RETURNING *
  `;
  if (rows.length === 0) return json({ error: 'not_found' }, 404);
  await logAudit(sql, admin, {
    action: 'update',
    entity: 'extra',
    entityId: id,
    summary: `Extra "${rows[0].name}" actualizado`,
    diff: Object.fromEntries(Object.entries(d).map(([k, v]) => [k, { after: v }])),
  }, context);
  return json({ extra: rows[0] });
}

export async function DELETE(context: APIContext): Promise<Response> {
  const admin = await requireAdminApi(context.cookies);
  if (!admin) return json({ error: 'unauthorized' }, 401);
  const id = parseInt(context.url.searchParams.get('id') ?? '', 10);
  if (Number.isNaN(id)) return json({ error: 'invalid_id' }, 400);

  const rows = await sql`DELETE FROM extras WHERE id = ${id} RETURNING name`;
  if (rows.length === 0) return json({ error: 'not_found' }, 404);
  await logAudit(sql, admin, {
    action: 'delete',
    entity: 'extra',
    entityId: id,
    summary: `Extra "${rows[0].name}" eliminado`,
  }, context);
  return json({ ok: true });
}

export function ALL(): Response {
  return new Response(null, { status: 405, headers: { Allow: 'GET, POST, PATCH, DELETE' } });
}
