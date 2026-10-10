// ============================================================================
// LIB: auth — sesiones de admin con PBKDF2 + Web Crypto (ARCHITECTURE §2.11)
// ============================================================================
// Propósito: login del dueño y guardia de todo /admin/*. Cookie httpOnly con
// token aleatorio; en la tabla sessions se guarda el SHA-256 del token (no el
// token) y su expiración. Passwords con PBKDF2 en formato
// 'pbkdf2:210000:<saltHex>:<hashHex>'.
//
// ----------------------------------------------------------------------------
// DECISIONES
// ----------------------------------------------------------------------------
// * Web Crypto (crypto.subtle) y NO bcrypt/argon2: cero dependencias cripto,
//   disponible nativo en Node 22 como globalThis.crypto (ARCHITECTURE
//   §2.11). PBKDF2 con 210_000 iteraciones SHA-256 es suficiente para un solo
//   admin sin meter toolchains nativos (bcrypt compila, argon2 es wasm).
// * Sesiones EN BD y no JWT: revocables (logout real = DELETE de la fila;
//   expulsar al admin = borrar sus sesiones). Para un solo usuario, la
//   "escalabilidad stateless" de JWT no aporta nada y sí quita control.
// * Hash del token en BD (SHA-256), token plano solo en la cookie: si alguien
//   lee la BD (backup filtrado, SQL injection) NO puede suplantar sesiones.
//   El token aleatorio de 256 bits no necesita PBKDF2 — SHA-256 basta porque
//   no es un password de baja entropía, es un secreto ya criptográfico.
// * ESTRUCTURA DEL ARCHIVO: las funciones cripto (hashPassword,
//   verifyPassword, y los helpers hex) NO importan nada de Astro ni de db —
//   son portables. requireAdmin/requireAdminApi son la ÚNICA sección que
//   conoce Astro (cookies/redirect). Por qué importa: scripts/seed.ts DUPLICA
//   hashPassword deliberadamente (corre como proceso Node independiente, con
//   process.env vía --env-file, no con el import.meta.env de Astro/Vite que
//   este archivo asume). Si cambias iteraciones, formato o algoritmo aquí,
//   ACTUALIZA la copia de scripts/seed.ts en el mismo commit — pon un
//   comentario espejo en ambos archivos.
//
// ----------------------------------------------------------------------------
// PASOS
// ----------------------------------------------------------------------------
// 1. Helpers internos de conversión (no exportar): bytesToHex(bytes:
//    Uint8Array): string y hexToBytes(hex: string): Uint8Array. Con
//    crypto.subtle todo es ArrayBuffer; el formato de BD es hex legible.
//
// 2. hashPassword:
//      export async function hashPassword(password: string): Promise<string>
//    (a) salt = crypto.getRandomValues(new Uint8Array(16)) — 16 bytes, una
//        sal nueva por password, jamás reutilizada.
//    (b) keyMaterial = crypto.subtle.importKey('raw', new
//        TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']).
//    (c) bits = crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256',
//        salt, iterations: 210_000 }, keyMaterial, 256).
//    (d) return `pbkdf2:210000:${bytesToHex(salt)}:${bytesToHex(bits)}` —
//        el formato guarda iteraciones y sal junto al hash para poder subir
//        el costo en el futuro sin migración especial.
//
// 3. verifyPassword:
//      export async function verifyPassword(password: string, stored: string): Promise<boolean>
//    (a) Parsea stored: split(':'); si no son 4 partes o el algoritmo no es
//        'pbkdf2', return false (defensa ante filas corruptas).
//    (b) Deriva bits con la sal e iteraciones LEÍDAS del string (no
//        hardcodees 210_000 aquí: si mañana subes el costo, los hashes
//        viejos deben seguir verificando).
//    (c) COMPARACIÓN EN TIEMPO CONSTANTE: recorre los dos Uint8Array y
//        acumula diff |= a[i] ^ b[i]; return diff === 0 (y mismo largo).
//        Por qué no comparar strings con ===: === sale en el primer byte
//        distinto y ese tiempo filtra cuántos bytes acertaste (timing
//        attack). Con Web Crypto no hay timingSafeEqual de Node, así que se
//        implementa el XOR byte a byte.
//
// 4. createSession:
//      export async function createSession(sql, userId: number): Promise<string>
//    (a) token = bytesToHex(crypto.getRandomValues(new Uint8Array(32))) —
//        256 bits de aleatoriedad criptográfica; NUNCA Math.random.
//    (b) tokenHash = SHA-256 hex del token (crypto.subtle.digest('SHA-256',
//        new TextEncoder().encode(token))).
//    (c) INSERT INTO sessions (token_hash, user_id, expires_at) VALUES
//        (${tokenHash}, ${userId}, now() + interval '7 days').
//    (d) return token — el plano va a la cookie; en BD queda solo el hash.
//
// 5. getSessionUser:
//      export async function getSessionUser(sql, token: string)
//    (a) tokenHash = SHA-256 del token recibido.
//    (b) SELECT u.id, u.email FROM sessions s JOIN admin_users u ON
//        u.id = s.user_id WHERE s.token_hash = ${tokenHash} AND
//        s.expires_at > now() — devuelve null si no hay fila o expiró.
//    (c) LIMPIEZA PEREZOSA en la misma llamada: DELETE FROM sessions WHERE
//        expires_at <= now() (ver 001_init.sql paso 5: no hay cron en el
//        MVP; cada validación barre las vencidas gratis).
//
// 6. Helpers de cookie (constantes exportadas):
//      export const SESSION_COOKIE = 'rapidoz_session'
//      export const cookieOptions = {
//        httpOnly: true,        // JS del cliente no la lee: mitiga XSS
//        sameSite: 'lax',       // navegación normal la envía; mitiga CSRF
//        secure: import.meta.env.PROD,  // HTTPS solo en producción; en
//                               // dev (http://localhost) secure=true la
//                               // haría invisible y el login "no jalaría"
//        path: '/',
//        maxAge: 7 * 24 * 60 * 60,      // espejo del expires_at de BD
//      }
//
// 7. requireAdmin — guardia para FRONTMATTER de páginas /admin/*:
//      export async function requireAdmin(Astro): Promise<{ id, email } | Response>
//    (a) token = Astro.cookies.get(SESSION_COOKIE)?.value; si no hay,
//        return Astro.redirect('/admin/login').
//    (b) user = await getSessionUser(sql, token); si null, borra la cookie
//        (Astro.cookies.delete) y return Astro.redirect('/admin/login').
//    (c) return user. Uso en la página: `const user = await
//        requireAdmin(Astro); if (user instanceof Response) return user;`
//        (ARCHITECTURE §2.3: guardia por página, sin middleware — 4 páginas,
//        una línea explícita es más legible que magia).
//
// 8. requireAdminApi — variante para ENDPOINTS /api/admin/*:
//      export async function requireAdminApi(cookies): Promise<{ id, email } | null>
//    Misma lógica pero devuelve null en vez de redirect: el endpoint entonces
//    responde `new Response('Unauthorized', { status: 401 })`. Un redirect en
//    un fetch JSON es un bug de UX (el cliente recibiría HTML de login).
//    Recibe solo `cookies` (Astro.cookies) y el sql de './db' — no el objeto
//    Astro completo, para que sea testeable.
//
// ----------------------------------------------------------------------------
// CONTRATO
// ----------------------------------------------------------------------------
// Expone: hashPassword, verifyPassword, createSession, getSessionUser,
// requireAdmin, requireAdminApi, SESSION_COOKIE, cookieOptions.
// Consume: sql de './db' (solo las funciones de sesión/guardia), tablas
// admin_users y sessions (001_init.sql paso 5), crypto global (Node 22).
// Callers: /api/auth (POST login: verifyPassword + createSession + set
// cookie; DELETE logout: borrar sesión y cookie), páginas /admin/*,
// endpoints /api/admin/*. scripts/seed.ts usa su PROPIA copia de hashPassword.
//
// ----------------------------------------------------------------------------
// ERRORES COMUNES
// ----------------------------------------------------------------------------
// - Comparar hashes con === → timing attack; XOR byte a byte siempre.
// - secure: true en dev → la cookie nunca se guarda en localhost y el login
//   parece roto; por eso import.meta.env.PROD.
// - Guardar el token plano en sessions → una lectura de la BD regala las
//   sesiones activas; en BD solo SHA-256 del token.
// - Cambiar iteraciones aquí y olvidar scripts/seed.ts → el seed genera
//   hashes que verifyPassword ya no entiende (o viceversa). Sincroniza ambos.
// - Astro.redirect() sin `return` → el frontmatter sigue ejecutándose y
//   consulta datos de admin sin sesión; siempre `return Astro.redirect(...)`.
// ============================================================================
