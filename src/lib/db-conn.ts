// Resolución de la conexión a datos — UN contrato para tres modos:
//   postgres://...           → Postgres local o Supabase (SSL auto en *.supabase)
//   pglite://<ruta>          → Postgres EMBEBIDO en el proceso (un archivo en
//                              disco): el "modo sin base de datos" para tenants
//                              pequeños. Mismo dialecto y MISMA constraint
//                              GiST (btree_gist via contrib) — cero queries
//                              diferentes; postgres.js conecta por el socket
//                              local de PGlite.
import postgres from 'postgres';
import { sslOptionsFor } from './db-ssl';

// Sockets de instancias embebidas activas: el server mantiene vivo el
// event loop, así que los scripts de consola deben cerrarlos al terminar
// (la app NO los cierra: viven tanto como el proceso).
const embeddedServers: Array<{ stop(): Promise<void> }> = [];

export async function closeEmbeddedDatabases(): Promise<void> {
  await Promise.all(embeddedServers.splice(0).map((s) => s.stop().catch(() => undefined)));
}

export async function resolveDatabase(
  url: string,
  opts: { max?: number } = {},
): Promise<postgres.Sql> {
  if (url.startsWith('pglite://')) {
    const { PGlite } = await import('@electric-sql/pglite');
    const { btree_gist } = await import('@electric-sql/pglite/contrib/btree_gist');
    const { PGLiteSocketServer } = await import('@electric-sql/pglite-socket');
    const dbPath = decodeURIComponent(url.slice('pglite://'.length)) || './data/rapidoz';
    // PGlite no crea el directorio contenedor: mkdir -p del padre.
    const { mkdir } = await import('node:fs/promises');
    const { dirname } = await import('node:path');
    await mkdir(dirname(dbPath), { recursive: true });
    const pg = await PGlite.create(dbPath, { extensions: { btree_gist } });
    const server = new PGLiteSocketServer({ db: pg, port: 0 });
    await server.start();
    embeddedServers.push(server);
    const port = (await server.getServerConn()).split(':').pop();
    // max:1 deliberado: PGlite ejecuta UNA consulta a la vez; una sola
    // conexión mantiene las transacciones (BEGIN…COMMIT) coherentes.
    return postgres(`postgres://postgres:postgres@127.0.0.1:${port}/pglite-db?sslmode=disable`, {
      max: 1,
    });
  }
  const ssl = sslOptionsFor(url);
  return postgres(url, { max: opts.max ?? 5, ...(ssl ? { ssl } : {}) });
}
