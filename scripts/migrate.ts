// Migrador SQL mínimo: aplica db/migrations/*.sql una sola vez y en orden,
// registrando cada archivo en _migrations. Se corre con `npm run db:migrate`
// (node --env-file=.env --import tsx ya inyecta DATABASE_URL).
import { resolveDatabase, closeEmbeddedDatabases } from '../src/lib/db-conn';
import { readdir, readFile } from 'node:fs/promises';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('falta DATABASE_URL: copia .env.example a .env');
  process.exit(1);
}

// max: 1 — BEGIN/COMMIT/ROLLBACK de cada migración deben caer en la MISMA
// conexión; con pool > 1 el driver podría mandar el COMMIT por otra.
const sql = await resolveDatabase(databaseUrl, { max: 1 });

// Bootstrap de la tabla de control: el migrador la necesita ANTES de saber
// qué ya aplicó. 001_init.sql también la crea por defensa (IF NOT EXISTS).
await sql.unsafe(`
  CREATE TABLE IF NOT EXISTS _migrations (
    id         serial PRIMARY KEY,
    name       text UNIQUE NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
  )
`);

// Ruta relativa al PROPIO archivo, no al cwd: resuelve igual desde donde se
// invoque el script.
const migrationsDir = new URL('../db/migrations/', import.meta.url);
const entries = await readdir(migrationsDir, { withFileTypes: true });
const files = entries
  .filter((e) => e.isFile() && e.name.endsWith('.sql'))
  .map((e) => e.name)
  .sort();

const appliedRows = await sql`SELECT name FROM _migrations`;
const applied = new Set(
  (appliedRows as unknown as Array<{ name: string }>).map((r) => r.name),
);

let migrated = 0;
let skipped = 0;

for (const name of files) {
  if (applied.has(name)) {
    skipped++;
    continue;
  }
  const content = await readFile(new URL(name, migrationsDir), 'utf8');
  try {
    // El archivo es SQL crudo multi-sentencia propio (vive en el repo), no
    // input de usuario: va por unsafe(). La transacción por migración hace
    // que un .sql que truena a la mitad NO quede marcado como aplicado.
    await sql.unsafe('BEGIN');
    await sql.unsafe(content);
    await sql`INSERT INTO _migrations (name) VALUES (${name})`;
    await sql.unsafe('COMMIT');
    console.log(`aplicada: ${name}`);
    migrated++;
  } catch (err) {
    await sql.unsafe('ROLLBACK');
    console.error(`falló ${name}:`, err);
    process.exit(1);
  }
}

console.log(`${migrated} aplicadas, ${skipped} ya existían`);
await sql.end({ timeout: 5 });
await closeEmbeddedDatabases();
process.exit(0);
