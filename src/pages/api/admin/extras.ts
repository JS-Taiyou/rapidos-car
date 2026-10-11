// GET /api/admin/extras — catálogo de extras (alimenta los selectores de la
// captura manual y el reprice). El precio que ve el staff es la BASE del
// catálogo; el precio final de cada reserva es editable y queda en pricing.
import type { APIContext } from 'astro';
import { sql } from '../../../lib/db';
import { requireAdminApi } from '../../../lib/auth';

export const prerender = false;

export async function GET(context: APIContext): Promise<Response> {
  const admin = await requireAdminApi(context.cookies);
  if (!admin) return new Response(null, { status: 401 });

  const rows = await sql`SELECT id, name, price_cents, per, active FROM extras ORDER BY id`;
  return new Response(
    JSON.stringify({
      extras: rows.map((r) => ({
        id: Number(r.id),
        name: r.name,
        priceCents: Number(r.price_cents),
        per: r.per,
        active: r.active,
      })),
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );
}

export function ALL(): Response {
  return new Response(null, { status: 405, headers: { Allow: 'GET' } });
}
