// /api/auth — POST login · DELETE logout (admin único, ARCHITECTURE §2.11).
// Rate limit en memoria (válido mientras haya UN proceso Node, §2.14): es
// ralentización, no muralla; la defensa real es PBKDF2 + sesión corta.
import type { APIContext } from 'astro';
import { sql } from '../../lib/db';
import { loginSchema } from '../../lib/validation';
import { createSession, hashToken, verifyPassword, SESSION_COOKIE, cookieOptions } from '../../lib/auth';

export const prerender = false;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;

const attempts = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(ip: string): boolean {
  const entry = attempts.get(ip);
  if (!entry) return false;
  if (entry.resetAt <= Date.now()) {
    attempts.delete(ip);
    return false;
  }
  return entry.count >= MAX_ATTEMPTS;
}

function registerFailedAttempt(ip: string): void {
  const entry = attempts.get(ip);
  if (!entry || entry.resetAt <= Date.now()) {
    attempts.set(ip, { count: 1, resetAt: Date.now() + WINDOW_MS });
    return;
  }
  entry.count += 1;
}

// PBKDF2 tarda; un SELECT vacío no. Verificar contra este hash dummy cuando
// el email no existe iguala el tiempo de respuesta y evita enumerar usuarios.
const DUMMY_HASH =
  'pbkdf2:210000:00000000000000000000000000000000:0000000000000000000000000000000000000000000000000000000000000000';

export async function POST(context: APIContext): Promise<Response> {
  const ip = context.clientAddress;
  if (isRateLimited(ip)) {
    return json({ error: 'too_many_attempts' }, 429);
  }

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: 'validation', issues: parsed.error.issues }, 400);
  }
  const { email, password } = parsed.data;

  const rows = await sql`SELECT id, password_hash FROM admin_users WHERE email = ${email}`;
  const row = rows[0];

  // MISMO mensaje exista o no el email (DECISIONES #2).
  const ok = await verifyPassword(password, row?.password_hash ?? DUMMY_HASH);
  if (!row || !ok) {
    registerFailedAttempt(ip);
    return json({ error: 'invalid_credentials' }, 401);
  }

  attempts.delete(ip);
  const token = await createSession(sql, Number(row.id));
  context.cookies.set(SESSION_COOKIE, token, cookieOptions);
  return json({ ok: true });
}

export async function DELETE(context: APIContext): Promise<Response> {
  // Logout idempotente: sin cookie también es un 200.
  const token = context.cookies.get(SESSION_COOKIE)?.value;
  if (token) {
    // Borrado REAL en BD: la sesión queda revocada aunque alguien hubiera
    // copiado la cookie.
    const tokenHash = await hashToken(token);
    await sql`DELETE FROM sessions WHERE token_hash = ${tokenHash}`;
  }
  // Mismo path que al setear, o el navegador no la borra.
  context.cookies.delete(SESSION_COOKIE, { path: '/' });
  return json({ ok: true });
}

export function ALL(): Response {
  return new Response(null, { status: 405, headers: { Allow: 'POST, DELETE' } });
}
