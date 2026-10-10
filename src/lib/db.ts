// ============================================================================
// LIB: db — singleton postgres.js (ARCHITECTURE §2.4)
// ============================================================================
// Propósito: exponer UN solo cliente de Postgres para todo el código servidor
// de la app (frontmatter .astro SSR y endpoints /api/*). Sin ORM: SQL a mano
// con el paquete `postgres` (postgres.js).
//
// ----------------------------------------------------------------------------
// DECISIONES
// ----------------------------------------------------------------------------
// * Singleton a nivel de MÓDULO (se crea al importar el archivo, una vez por
//   proceso): el servidor Node reutiliza el proceso entre requests; si
//   crearas el cliente dentro de cada handler, cada request abriría
//   conexiones nuevas y agotaría el límite de conexiones de Supabase. Un
//   cliente por proceso = conexiones cálidas reutilizadas.
// * Pool chico: `max: 5`. El free tier de Supabase limita conexiones
//   directas (spec §2: "cada query cuenta"). 5 conexiones por proceso sobran
//   para el tráfico del MVP; más pool = más riesgo de "too many connections"
//   cuando hay varios procesos (réplicas + scripts) a la vez.
// * Diferencia con los scripts de BD (scripts/migrate.ts, scripts/seed.ts):
//   esos leen `process.env.DATABASE_URL` (vía --env-file de Node) y crean SU
//   PROPIO cliente postgres.js dentro del script (viven segundos y mueren).
//   Este archivo, en cambio, lee `import.meta.env.DATABASE_URL` porque corre
//   dentro de Astro/Vite, que inyecta el .env. No compartas el singleton con
//   los scripts: ciclos de vida distintos, forma distinta de leer el env.
// * REGLA DE ORO: este archivo SOLO se importa en código servidor —
//   frontmatter de .astro (entre los `---`) y endpoints .ts. NUNCA en una
//   isla React (.tsx): si una isla lo importa, (a) el bundle del cliente
//   truena porque postgres.js usa APIs de Node que el navegador no tiene, y
//   (b) peor, expondrías DATABASE_URL (credenciales) en el JS que se sirve
//   al público. Las islas hablan con la BD solo a través de fetch a /api/*.
//
// ----------------------------------------------------------------------------
// PASOS
// ----------------------------------------------------------------------------
// 1. Importar postgres.js:
//      import postgres from 'postgres'
//    (instalación: `npm i postgres`, ya listado en ARCHITECTURE §6 paso 1).
//
// 2. Leer la URL de conexión:
//      const DATABASE_URL = import.meta.env.DATABASE_URL
//    Astro inyecta .env automáticamente en import.meta.env (sin dotenv).
//    NOTA: sin prefijo PUBLIC_ = variable SOLO de servidor; Astro jamás la
//    expone al cliente. Si alguien la renombra PUBLIC_DATABASE_URL, se
//    filtraría al bundle — no lo hagas.
//
// 3. Validar temprano: si DATABASE_URL es undefined, lanzar
//    `throw new Error('DATABASE_URL no está definida; copia .env.example a .env')`.
//    Por qué: fallar ruidoso al arrancar el proceso es mejor que un error
//    críptico de conexión en el primer request.
//
// 4. Crear y exportar el singleton:
//      export const sql = postgres(DATABASE_URL, { max: 5 })
//    Eso es todo el archivo. postgres.js maneja el pool internamente y sus
//    template literals (sql`SELECT ...`) escapan parámetros solos — nunca
//    concatenes strings para armar SQL.
//
// ----------------------------------------------------------------------------
// CONTRATO
// ----------------------------------------------------------------------------
// Expone: `sql` (instancia de postgres.js). Consumen: availability.ts,
// auth.ts (createSession/getSessionUser lo reciben como parámetro, ver su
// guía), los endpoints /api/* y los frontmatter SSR de /flota y /admin.
// Para transacciones usa `sql.begin(async (sqlTx) => { ... })` y pasa sqlTx
// a las funciones que lo acepten (ej. pickFreeUnit de availability.ts).
//
// ----------------------------------------------------------------------------
// ERRORES COMUNES
// ----------------------------------------------------------------------------
// - Importar `sql` en un .tsx → bundle roto + credenciales filtradas. Si TS
//   no lo impide, la disciplina es: imports de './db' solo en .astro/.ts.
// - Crear `postgres(DATABASE_URL)` dentro de cada endpoint → agota el límite
//   de conexiones de Supabase; el singleton existe exactamente para evitar eso.
// - `max` alto "por si acaso" → en producción hay N procesos × max
//   conexiones; 5 es deliberado.
// - Leer process.env en vez de import.meta.env → funciona en dev Node pero
//   rompe la convención de Astro y el despliegue; usa import.meta.env.
// ============================================================================
