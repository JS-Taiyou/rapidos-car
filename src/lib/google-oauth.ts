// OAuth 2.0 con Google para el STAFF del panel (flujo Authorization Code).
// Por qué directo y no Firebase: ya hay sesiones propias con roles
// (lib/auth.ts) — el OAuth sólo resuelve "quién eres" (email verificado de
// Google) y crea la MISMA sesión de siempre. Cero duplicación de auth.
//
// Allowlist estricta: sólo entra quien ya tenga cuenta en admin_users
// (creada por un administrador con su rol). Nadie se auto-registra.
//
// Variables: GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET (Google Cloud Console
// → APIs & Services → Credentials → OAuth Client ID, tipo Web application;
// Authorized redirect URI: [ORIGEN]/api/auth/google/callback).
import { createRemoteJWKSet, jwtVerify } from 'jose';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

const jwks = createRemoteJWKSet(new URL(JWKS_URL));

export function googleOAuthConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

/** URL de consentimiento de Google con el state anti-CSRF ya incluido. */
export function buildAuthUrl(origin: string, state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: `${origin}/api/auth/google/callback`,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    // Google elige cuenta si hay varias sesiones; sin esto reusa la última.
    prompt: 'select_account',
  });
  return `${AUTH_URL}?${params.toString()}`;
}

export interface GoogleIdentity {
  email: string;
  name: string | null;
  picture: string | null;
}

/** Intercambia el code por tokens y VERIFICA el id_token contra las JWKS
 *  de Google (firma RS256 + emisor + audiencia + exp). Nunca se confía en
 *  el payload sin verificar. */
export async function exchangeCodeForIdentity(
  origin: string,
  code: string,
): Promise<GoogleIdentity | null> {
  const body = new URLSearchParams({
    code,
    client_id: process.env.GOOGLE_CLIENT_ID!,
    client_secret: process.env.GOOGLE_CLIENT_SECRET!,
    redirect_uri: `${origin}/api/auth/google/callback`,
    grant_type: 'authorization_code',
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) return null;
  const tokens = (await res.json()) as { id_token?: string };
  if (!tokens.id_token) return null;

  const { payload } = await jwtVerify(tokens.id_token, jwks, {
    issuer: ISSUERS,
    audience: process.env.GOOGLE_CLIENT_ID,
  });
  const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : null;
  if (!email || payload.email_verified !== true) return null;
  return {
    email,
    name: typeof payload.name === 'string' ? payload.name : null,
    picture: typeof payload.picture === 'string' ? payload.picture : null,
  };
}
