// GET /api/admin/handover-config — checklists de entrega/devolución
// configurados en settings (defaults del servidor si nadie los ha tocado).
// Lo consume HandoverBoard para pintar el checklist del patio.
import type { APIContext } from 'astro';
import { requireAdminApi } from '../../../lib/auth';
import { getHandoverChecklists } from '../../../lib/handover';

export const prerender = false;

export async function GET(context: APIContext): Promise<Response> {
  const admin = await requireAdminApi(context.cookies);
  if (!admin) return new Response(null, { status: 401 });
  return new Response(JSON.stringify({ checklists: await getHandoverChecklists() }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

export function ALL(): Response {
  return new Response(null, { status: 405, headers: { Allow: 'GET' } });
}
