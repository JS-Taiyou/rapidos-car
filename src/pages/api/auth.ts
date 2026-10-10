// ============================================================================
// API: /api/auth — POST login · DELETE logout (admin único)
// ============================================================================
// PROPÓSITO
// Emitir y revocar la sesión del dueño. Cookie httpOnly 'rapidoz_session' cuyo
// valor es un token aleatorio; en la tabla sessions solo vive su hash y su
// expiración (ARCHITECTURE §2.11).
//
// ----------------------------------------------------------------------------
// DECISIONES
// ----------------------------------------------------------------------------
// * Rate limit en memoria: Map<ip, { count, resetAt }>, máx 5 intentos por 10
//   min por IP. Suficiente para UN admin que escribe bien su password.
//   NOTA DE ALCANCE: con el servidor Node de un solo proceso (ARCHITECTURE
//   §2.14) el Map SÍ es compartido entre todos los requests; la limitación
//   aparece solo si escala a N réplicas (cada una tendría su Map → límite
//   real ~5 × réplicas). La defensa real es password fuerte + PBKDF2 con
//   suficientes iteraciones + sesiones cortas (7 días); este Map es
//   ralentización, no muralla. Si escala, tabla login_attempts.
// * 401 con el MISMO mensaje exista o no el email: respuestas (o tiempos)
//   distintos permitirían enumerar usuarios válidos por fuerza bruta.
// * Cookie vía context.cookies.set de Astro (no Set-Cookie a mano): serializa
//   bien los flags y funciona igual en dev y en el adapter Node.
//
// ----------------------------------------------------------------------------
// PASOS
// ----------------------------------------------------------------------------
// 1. export const prerender = false (COMENTADO hasta instalar el adapter —
//    ARCHITECTURE §6).
// 2. Imports (comentados): type APIContext de 'astro'; sql de '../../lib/db';
//    loginSchema de '../../lib/validation'; verifyPassword y createSession de
//    '../../lib/auth'. Mismo helper json(data, status) de quote.ts.
// 3. A nivel módulo: const attempts = new Map<string, { count: number,
//    resetAt: number }>() y un helper isRateLimited(ip): purga entradas con
//    resetAt vencido y devuelve true si count >= 5 dentro de la ventana de 10
//    min. Helper aparte registerFailedAttempt(ip) que incrementa o crea.
// 4. export async function POST(context: APIContext):
//    a. const ip = context.clientAddress → if (isRateLimited(ip)) 429
//       { error: 'too_many_attempts' }.
//    b. request.json() en try/catch → 400 invalid_json; loginSchema.safeParse
//       → 400 { error: 'validation', issues } (§2.12).
//    c. SELECT id, password_hash FROM admin_users WHERE email = ${email}.
//    d. Si no hay fila O !await verifyPassword(password, row.password_hash):
//       registerFailedAttempt(ip) y 401 { error: 'invalid_credentials' } —
//       MISMO mensaje en ambos casos (DECISIONES #2). OJO: ejecuta
//       verifyPassword TAMBIÉN cuando el email no exista, contra un hash dummy
//       guardado en una constante del módulo, para no filtrar la existencia
//       del email por el tiempo de respuesta (PBKDF2 tarda; un SELECT vacío,
//       no).
//    e. Éxito: attempts.delete(ip); const token = await createSession(sql,
//       user.id) — genera el token aleatorio, guarda su SHA-256 en sessions
//       con expires_at = now() + 7 días y devuelve el token PLANO (solo en
//       este instante se conoce; la BD nunca lo ve).
//    f. context.cookies.set('rapidoz_session', token, { httpOnly: true,
//       sameSite: 'lax', secure: import.meta.env.PROD, path: '/',
//       maxAge: 7 * 24 * 60 * 60 }) — secure SOLO en prod: en localhost (http)
//       una cookie secure nunca se guarda y el login "no funciona".
//    g. 200 { ok: true }.
// 5. export async function DELETE(context: APIContext):
//    a. const token = context.cookies.get('rapidoz_session')?.value → si no hay,
//       responde 200 { ok: true } igualmente (logout idempotente).
//    b. DELETE FROM sessions WHERE token_hash = <sha256 hex del token> —
//       borrado real en BD: la sesión queda revocada aunque alguien hubiera
//       copiado la cookie (revocabilidad, ARCHITECTURE §2.11). Reutiliza el
//       helper de hashing de auth.ts, no reimplementes el SHA-256 aquí.
//    c. context.cookies.delete('rapidoz_session', { path: '/' }) — mismo path
//       que al setear, o el navegador no la borra.
//    d. 200 { ok: true }.
// 6. export function ALL(): 405 con header Allow: POST, DELETE.
//
// ----------------------------------------------------------------------------
// CONTRATO
// ----------------------------------------------------------------------------
// POST /api/auth  { email, password }
//   → 200 { ok: true } + Set-Cookie rapidoz_session
//   → 400 invalid_json / validation · 401 { error: 'invalid_credentials' } ·
//     429 { error: 'too_many_attempts' }
// DELETE /api/auth → 200 { ok: true } (siempre, haya sesión o no)
//
// ----------------------------------------------------------------------------
// ERRORES COMUNES
// ----------------------------------------------------------------------------
// - Olvidar que el rate limit es POR PROCESO (con N réplicas hay N Maps): ya
//   documentado en DECISIONES — no lo vendas como defensa fuerte.
// - secure: true en dev → la cookie no se guarda en http://localhost.
// - Comparar passwords con === : siempre verifyPassword (comparación
//   timing-safe sobre el PBKDF2).
// - Borrar solo la cookie en logout sin borrar la sesión en BD: la sesión sigue
//   viva para quien copió el token; el punto de sesiones en BD es revocar.
// ============================================================================
