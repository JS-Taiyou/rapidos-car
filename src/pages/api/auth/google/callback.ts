// GET /api/auth/google/callback — cierra el flujo OAuth: valida el state,
// intercambia el code por el id_token VERIFICADO (JWKS de Google) y crea la
// MISMA sesión del panel (cookie rapidos_session). Allowlist: sólo entra
// quien ya tiene cuenta activa en admin_users con su rol — nadie se
// auto-registra. Todo intento queda en la auditoría.
import type { APIRoute } from 'astro';
import { sql } from '../../../../lib/db';
import { createSession, SESSION_COOKIE, cookieOptions, landingFor } from '../../../../lib/auth';
import { exchangeCodeForIdentity, googleOAuthConfigured } from '../../../../lib/google-oauth';
import { logAudit } from '../../../../lib/audit';

export const prerender = false;

export const GET: APIRoute = async ({ url, cookies, clientAddress }) => {
  if (!googleOAuthConfigured()) {
    return Response.redirect(new URL('/admin/login?e=oauth_off', url.origin), 302);
  }

  const back = (reason: string) => Response.redirect(new URL(`/admin/login?e=${reason}`, url.origin), 302);

  // State anti-CSRF: el de la cookie debe calzar con el que trae Google.
  const stateCookie = cookies.get('rpz_oauth_state')?.value;
  const stateParam = url.searchParams.get('state') ?? '';
  if (!stateCookie || !stateParam || stateCookie !== stateParam) {
    return back('oauth_state');
  }
  cookies.delete('rpz_oauth_state', { path: '/' });

  const code = url.searchParams.get('code');
  if (!code) return back('oauth_code');

  const identity = await exchangeCodeForIdentity(url.origin, code);
  if (!identity) return back('oauth_google');

  // Allowlist: la cuenta debe existir y estar activa (el admin la crea con
  // su rol en /admin/usuarios; el Google login sólo la desbloquea).
  const rows = (await sql`
    SELECT id, email, role, active FROM admin_users WHERE lower(email) = ${identity.email} LIMIT 1
  `) as unknown as Array<{ id: number; email: string; role: 'admin' | 'desk' | 'yard'; active: boolean }>;
  const account = rows[0];
  if (!account || !account.active) {
    await logAudit(sql, account ? { id: Number(account.id), email: account.email } : { id: 0, email: identity.email }, {
      action: 'login_failed',
      entity: 'session',
      summary: `Google OAuth rechazado: ${identity.email} no tiene cuenta activa en el panel`,
    }, { request: new Request(url.href) } as never);
    return back('oauth_not_invited');
  }

  const token = await createSession(sql, Number(account.id));
  cookies.set(SESSION_COOKIE, token, cookieOptions);
  await logAudit(sql, { id: Number(account.id), email: account.email }, {
    action: 'login',
    entity: 'session',
    summary: `Sesión iniciada con Google (${clientAddress})`,
  }, { request: new Request(url.href) } as never);
  return Response.redirect(new URL(landingFor(account.role), url.origin), 302);
};
