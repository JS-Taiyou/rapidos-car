// Singleton postgres.js para TODO el código servidor de la app (frontmatter
// .astro SSR y endpoints /api/*). Sin ORM: SQL a mano (ARCHITECTURE §2.4).
//
// REGLA DE ORO: este archivo SOLO se importa en código servidor — frontmatter
// de .astro y endpoints .ts, NUNCA en una isla React (.tsx): rompería el
// bundle del cliente y filtraría credenciales.
import postgres from 'postgres';

const DATABASE_URL = import.meta.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL no está definida; copia .env.example a .env');
}

// Pool chico y deliberado (ARCHITECTURE §2.15): 5 conexiones por proceso.
export const sql = postgres(DATABASE_URL, { max: 5 });

// Tipo compartido para helpers que corren queries: Sql (singleton) y
// TransactionSql (el de sql.begin) extienden ambos ISql, así que las
// funciones de availability/auth aceptan cualquiera de los dos.
export type Sql = postgres.ISql;
