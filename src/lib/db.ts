// Singleton postgres.js para TODO el código servidor de la app (frontmatter
// .astro SSR y endpoints /api/*). Sin ORM: SQL a mano (ARCHITECTURE §2.4).
//
// REGLA DE ORO: este archivo SOLO se importa en código servidor — frontmatter
// de .astro y endpoints .ts, NUNCA en una isla React (.tsx): rompería el
// bundle del cliente y filtraría credenciales.
import type postgres from 'postgres';
import { resolveDatabase } from './db-conn';

// Runtime PRIMERO: Astro hornea import.meta.env.* dentro del bundle en
// BUILD time (p.ej. la variable dummy del Dockerfile o un build de CI), y
// ese valor pisaría el .env real al arrancar. process.env refleja siempre
// el entorno del proceso (--env-file, variables de la plataforma).
const DATABASE_URL = process.env.DATABASE_URL ?? import.meta.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL no está definida; copia .env.example a .env');
}

export { sslOptionsFor } from './db-ssl';

// Pool chico y deliberado (ARCHITECTURE §2.15): 5 conexiones por proceso
// contra Postgres/Supabase; 1 en el modo embebido (pglite://). El
// top-level await resuelve la conexión ANTES de que cualquier query corra
// (en pglite, el socket local debe existir primero).
export const sql = await resolveDatabase(DATABASE_URL, { max: 5 });

// Tipo compartido para helpers que corren queries: Sql (singleton) y
// TransactionSql (el de sql.begin) extienden ambos ISql, así que las
// funciones de availability/auth aceptan cualquiera de los dos.
export type Sql = postgres.ISql;
