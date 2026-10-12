-- ============================================================================
-- MIGRACIÓN 001 — Esquema inicial del sistema de renta (white label)
-- Convenios (ARCHITECTURE §2.13): dinero en centavos enteros (*_cents),
-- rangos de tiempo tstzrange, zona del negocio America/Merida.
-- ============================================================================

-- PASO 0 — Extensiones: btree_gist permite combinar = (bigint) y && (rango)
-- en un solo índice GiST de exclusión.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- PASO 1 — Tabla de control del migrador (scripts/migrate.ts también la crea
-- por bootstrap; el IF NOT EXISTS hace la redundancia inofensiva).
CREATE TABLE IF NOT EXISTS _migrations (
  id         serial PRIMARY KEY,
  name       text UNIQUE NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);

-- PASO 2 — Catálogo en dos niveles: modelo (lo que se cotiza) y unidad
-- (el coche físico con placa que se asigna en la transacción).
CREATE TABLE vehicle_models (
  id              bigserial PRIMARY KEY,
  slug            text UNIQUE NOT NULL,
  name            text NOT NULL,
  category        text NOT NULL,
  transmission    text NOT NULL,
  seats           smallint NOT NULL,
  luggage         smallint NOT NULL,
  daily_rate_cents integer NOT NULL,
  photos          text[] NOT NULL DEFAULT '{}',
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE vehicles (
  id         bigserial PRIMARY KEY,
  model_id   bigint NOT NULL REFERENCES vehicle_models(id),
  plate      text UNIQUE NOT NULL,
  status     text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status IN ('active','maintenance','retired'))
);

CREATE INDEX vehicles_model_id_idx ON vehicles(model_id);

-- PASO 3 — Reglas de negocio del motor de precios y configuración.
CREATE TABLE seasons (
  id         bigserial PRIMARY KEY,
  name       text NOT NULL,
  period     daterange NOT NULL,
  multiplier numeric(4,2) NOT NULL
);

CREATE INDEX seasons_period_idx ON seasons USING gist (period);

CREATE TABLE extras (
  id         bigserial PRIMARY KEY,
  name       text UNIQUE NOT NULL,
  price_cents integer NOT NULL,
  per        text NOT NULL,
  active     boolean NOT NULL DEFAULT true,
  CHECK (per IN ('day','rental'))
);

CREATE TABLE settings (
  key   text PRIMARY KEY,
  value jsonb NOT NULL
);

-- PASO 4 — El corazón: bookings + constraint anti-doble-reservación.
CREATE TABLE bookings (
  id                    bigserial PRIMARY KEY,
  code                  text UNIQUE NOT NULL,
  kind                  text NOT NULL DEFAULT 'rental',
  vehicle_id            bigint NOT NULL REFERENCES vehicles(id),
  customer_name         text,
  customer_email        text,
  customer_phone        text,
  flight_number         text,
  period                tstzrange NOT NULL,
  pickup_zone           text NOT NULL,
  extras                jsonb NOT NULL DEFAULT '[]',
  total_cents           integer NOT NULL,
  deposit_type          text NOT NULL,
  status                text NOT NULL DEFAULT 'confirmed',
  notes                 text,
  pickup_reminder_sent  boolean NOT NULL DEFAULT false,
  return_reminder_sent  boolean NOT NULL DEFAULT false,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CHECK (kind IN ('rental','block')),
  CHECK (deposit_type IN ('deposit','on_pickup')),
  CHECK (status IN ('quoted','confirmed','active','completed','cancelled')),
  CHECK (kind = 'block' OR customer_name IS NOT NULL)
);

-- Imposible persistir dos rentas confirmadas/activas solapadas de la misma
-- unidad, sin importar bugs de aplicación o carreras entre requests.
-- Canceladas/completadas no bloquean (WHERE parcial deliberado).
ALTER TABLE bookings ADD CONSTRAINT no_overlap EXCLUDE USING gist (
  vehicle_id WITH =,
  period     WITH &&
) WHERE (status IN ('confirmed','active'));

CREATE INDEX bookings_status_idx ON bookings (status);
CREATE INDEX bookings_lower_period_idx ON bookings (lower(period));

-- PASO 5 — Auth de admin: un usuario, sesiones revocables en BD.
CREATE TABLE admin_users (
  id            bigserial PRIMARY KEY,
  email         text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  token_hash  text PRIMARY KEY,
  user_id     bigint NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sessions_expires_at_idx ON sessions (expires_at);
