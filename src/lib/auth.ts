// Sesiones de admin con PBKDF2 + Web Crypto (ARCHITECTURE §2.11). Cookie
// httpOnly con token aleatorio; en sessions solo vive su SHA-256 y su
// expiración. Passwords en formato 'pbkdf2:210000:<saltHex>:<hashHex>'.
//
// ESTRUCTURA: las funciones cripto NO importan nada de Astro ni de db — son
// portables. requireAdmin/requireAdminApi son la ÚNICA sección que conoce
// Astro. scripts/seed.ts DUPLICA hashPassword deliberadamente: si cambias
// iteraciones, formato o algoritmo aquí, actualiza esa copia en el mismo
// commit.
import type { AstroGlobal, AstroCookies } from 'astro';
import { sql } from './db';
import type { Sql } from './db';

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return bytesToHex(new Uint8Array(digest));
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 210_000 },
    keyMaterial,
    256,
  );
  return `pbkdf2:210000:${bytesToHex(salt)}:${bytesToHex(new Uint8Array(bits))}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split(':');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iterations = Number(parts[1]);
  const saltHex = parts[2];
  const hashHex = parts[3];
  const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map((h) => parseInt(h, 16)));
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  // Iteraciones LEÍDAS del string: si mañana sube el costo, los hashes
  // viejos siguen verificando.
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    keyMaterial,
    256,
  );
  const a = new Uint8Array(bits);
  const b = new Uint8Array(hashHex.match(/.{2}/g)!.map((h) => parseInt(h, 16)));
  if (a.length !== b.length) return false;
  // Comparación en tiempo constante: === sale en el primer byte distinto y
  // ese tiempo filtra cuántos bytes acertaste (timing attack).
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function createSession(sqlClient: Sql, userId: number): Promise<string> {
  // 256 bits de aleatoría criptográfica; NUNCA Math.random.
  const token = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
  const tokenHash = await sha256Hex(token);
  await sqlClient`
    INSERT INTO sessions (token_hash, user_id, expires_at)
    VALUES (${tokenHash}, ${userId}, now() + interval '7 days')
  `;
  return token;
}

export type Role = 'admin' | 'desk' | 'yard';

export interface SessionUser {
  id: number;
  email: string;
  role: Role;
}

export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Administrador',
  desk: 'Recepción',
  yard: 'Patio',
};

// Landing de cada rol: tras el login y en redirects por permisos.
export function landingFor(role: Role): string {
  return role === 'yard' ? '/admin/entregas' : '/admin';
}

export async function getSessionUser(
  sqlClient: Sql,
  token: string,
): Promise<SessionUser | null> {
  const tokenHash = await sha256Hex(token);
  const rows = await sqlClient`
    SELECT u.id, u.email, u.role, u.active
    FROM sessions s
    JOIN admin_users u ON u.id = s.user_id
    WHERE s.token_hash = ${tokenHash} AND s.expires_at > now()
  `;
  // Limpieza perezosa: no hay cron en el MVP; cada validación barre las
  // sesiones vencidas gratis.
  await sqlClient`DELETE FROM sessions WHERE expires_at <= now()`;
  const row = rows[0];
  if (!row || row.active !== true) return null;
  return { id: Number(row.id), email: row.email as string, role: row.role as Role };
}

// Hash público del token: /api/auth (DELETE logout) lo reutiliza para borrar
// la sesión en BD sin reimplementar el SHA-256.
export async function hashToken(token: string): Promise<string> {
  return sha256Hex(token);
}

// Nombre de cookie neutro al tenant (renombrar tumba sesiones activas).
export const SESSION_COOKIE = 'rapidos_session';

export const cookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  // HTTPS solo en producción: en dev (http://localhost) secure=true haría la
  // cookie invisible y el login "no jalaría".
  secure: import.meta.env.PROD,
  path: '/',
  maxAge: 7 * 24 * 60 * 60,
} as const;

// Guardia para FRONTMATTER de páginas /admin/* (§2.3: por página, sin
// middleware). Uso: `const user = await requireAdmin(Astro);
// if (user instanceof Response) return user;`
export async function requireAdmin(
  Astro: AstroGlobal,
  allowedRoles?: Array<Role>,
): Promise<SessionUser | Response> {
  const token = Astro.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return Astro.redirect('/admin/login');
  const user = await getSessionUser(sql, token);
  if (!user) {
    Astro.cookies.delete(SESSION_COOKIE, { path: '/' });
    return Astro.redirect('/admin/login');
  }
  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return Astro.redirect(landingFor(user.role));
  }
  return user;
}

// Variante para ENDPOINTS /api/admin/*: null en vez de redirect (un redirect
// en un fetch JSON es un bug de UX — el cliente recibiría HTML de login).
export async function requireAdminApi(
  cookies: AstroCookies,
  allowedRoles?: Array<Role>,
): Promise<SessionUser | null> {
  const token = cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const user = await getSessionUser(sql, token);
  if (!user) return null;
  if (allowedRoles && !allowedRoles.includes(user.role)) return null;
  return user;
}
