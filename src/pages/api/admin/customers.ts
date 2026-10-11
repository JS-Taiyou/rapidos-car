// GET /api/admin/customers — lista del CRM con búsqueda unificada
// (nombre, CURP, email o teléfono) y conteo de rentas.
import type { APIContext } from 'astro';
import { sql } from '../../../lib/db';
import { requireAdminApi } from '../../../lib/auth';

export const prerender = false;

export async function GET(context: APIContext): Promise<Response> {
  const admin = await requireAdminApi(context.cookies);
  if (!admin) return new Response(null, { status: 401 });

  const q = (context.url.searchParams.get('q') ?? '').trim();
  const like = `%${q}%`;
  const rows = await sql`
    SELECT c.id, c.curp, c.full_name, c.email, c.phone, c.no_show,
           COUNT(b.id) FILTER (WHERE b.kind = 'rental')::int AS rentals
    FROM customers c
    LEFT JOIN bookings b ON b.customer_id = c.id
    WHERE ${q === ''}::boolean
       OR c.full_name ILIKE ${like}
       OR c.curp ILIKE ${like}
       OR c.email ILIKE ${like}
       OR c.phone ILIKE ${like}
    GROUP BY c.id
    ORDER BY c.created_at DESC
    LIMIT 100
  `;
  return new Response(JSON.stringify({ customers: rows }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

export function ALL(): Response {
  return new Response(null, { status: 405, headers: { Allow: 'GET' } });
}
