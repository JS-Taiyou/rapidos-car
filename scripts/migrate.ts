// ============================================================================
// SCRIPT: migrate — migrador SQL mínimo (aplica db/migrations/*.sql)
// ============================================================================
// Propósito: aplicar las migraciones numeradas de db/migrations/ exactamente
// una vez y en orden, registrándolas en la tabla de control `_migrations`.
// Se corre a mano con `npm run db:migrate`.
//
// ----------------------------------------------------------------------------
// DECISIONES
// ----------------------------------------------------------------------------
// * Script en Node con tsx (ARCHITECTURE §2.5): un solo runtime en todo el
//   proyecto. El script "db:migrate" de package.json ya invoca
//   `node --env-file=.env --import tsx scripts/migrate.ts`, así DATABASE_URL
//   llega sola desde .env (flag nativa de Node ≥ 20.6, sin dotenv).
// * Driver `postgres` (postgres.js), el MISMO paquete npm que usa la app
//   (ARCHITECTURE §2.4): un solo SQL, un solo driver y una sola forma de
//   parametrizar en todo el proyecto. Se importa como dependencia normal:
//   import postgres from 'postgres'.
// * Cliente con { max: 1 }: las migraciones son secuenciales y de un solo
//   propósito; con una conexión garantizas que el BEGIN/COMMIT/ROLLBACK de
//   cada migración ocurre en la MISMA conexión (con pool > 1 el driver podría
//   mandar el COMMIT por otra conexión y abortar la transacción). Por la
//   misma razón, DATABASE_URL aquí SIEMPRE es la conexión DIRECTA de Supabase
//   (puerto 5432), nunca el pooler en modo transacción (§2.15).
// * Orden lexicográfico = orden de aplicación: los archivos llevan prefijo
//   numérico 001_, 002_, … y se ordenan por nombre. Convención universal de
//   migradores: el nombre ES la versión, legible y ordenable sin metadata.
// * Transacción POR migración: cada archivo entra completo o no entra. Una
//   migración a medias NUNCA queda marcada en _migrations, así el siguiente
//   `db:migrate` la reintenta limpia en vez de dejar el esquema roto y además
//   marcado como "ya aplicada" (esa combinación es la pesadilla).
//
// ----------------------------------------------------------------------------
// PASOS
// ----------------------------------------------------------------------------
// 1. Importar el driver y el filesystem:
//      import postgres from 'postgres'
//      import { readdir, readFile } from 'node:fs/promises'
//
// 2. Leer la URL de conexión:
//      const databaseUrl = process.env.DATABASE_URL
//    Si falta: console.error con mensaje claro ("falta DATABASE_URL: copia
//    .env.example a .env") y process.exit(1). Fallar rápido con instrucción
//    concreta, no con un error críptico de conexión 10 líneas después.
//
// 3. Crear el cliente:
//      const sql = postgres(databaseUrl, { max: 1 })
//
// 4. Bootstrap de la tabla de control. Patrón bootstrap: _migrations NO
//    puede vivir dentro de una migración porque el migrador la necesita
//    ANTES de saber qué ya aplicó. Ejecuta (con sql.unsafe o sql`` simple):
//      CREATE TABLE IF NOT EXISTS _migrations (
//        id serial PRIMARY KEY,
//        name text UNIQUE NOT NULL,
//        applied_at timestamptz NOT NULL DEFAULT now()
//      )
//    001_init.sql también la crea por defensa (paso 1 de esa guía); el
//    IF NOT EXISTS hace esa redundancia inofensiva en ambos sentidos.
//
// 5. Localizar la carpeta relativa al PROPIO archivo, no al cwd:
//      const migrationsDir = new URL('../db/migrations/', import.meta.url)
//    Por qué import.meta.url: el script puede invocarse desde cualquier
//    directorio; una ruta relativa 'db/migrations' dependería del cwd. Con la
//    URL del módulo resuelve igual sin importar desde dónde se invoque (ESM
//    de Node soporta import.meta.url igual que los frontmatter de Astro).
//    Lee las entradas con await readdir(migrationsDir, { withFileTypes: true })
//    (node:fs acepta objetos URL file://), filtra
//    entry.isFile() && entry.name.endsWith('.sql') y ordena por name.
//
// 6. Consultar lo ya aplicado y armar un Set:
//      SELECT name FROM _migrations  →  new Set(rows.map(r => r.name))
//
// 7. Para cada archivo cuyo nombre NO esté en el Set:
//      a. Lee el contenido:
//         await readFile(new URL(name, migrationsDir), 'utf8').
//      b. Abre transacción: await sql.unsafe('BEGIN').
//      c. Ejecuta el archivo COMPLETO: await sql.unsafe(contenido).
//         Por qué unsafe: el tag sql`` de postgres.js es para queries
//         parametrizadas de una sola sentencia; un archivo de migración es
//         SQL crudo multi-sentencia (CREATE, ALTER, índices…). Es seguro
//         aquí porque el archivo es TUYO (vive en tu repo), no input de
//         usuario — el peligro de unsafe es inyección SQL, y no hay
//         inyección posible desde tu propio código fuente.
//      d. Registra con sql``: INSERT INTO _migrations (name) VALUES (${name}).
//      e. await sql.unsafe('COMMIT') y log por consola: "aplicada: 001_init.sql".
//      f. Si algo falla: await sql.unsafe('ROLLBACK'), log del archivo y del
//         error, y process.exit(1). Detente en el primer error: aplicar la
//         003 con la 002 rota dejaría un esquema inconsistente.
//
// 8. Resumen final por consola ("2 aplicadas, 3 ya existían") y cierra el
//    cliente con await sql.end() — sin end() el proceso de Node no termina
//    solo porque el pool mantiene la conexión abierta.
//
// ----------------------------------------------------------------------------
// CONTRATO
// ----------------------------------------------------------------------------
// Ejecuta: `npm run db:migrate` (el script de package.json ya trae
// --env-file=.env y --import tsx). Deja en la BD: el esquema de todas las
// migraciones aplicadas y un renglón por archivo en _migrations con su
// applied_at. Es re-ejecutable: en corridas siguientes no aplica nada, solo
// reporta "0 aplicadas, N ya existían".
//
// ----------------------------------------------------------------------------
// ERRORES COMUNES
// ----------------------------------------------------------------------------
// 1. No usar transacción por migración → un .sql que truena a la mitad deja
//    tablas creadas a medias y el reintento falla con "already exists".
// 2. Re-aplicar por no consultar _migrations antes → mismos errores de
//    "already exists" en la segunda corrida.
// 3. Rutas relativas al cwd ('db/migrations') → solo funciona parado en la
//    raíz; usa siempre new URL(..., import.meta.url).
// 4. Interpolar el contenido con sql`${contenido}` → postgres.js lo escapa
//    como string, no lo ejecuta como SQL; el archivo va por unsafe().
// 5. Apuntar DATABASE_URL al pooler de Supabase (puerto 6543) → las
//    transacciones multi-sentencia no están garantizadas en modo
//    transaction; migraciones SIEMPRE contra la conexión directa (5432).
// ============================================================================
