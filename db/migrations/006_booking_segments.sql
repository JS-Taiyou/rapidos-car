-- ============================================================================
-- MIGRACIÓN 006 — Segmentos: la renta como línea de tiempo de vehículos
-- ============================================================================
-- bookings pasa a ser la CABECERA de la renta (cliente, código, estado,
-- notas, requested, total) y baja la asignación de unidad/período/precio a
-- booking_segments: cada fila es un tramo con un modelo. Así una renta puede
-- cambiar de vehículo a mitad ("2 días compacto + 3 pickup + 2 sedán"),
-- extenderse o cerrar tramos anticipadamente (ROADMAP Fase 1).
--
-- Estados del segmento: 'quoted' (la renta aún es un lead: NO aparta
-- inventario), 'reserved' (aparta), 'active' (unidad en calle), 'completed'
-- (devuelto), 'cancelled'. La constraint de exclusión se MUDA aquí con la
-- unidad — cancelados/completados/quoted no bloquean (WHERE parcial).

CREATE TABLE booking_segments (
  id           bigserial PRIMARY KEY,
  booking_id   bigint NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  idx          integer NOT NULL CHECK (idx > 0),       -- orden legible 1..n
  model_id     bigint NOT NULL REFERENCES vehicle_models(id),
  vehicle_id   bigint REFERENCES vehicles(id),         -- unidad concreta
  period       tstzrange NOT NULL,
  status       text NOT NULL DEFAULT 'reserved'
               CHECK (status IN ('quoted','reserved','active','completed','cancelled')),
  pricing      jsonb NOT NULL DEFAULT '{}'::jsonb,     -- desglose del tramo (mismo shape que bookings.pricing)
  total_cents  integer NOT NULL DEFAULT 0,             -- denorm para reportes (§2.13)
  extras       jsonb NOT NULL DEFAULT '[]',
  pickup_zone  text NOT NULL,
  return_zone  text,
  -- Handover (se llena en el patio, ROADMAP Fase 3):
  odometer_out integer,
  fuel_out     smallint CHECK (fuel_out BETWEEN 0 AND 8),  -- octavos de tanque
  odometer_in  integer,
  fuel_in      smallint CHECK (fuel_in BETWEEN 0 AND 8),
  handover_out jsonb,   -- {at, staffEmail, checklist, photos, notes}
  handover_in  jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (booking_id, idx)
);

-- Imposible persistir dos tramos que amaren la misma unidad en períodos
-- solapados, sin importar bugs de aplicación o carreras entre requests
-- (sucesora de bookings.no_overlap, §2.9).
ALTER TABLE booking_segments ADD CONSTRAINT no_overlap_segment EXCLUDE USING gist (
  vehicle_id WITH =,
  period     WITH &&
) WHERE (vehicle_id IS NOT NULL AND status IN ('reserved','active'));

CREATE INDEX booking_segments_booking_idx ON booking_segments(booking_id);
CREATE INDEX booking_segments_vehicle_idx ON booking_segments(vehicle_id);
CREATE INDEX booking_segments_status_idx ON booking_segments (status);
CREATE INDEX booking_segments_lower_period_idx ON booking_segments (lower(period));

-- BACKFILL: cada renta existente se convierte en su segmento 1, copiando
-- unidad/período/precio del modelo plano. Mapeo de estados: la renta
-- 'confirmed' baja a tramo 'reserved' (aparta unidad); los leads 'quoted'
-- bajan a 'quoted' para NO empezar a apartar inventario que hoy no apartan.
INSERT INTO booking_segments
  (booking_id, idx, model_id, vehicle_id, period, status, pricing, total_cents,
   extras, pickup_zone, return_zone)
SELECT b.id, 1, v.model_id, b.vehicle_id, b.period,
       CASE b.status WHEN 'confirmed' THEN 'reserved' ELSE b.status END,
       b.pricing, b.total_cents, b.extras,
       b.pickup_zone, b.return_zone
FROM bookings b
JOIN vehicles v ON v.id = b.vehicle_id;

-- La unidad ya no vive en la cabecera: se retiran las columnas planas y la
-- constraint original (su sucesora vive en booking_segments). total_cents y
-- pricing se quedan como consolidado de la renta (suma de tramos).
ALTER TABLE bookings DROP CONSTRAINT no_overlap;
ALTER TABLE bookings DROP COLUMN vehicle_id;
ALTER TABLE bookings DROP COLUMN period;
ALTER TABLE bookings DROP COLUMN extras;
ALTER TABLE bookings DROP COLUMN pickup_zone;
ALTER TABLE bookings DROP COLUMN return_zone;
