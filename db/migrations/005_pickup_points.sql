-- ============================================================================
-- MIGRACIÓN 005 — Puntos de entrega y recogida gestionables desde el panel
-- ============================================================================
-- Cada punto tiene nombre, tarifa OPCIONAL (NULL = gratis) y ubicación
-- (lat/lng para el mapa del admin). Una reserva ahora distingue punto de
-- ENTREGA (pickup_zone) y de RECOGIDA/devolución (return_zone): la tarifa
-- de servicio suma ambas cuando son distintas.
CREATE TABLE pickup_points (
  id         bigserial PRIMARY KEY,
  key        text UNIQUE NOT NULL,          -- identificador estable para la API
  name       text NOT NULL,                 -- nombre visible
  fee_cents  integer,                       -- NULL = gratuito
  lat        double precision,              -- ubicación para mapa (opcional)
  lng        double precision,
  active     boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Devolución distinta de la entrega en una misma reserva.
ALTER TABLE bookings ADD COLUMN return_zone text;

-- Import de las zonas sembradas en settings.delivery_zones (si existen).
INSERT INTO pickup_points (key, name, fee_cents, sort_order)
SELECT z->>'zone',
       CASE z->>'zone'
         WHEN 'airport_mid' THEN 'Aeropuerto Internacional de Mérida'
         WHEN 'centro' THEN 'Centro de Mérida'
         WHEN 'norte' THEN 'Zona norte'
         WHEN 'hotel_zone' THEN 'Zona hotelera'
         ELSE z->>'zone' END,
       NULLIF(z->>'fee_cents', '')::int,
       row_number() OVER ()
FROM settings, jsonb_array_elements(settings.value) AS z
WHERE settings.key = 'delivery_zones'
ON CONFLICT (key) DO NOTHING;
