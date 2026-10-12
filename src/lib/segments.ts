// Utilidades del modelo de segmentos (migración 006): la renta (bookings) es
// la cabecera y cada booking_segments es un tramo con unidad/período/precio.
// Aquí viven las reglas transversales: estado agregado de la renta y
// recálculo del consolidado (total = suma de tramos vivos).
import type { Sql } from './db';

// Tramos que AMARRAN inventario (los mismos del WHERE de no_overlap_segment).
export const BLOCKING_SEGMENT_STATUSES = ['reserved', 'active'] as const;

export interface SegmentRow {
  id: number;
  idx: number;
  status: string;
  model_slug: string;
  model_name: string;
  plate: string | null;
  period_start: string;
  period_end: string;
  total_cents: number;
}

// Estado agregado de la renta a partir de sus tramos:
// - todos los tramos vivos completos → 'completed'
// - algún tramo en calle → 'active'
// - todos cancelados → 'cancelled'
// - en otro caso se conserva el estado de la cabecera (quoted/confirmed).
export function deriveBookingStatus(
  segments: Array<{ status: string }>,
  current: string,
): string {
  const live = segments.filter((s) => s.status !== 'cancelled');
  if (live.length === 0) return 'cancelled';
  if (live.every((s) => s.status === 'completed')) return 'completed';
  if (live.some((s) => s.status === 'active')) return 'active';
  return current;
}

// Re-sincroniza el consolidado de la cabecera tras mutar tramos:
// total_cents = suma de los tramos no cancelados; pricing = desglose del
// ÚLTIMO tramo vivo (con rentas de un tramo es idéntico al comportamiento
// histórico; con varios, la UI de desglose se refina en el asistente de
// replan). Puede llamarse dentro o fuera de una transacción (sql por parámetro).
export async function recalcBookingTotals(sql: Sql, bookingId: number): Promise<void> {
  await sql`
    UPDATE bookings b
    SET total_cents = COALESCE(agg.total, 0),
        pricing = COALESCE(agg.pricing, b.pricing)
    FROM (
      SELECT
        (SELECT SUM(total_cents) FROM booking_segments s
         WHERE s.booking_id = ${bookingId} AND s.status <> 'cancelled') AS total,
        (SELECT pricing FROM booking_segments s
         WHERE s.booking_id = ${bookingId} AND s.status <> 'cancelled'
         ORDER BY idx DESC LIMIT 1) AS pricing
    ) agg
    WHERE b.id = ${bookingId}
  `;
}

// Vista agregada de una renta para el panel: período total (min lower →
// max upper), unidad/modelo del primer tramo, extras del primer tramo vivo
// y la línea de tiempo completa ordenada por idx. Reutilizada por
// /api/admin/bookings y /api/admin/customers/[id] — como fragmento SQL
// (postgres.js) para componerla en el WHERE que cada endpoint necesite.

// Tramos de una renta con modelo/placa, ordenados por idx. `live` filtra los
// cancelados (línea de tiempo que el panel enseña).
export async function getSegments(
  sql: Sql,
  bookingId: number,
): Promise<SegmentRow[]> {
  const rows = await sql`
    SELECT s.id, s.idx, s.status, m.slug AS model_slug, m.name AS model_name,
           v.plate, lower(s.period) AS period_start, upper(s.period) AS period_end,
           s.total_cents
    FROM booking_segments s
    JOIN vehicle_models m ON m.id = s.model_id
    LEFT JOIN vehicles v ON v.id = s.vehicle_id
    WHERE s.booking_id = ${bookingId}
    ORDER BY s.idx
  `;
  return rows.map((r: Record<string, unknown>) => ({
    id: Number(r.id),
    idx: Number(r.idx),
    status: r.status as string,
    model_slug: r.model_slug as string,
    model_name: r.model_name as string,
    plate: (r.plate as string | null) ?? null,
    period_start: new Date(r.period_start as string).toISOString(),
    period_end: new Date(r.period_end as string).toISOString(),
    total_cents: Number(r.total_cents),
  }));
}
