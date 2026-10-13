// /api/admin/users — gestión de cuentas del panel (sólo administradores):
// alta con rol, cambio de rol, activar/desactivar y cambio de contraseña.
// El historial de auditoría referencia user_id: las cuentas NUNCA se borran,
// se desactivan. Protección dura: no dejar la renta sin ningún admin activo.
import type { APIContext } from 'astro';
import { z } from 'zod';
import { sql } from '../../../lib/db';
import { requireAdminApi, hashPassword, type Role } from '../../../lib/auth';
import { logAudit } from '../../../lib/audit';

export const prerender = false;

const ROLES: Role[] = ['admin', 'desk', 'yard'];

const createUserSchema = z.object({
  email: z.string().email('Email no válido'),
  password: z.string().min(8, 'Mínimo 8 caracteres'),
  role: z.enum(['admin', 'desk', 'yard']),
});

const patchUserSchema = z
  .object({
    role: z.enum(['admin', 'desk', 'yard']).optional(),
    active: z.boolean().optional(),
    password: z.string().min(8, 'Mínimo 8 caracteres').optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'Nada que actualizar' });

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function activeAdmins(): Promise<number> {
  const rows = await sql`SELECT count(*)::int AS n FROM admin_users WHERE role = 'admin' AND active = true`;
  return Number(rows[0].n);
}

export async function GET(context: APIContext): Promise<Response> {
  const admin = await requireAdminApi(context.cookies, ['admin']);
  if (!admin) return json({ error: 'unauthorized' }, 401);
  const rows = await sql`
    SELECT id, email, role, active, created_at FROM admin_users ORDER BY created_at
  `;
  return json({
    users: rows.map((r) => ({ id: Number(r.id), email: r.email, role: r.role, active: r.active })),
  });
}

export async function POST(context: APIContext): Promise<Response> {
  const admin = await requireAdminApi(context.cookies, ['admin']);
  if (!admin) return json({ error: 'unauthorized' }, 401);

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }
  const parsed = createUserSchema.safeParse(body);
  if (!parsed.success) return json({ error: 'validation', issues: parsed.error.issues }, 400);
  const d = parsed.data;

  try {
    const passwordHash = await hashPassword(d.password);
    const rows = await sql`
      INSERT INTO admin_users (email, password_hash, role)
      VALUES (${d.email.toLowerCase()}, ${passwordHash}, ${d.role})
      RETURNING id, email, role, active
    `;
    await logAudit(sql, admin, {
      action: 'create',
      entity: 'user',
      entityId: Number(rows[0].id),
      summary: `Cuenta ${d.email} creada (rol ${d.role})`,
    }, context);
    return json({ user: rows[0] }, 201);
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      return json({ error: 'duplicate_email' }, 409);
    }
    console.error('POST /api/admin/users falló:', err);
    return json({ error: 'internal' }, 500);
  }
}

export async function PATCH(context: APIContext): Promise<Response> {
  const admin = await requireAdminApi(context.cookies, ['admin']);
  if (!admin) return json({ error: 'unauthorized' }, 401);

  const id = parseInt(context.url.searchParams.get('id') ?? '', 10);
  if (Number.isNaN(id)) return json({ error: 'invalid_id' }, 400);

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }
  const parsed = patchUserSchema.safeParse(body);
  if (!parsed.success) return json({ error: 'validation', issues: parsed.error.issues }, 400);
  const d = parsed.data;

  const existing = await sql`SELECT id, email, role, active FROM admin_users WHERE id = ${id}`;
  if (existing.length === 0) return json({ error: 'not_found' }, 404);
  const before = existing[0];

  // Nunca dejar el negocio sin administradores activos.
  const downgrade = (d.role !== undefined && d.role !== 'admin') || d.active === false;
  if (before.role === 'admin' && before.active === true && downgrade && (await activeAdmins()) <= 1) {
    return json({ error: 'last_admin', hint: 'No puedes dejar el panel sin administradores activos.' }, 409);
  }

  const columns: Record<string, unknown> = {};
  if (d.role !== undefined) columns.role = d.role;
  if (d.active !== undefined) columns.active = d.active;
  if (d.password !== undefined) columns.password_hash = await hashPassword(d.password);
  if (Object.keys(columns).length > 0) {
    await sql`UPDATE admin_users SET ${sql(columns)} WHERE id = ${id}`;
    // Contraseña cambiada ⇒ sesiones existentes quedan dudosas: se revocan.
    if (d.password !== undefined) {
      await sql`DELETE FROM sessions WHERE user_id = ${id}`;
    }
    // Cuenta desactivada ⇒ fuera de sesión de inmediato.
    if (d.active === false) {
      await sql`DELETE FROM sessions WHERE user_id = ${id}`;
    }
  }

  await logAudit(sql, admin, {
    action: 'update',
    entity: 'user',
    entityId: id,
    summary: `Cuenta ${before.email} actualizada${d.role !== undefined ? ` · rol ${before.role} → ${d.role}` : ''}${d.active !== undefined ? ` · ${d.active ? 'activada' : 'desactivada'}` : ''}${d.password !== undefined ? ' · contraseña reestablecida' : ''}`,
    diff: {
      ...(d.role !== undefined ? { role: { before: before.role, after: d.role } } : {}),
      ...(d.active !== undefined ? { active: { before: before.active, after: d.active } } : {}),
    },
  }, context);
  return json({ ok: true });
}

export function ALL(): Response {
  return new Response(null, { status: 405, headers: { Allow: 'GET, POST, PATCH' } });
}
