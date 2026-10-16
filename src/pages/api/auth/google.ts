// GET /api/auth/google — arranca el flujo OAuth del staff: deja un state
// anti-CSRF en cookie corta httpOnly y redirige al consentimiento de
// Google. Sin credenciales configuradas, de vuelta al login con aviso.
import type { APIRoute } from 'astro';
import { buildAuthUrl, googleOAuthConfigured } from '../../../lib/google-oauth';

export const prerender = false;

export const GET: APIRoute = ({ cookies, url }) => {
  if (!googleOAuthConfigured()) {
    return Response.redirect(new URL('/admin/login?e=oauth_off', url.origin), 302);
  }
  const state = crypto.getRandomValues(new Uint8Array(24)).toString();
  cookies.set('rpz_oauth_state', state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: import.meta.env.PROD,
    path: '/',
    maxAge: 10 * 60,
  });
  return Response.redirect(buildAuthUrl(url.origin, state), 302);
};
