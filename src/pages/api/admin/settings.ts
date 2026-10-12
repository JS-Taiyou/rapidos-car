// /api/admin/settings — GET valores de configuración · PATCH edición.
// Primer campo: whatsapp_staff_number (la cuenta que recibe confirmaciones
// de reservas vía wa.me). Vive en la tabla settings (runtime, sin rebuild);
// el placeholder del seed nunca debió requerir SQL para cambiarse.
import type { APIContext } from 'astro';
import { z } from 'zod';
import { sql } from '../../../lib/db';
import { requireAdminApi } from '../../../lib/auth';

export const prerender = false;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function loadSettings(): Promise<Record<string, unknown>> {
  const rows = await sql`SELECT key, value FROM settings`;
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export async function GET(context: APIContext): Promise<Response> {
  const admin = await requireAdminApi(context.cookies);
  if (!admin) return json({ error: 'unauthorized' }, 401);
  return json({ settings: await loadSettings() });
}

// Sólo los campos que el panel sabe editar (whitelist): capturar campos
// arbitrarios aquí sería un backdoor de configuración.
const settingsPatchSchema = z.object({
  whatsappStaffNumber: z
    .string()
    .regex(/^\d{10,15}$/, 'Formato wa.me: 10-15 dígitos con código de país, sin + ni espacios (ej. 5219991234567)'),
});

export async function PATCH(context: APIContext): Promise<Response> {
  const admin = await requireAdminApi(context.cookies);
  if (!admin) return json({ error: 'unauthorized' }, 401);

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const parsed = settingsPatchSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: 'validation', issues: parsed.error.issues }, 400);
  }

  await sql`
    INSERT INTO settings (key, value) VALUES ('whatsapp_staff_number', ${parsed.data.whatsappStaffNumber}::jsonb)
    ON CONFLICT (key) DO UPDATE SET value = ${parsed.data.whatsappStaffNumber}::jsonb
  `;
  return json({ settings: await loadSettings() });
}

export function ALL(): Response {
  return new Response(null, { status: 405, headers: { Allow: 'GET, PATCH' } });
}
