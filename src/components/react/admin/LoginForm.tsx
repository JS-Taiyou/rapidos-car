// ============================================================================
// ISLA REACT: LoginForm — acceso al admin (/admin/login, solo español)
// ============================================================================
// Propósito: formulario de email + password que autentica contra
// POST /api/auth y, si pasa, lleva a /admin. Es herramienta interna: SIN
// prop lang, textos en español fijos (ARCHITECTURE §2.6: el admin no es
// bilingüe).
//
// ----------------------------------------------------------------------------
// DECISIONES
// ----------------------------------------------------------------------------
// * react-hook-form + zodResolver(loginSchema) AUNQUE son solo 2 campos:
//   (a) consistencia — todos los formularios del admin usan RHF, y un segundo
//   patrón para "el formulario chiquito" es deuda gratuita; (b) el MISMO
//   schema zod valida en cliente y en el endpoint (ARCHITECTURE §2.12), así
//   las reglas y los mensajes son idénticos de los dos lados.
// * useState `submitting` propio en vez de confiar solo en
//   formState.isSubmitting: tras un 200 navegamos con window.location.href y
//   isSubmitting se apaga al resolver la promesa, re-habilitando el botón
//   durante el parpadeo de navegación; el estado propio queda en true hasta
//   que la página se descarga (previene doble submit real).
// * 401 → setError('root') con mensaje GENÉRICO "Credenciales inválidas":
//   NUNCA distinguir "el email no existe" de "password incorrecta" — eso
//   permite enumerar usuarios válidos. El endpoint ya devuelve el mismo 401
//   en ambos casos; el formulario no debe saber más.
// * window.location.href = '/admin' (navegación dura, no router): el login
//   es un boundary de aplicación — la recarga limpia cualquier estado de
//   isla montado y fuerza al servidor a re-evaluar la cookie rapidoz_session
//   fresca. No hay nada que preservar del lado público.
// * Sin "remember me" ni flujo de "olvidé mi contraseña" en el MVP: hay UN
//   solo admin y la sesión vive en BD con expiración (ARCHITECTURE §2.11).
//   Reset manual de password (documentado aquí a propósito):
//     1. Genera el hash con la util hashPassword de src/lib/auth.ts desde un
//        script Deno suelto (deno eval o un console.log temporal en seed).
//     2. UPDATE admin_users SET password_hash = 'pbkdf2:<iter>:<sal>:<hash>'
//        WHERE email = '<admin>';
//     3. DELETE FROM sessions;  (opcional: tumba sesiones vivas)
//
// ----------------------------------------------------------------------------
// PASOS
// ----------------------------------------------------------------------------
// 1. Imports: useForm de 'react-hook-form', zodResolver de
//    '@hookform/resolvers/zod', loginSchema y el tipo LoginInput inferido de
//    src/lib/validation.ts, useState de react. De shadcn/ui: Button, Input,
//    Label, Card (la página centra la tarjeta; la isla no se maqueta sola).
//
// 2. useForm<LoginInput>({ resolver: zodResolver(loginSchema),
//    defaultValues: { email: '', password: '' } }). Registrar ambos campos
//    con {...register('email')} / {...register('password')}.
//
// 3. Handler onSubmit(values): setSubmitting(true); fetch POST /api/auth con
//    JSON { email, password }. Tres salidas:
//      - 200 → window.location.href = '/admin' (NO setSubmitting(false): la
//        página se va; apagarlo solo causaría el parpadeo descrito arriba).
//      - 401 → setError('root', { message: 'Credenciales inválidas' }) +
//        setSubmitting(false).
//      - error de red/500 → setError('root', { message: 'No se pudo conectar,
//        intenta de nuevo' }) + setSubmitting(false).
//
// 4. Markup: <form noValidate onSubmit={handleSubmit(onSubmit)}> — el
//    noValidate importa: las burbujas nativas del navegador pelean con los
//    mensajes zod. Label + Input type="email" (autocomplete="username") e
//    Input type="password" (autocomplete="current-password"); errors.email /
//    errors.password bajo cada campo; errors.root en <p role="alert">;
//    Button submit block con disabled={submitting} y texto que cambia a
//    "Entrando…".
//
// 5. Higiene: el password vive solo dentro de RHF — no lo copies a otro
//    estado, no lo loguees, no lo mandes a analytics. La cookie la pone el
//    servidor vía Set-Cookie httpOnly; este JS NUNCA ve el token (§2.11).
//
// ----------------------------------------------------------------------------
// CONTRATO
// ----------------------------------------------------------------------------
// Sin props (isla raíz de /admin/login, client:load). Consume POST /api/auth
// { email, password } → 200 { ok: true } + Set-Cookie 'rapidoz_session' |
// 401 genérico. Éxito = navegación dura a /admin, donde requireAdmin(Astro)
// vuelve a validar la sesión en servidor (ARCHITECTURE §2.3).
//
// ----------------------------------------------------------------------------
// ERRORES COMUNES
// ----------------------------------------------------------------------------
// - Mensajes distintos según si el email existe: enumeración de usuarios.
//   Un solo mensaje genérico, en schema, endpoint y UI.
// - Navegar con history.pushState o un router: el layout público queda
//   montado y la cookie no se re-evalúa; login es boundary, navegación dura.
// - Guardar el token en localStorage "para las llamadas": la cookie httpOnly
//   viaja sola con credentials same-origin; JS no toca el token.
// - Quitar noValidate: doble sistema de errores (nativo + zod) a la vez.
// ============================================================================
