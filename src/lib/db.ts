// Singleton postgres.js para TODO el código servidor de la app (frontmatter
// .astro SSR y endpoints /api/*). Sin ORM: SQL a mano (ARCHITECTURE §2.4).
//
// REGLA DE ORO: este archivo SOLO se importa en código servidor — frontmatter
// de .astro y endpoints .ts, NUNCA en una isla React (.tsx): rompería el
// bundle del cliente y filtraría credenciales.
import postgres from 'postgres';
import { sslOptionsFor } from './db-ssl';

// Runtime PRIMERO: Astro hornea import.meta.env.* dentro del bundle en
// BUILD time (p.ej. la variable dummy del Dockerfile o un build de CI), y
// ese valor pisaría el .env real al arrancar. process.env refleja siempre
// el entorno del proceso (--env-file, variables de la plataforma).
const DATABASE_URL = process.env.DATABASE_URL ?? import.meta.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL no está definida; copia .env.example a .env');
}

// SSL para Postgres administrado (Supabase y similares exigen cifrar).
export { sslOptionsFor } from './db-ssl';

// Pool chico y deliberado (ARCHITECTURE §2.15): 5 conexiones por proceso.
// Con Supabase usar la conexión DIRECTA (5432) para migraciones Y runtime
// mientras sea un proceso único; el pooler (6543) sólo al escalar réplicas.
const ssl = sslOptionsFor(DATABASE_URL);
export const sql = postgres(DATABASE_URL, { max: 5, ...(ssl ? { ssl } : {}) });

// Tipo compartido para helpers que corren queries: Sql (singleton) y
// TransactionSql (el de sql.begin) extienden ambos ISql, así que las
// funciones de availability/auth aceptan cualquiera de los dos.
export type Sql = postgres.ISql;
