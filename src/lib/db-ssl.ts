// SSL para Postgres administrado: compartido por el singleton de la app
// (src/lib/db.ts) y los scripts de consola (migrate/seed), sin dependencias
// de entorno — por eso vive en un módulo puro.
export function sslOptionsFor(url: string): boolean | 'require' {
  try {
    if (/sslmode=(require|verify-ca|verify-full)/.test(url)) return 'require';
    if (/(^|\.)supabase\.(co|com)$/.test(new URL(url).hostname)) return 'require';
  } catch {
    // URL inválida: postgres.js dará su propio error claro
  }
  return false;
}
