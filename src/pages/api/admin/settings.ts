// /api/admin/settings — GET perfil del tenant · PATCH edición (spec §4.5).
// Claves tenant.* en la tabla settings (runtime, sin rebuild); el cache de
// tenant.ts se invalida al guardar. Whitelist estricta de campos.
import type { APIContext } from 'astro';
import { z } from 'zod';
import { sql } from '../../../lib/db';
import { requireAdminApi } from '../../../lib/auth';
import { invalidateTenantCache, getTenant } from '../../../lib/tenant';
import { getHandoverChecklists } from '../../../lib/handover';
import { logAudit } from '../../../lib/audit';

export const prerender = false;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const waDigits = z.string().regex(/^\d{10,15}$/, 'Formato wa.me: 10-15 dígitos con código de país (ej. 5219991234567)');
const logoSchema = z.object({
  type: z.enum(['icon', 'image']),
  icon: z.string().min(2).max(30).default('bolt'),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Color hex (ej. #0e7490)').default('#0e7490'),
  url: z.string().min(1).optional(),
});

// Checklists de entrega/devolución editables en Ajustes (Fase 3).
const checklistItem = z.object({
  id: z.string().min(1).max(40),
  label: z.string().min(2).max(120),
  defaultChecked: z.boolean(),
});
const checklistsSchema = z.object({
  out: z.array(checklistItem).min(1).max(20),
  in: z.array(checklistItem).min(1).max(20),
});

const settingsPatchSchema = z.object({
  name: z.string().min(2).max(60).optional(),
  email: z.string().email().nullable().optional(),
  address: z.string().min(4).nullable().optional(),
  phones: z.array(z.string().min(6).max(24)).max(5).optional(),
  // Vacío = ocultar botones públicos de WhatsApp explícitamente.
  publicWhatsapp: waDigits.nullable().or(z.literal('')).optional(),
  staffWhatsapp: waDigits.optional(),
  // https://m.me/<pagina>; vacío = ocultar.
  messengerUrl: z.string().regex(/^https:\/\/(m\.me|www\.messenger\.com)\/[A-Za-z0-9.\-_]+$/, 'URL de m.me (ej. https://m.me/mipagina)').nullable().or(z.literal('')).optional(),
  logo: logoSchema.optional(),
  checklists: checklistsSchema.optional(),
});

export async function GET(context: APIContext): Promise<Response> {
  const admin = await requireAdminApi(context.cookies);
  if (!admin) return json({ error: 'unauthorized' }, 401);
  return json({ tenant: await getTenant(), checklists: await getHandoverChecklists() });
}

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
  const d = parsed.data;

  // Upsert clave → valor jsonb (los null se guardan como string vacío, que
  // significa "configurado en vacío", distinto de "nunca configurado").
  // valores construidos por nosotros: cast directo a jsonb
  const upsert = async (key: string, value: unknown) => {
    const v = JSON.parse(JSON.stringify(value ?? '')) as string;
    await sql`
      INSERT INTO settings (key, value) VALUES (${key}, ${v}::jsonb)
      ON CONFLICT (key) DO UPDATE SET value = ${v}::jsonb
    `;
  };

  try {
    if (d.name !== undefined) await upsert('tenant.name', d.name);
    if (d.email !== undefined) await upsert('tenant.email', d.email ?? '');
    if (d.address !== undefined) await upsert('tenant.address', d.address ?? '');
    if (d.phones !== undefined) await upsert('tenant.phones', d.phones);
    if (d.publicWhatsapp !== undefined) await upsert('tenant.whatsapp', d.publicWhatsapp ?? '');
    if (d.staffWhatsapp !== undefined) await upsert('tenant.staff_whatsapp', d.staffWhatsapp);
    if (d.messengerUrl !== undefined) await upsert('tenant.messenger', d.messengerUrl ?? '');
    if (d.logo !== undefined) await upsert('tenant.logo', d.logo);
    if (d.checklists !== undefined) await upsert('handover_checklists', d.checklists);
  } catch (err) {
    console.error('PATCH /api/admin/settings falló:', err);
    return json({ error: 'internal' }, 500);
  }

  invalidateTenantCache();
  await logAudit(sql, admin, {
    action: 'settings',
    entity: 'setting',
    summary: `Ajustes del tenant actualizados (${Object.keys(d).join(', ')})`,
    diff: Object.fromEntries(Object.entries(d).map(([k, v]) => [k, { after: v ?? null }])),
  }, context);
  return json({ tenant: await getTenant() });
}

export function ALL(): Response {
  return new Response(null, { status: 405, headers: { Allow: 'GET, PATCH' } });
}
