// Auditoría (ROADMAP Fase 2): quién hizo qué, cuándo y con el diff del
// antes/después. Fire-and-log deliberado: la operación de negocio NO se
// revienta si la auditoría falla (se registra en consola); cuando el caller
// tiene una transacción abierta, pasa su sql para que el registro sea atómico
// con el cambio.
import type { APIContext } from 'astro';
import type { Sql } from './db';

export interface AuditEntry {
  action: string;
  entity: string;
  entityId?: number | null;
  summary: string;
  // before es opcional: los create sólo tienen after. La UI de /admin/auditoría
  // muestra before tachado cuando existe.
  diff?: Record<string, { before?: unknown; after: unknown }> | null;
}

export async function logAudit(
  sql: Sql,
  admin: { id: number; email: string } | null,
  entry: AuditEntry,
  context?: Pick<APIContext, 'request'>,
): Promise<void> {
  try {
    const ip =
      context?.request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      context?.request.headers.get('x-real-ip') ??
      null;
    const userAgent = context?.request.headers.get('user-agent') ?? null;
    await sql`
      INSERT INTO audit_log (user_id, user_email, action, entity, entity_id, summary, diff, ip, user_agent)
      VALUES (
        ${admin?.id ?? null},
        ${admin?.email ?? 'sistema'},
        ${entry.action},
        ${entry.entity},
        ${entry.entityId ?? null},
        ${entry.summary},
        ${entry.diff ? sql.json(JSON.parse(JSON.stringify(entry.diff))) : null}::jsonb,
        ${ip},
        ${userAgent}
      )
    `;
  } catch (err) {
    // La auditoría es evidencia, no bloqueo: un fallo aquí no debe tumbar la
    // operación de negocio que la originó.
    console.error('audit: no se pudo registrar', entry.action, entry.entity, err);
  }
}

// Difiere dos snapshots de columnas clave y devuelve el diff {campo: {before,
// after}} sólo con lo que cambió (para no ensuciar audit_log).
export function diffFields<T extends Record<string, unknown>>(
  before: T,
  after: Partial<Record<keyof T, unknown>>,
): Record<string, { before: unknown; after: unknown }> {
  const diff: Record<string, { before: unknown; after: unknown }> = {};
  for (const [key, afterValue] of Object.entries(after)) {
    const beforeValue = before[key];
    if (JSON.stringify(beforeValue) !== JSON.stringify(afterValue)) {
      diff[key] = { before: beforeValue ?? null, after: afterValue ?? null };
    }
  }
  return diff;
}
