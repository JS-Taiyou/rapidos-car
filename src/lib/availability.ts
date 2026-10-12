// Motor de disponibilidad por unidad (spec §3.3). La disponibilidad se
// CONSULTA por modelo pero se DECIDE por unidad: "quedan 2 Versa"; la
// reservación amarra una placa concreta en la transacción (/api/bookings).
// Esta función es consulta; la GARANTÍA es la constraint no_overlap_segment
// de booking_segments (§2.9): desde la migración 006 la unidad vive en el
// TRAMO, no en la cabecera de la renta.
import type { Sql } from './db';
import { sql as dbSql } from './db';

export interface ModelAvailability {
  slug: string;
  name: string;
  category: string;
  transmission: string;
  seats: number;
  luggage: number;
  dailyRateCents: number;
  photos: string[];
  unitsAvailable: number;
}

// Se lee en cada llamada (no se cachea en módulo): el admin puede cambiarla
// y una query extra sobre una tabla de 5 renglones es despreciable.
export async function getTurnaroundBufferMinutes(sql: Sql): Promise<number> {
  const rows = await sql`SELECT value FROM settings WHERE key = 'turnaround_buffer_minutes'`;
  return Number(rows[0]?.value ?? 0);
}

export async function findAvailableModels(start: Date, end: Date): Promise<ModelAvailability[]> {
  const bufferMinutes = await getTurnaroundBufferMinutes(dbSql);
  const rows = await dbSql`
    SELECT m.slug, m.name, m.category, m.transmission, m.seats,
           m.luggage, m.daily_rate_cents, m.photos,
           COUNT(v.id)::int AS units_available
    FROM vehicle_models m
    JOIN vehicles v
      ON v.model_id = m.id AND v.status = 'active'
    WHERE m.active = true
      AND NOT EXISTS (
        SELECT 1
        FROM booking_segments s
        JOIN bookings b ON b.id = s.booking_id
        WHERE s.vehicle_id = v.id
          AND b.status <> 'cancelled'
          AND s.status IN ('reserved','active')
          AND s.period && tstzrange(
                ${start}::timestamptz - (${bufferMinutes} || ' minutes')::interval,
                ${end}::timestamptz   + (${bufferMinutes} || ' minutes')::interval,
                '[)'
          )
      )
    GROUP BY m.id
    ORDER BY m.daily_rate_cents ASC
  `;
  return rows.map((r: Record<string, unknown>) => ({
    slug: r.slug as string,
    name: r.name as string,
    category: r.category as string,
    transmission: r.transmission as string,
    seats: Number(r.seats),
    luggage: Number(r.luggage),
    dailyRateCents: Number(r.daily_rate_cents),
    photos: (r.photos as string[]) ?? [],
    unitsAvailable: Number(r.units_available),
  }));
}

// Misma lógica de NOT EXISTS pero elige UNA unidad y la bloquea con FOR
// UPDATE: se llama DENTRO de la transacción de creación para que dos
// requests no agarren la misma placa a la vez. Recibe `sql` por parámetro
// porque dentro de una transacción se usa el sql transaccional, no el
// singleton. excludeBookingId excluye TODOS los tramos de esa renta (la
// edición de un tramo no debe chocar con sus hermanos).
export async function pickFreeUnit(
  sql: Sql,
  modelSlug: string,
  start: Date,
  end: Date,
  bufferMinutes: number,
  excludeBookingId = 0,
): Promise<number | null> {
  const rows = await sql`
    SELECT v.id
    FROM vehicles v
    JOIN vehicle_models m ON m.id = v.model_id
    WHERE m.slug = ${modelSlug}
      AND m.active = true
      AND v.status = 'active'
      AND NOT EXISTS (
        SELECT 1
        FROM booking_segments s
        JOIN bookings b ON b.id = s.booking_id
        WHERE s.vehicle_id = v.id
          AND b.id <> ${excludeBookingId}
          AND b.status <> 'cancelled'
          AND s.status IN ('reserved','active')
          AND s.period && tstzrange(
                ${start}::timestamptz - (${bufferMinutes} || ' minutes')::interval,
                ${end}::timestamptz   + (${bufferMinutes} || ' minutes')::interval,
                '[)'
          )
      )
    ORDER BY v.id
    LIMIT 1
    FOR UPDATE OF v
  `;
  return rows.length > 0 ? Number(rows[0].id) : null;
}

// Verifica que ESA unidad (elegida por placa en el admin) está libre para el
// rango expandido por el buffer — misma query que pickFreeUnit pero con
// v.id fijo. También transaccional (FOR UPDATE).
export async function isUnitFree(
  sql: Sql,
  vehicleId: number,
  start: Date,
  end: Date,
  bufferMinutes: number,
  excludeBookingId = 0,
): Promise<boolean> {
  const rows = await sql`
    SELECT v.id
    FROM vehicles v
    WHERE v.id = ${vehicleId}
      AND NOT EXISTS (
        SELECT 1
        FROM booking_segments s
        JOIN bookings b ON b.id = s.booking_id
        WHERE s.vehicle_id = v.id
          AND b.id <> ${excludeBookingId}
          AND b.status <> 'cancelled'
          AND s.status IN ('reserved','active')
          AND s.period && tstzrange(
                ${start}::timestamptz - (${bufferMinutes} || ' minutes')::interval,
                ${end}::timestamptz   + (${bufferMinutes} || ' minutes')::interval,
                '[)'
          )
      )
    FOR UPDATE OF v
  `;
  return rows.length > 0;
}
