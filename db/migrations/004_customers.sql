-- ============================================================================
-- MIGRACIÓN 004 — CRM ligero de clientes (spec §4.4)
-- ============================================================================
-- SIN cuentas de cliente (fricción cero en el funnel): la identidad se
-- resuelve por CURP (llave fuerte, capturada por el staff con la
-- identificación oficial al firmar) y por email/teléfono (llaves débiles,
-- auto-vinculan reservas entrantes). El contacto vigente vive en columnas
-- (indexables); contact_history jsonb conserva los retirados — nunca se
-- descarta un dato previo.
CREATE TABLE customers (
  id              bigserial PRIMARY KEY,
  curp            text UNIQUE,             -- NULL hasta que el staff lo captura
  full_name       text NOT NULL,
  email           text,                    -- contacto VIGENTE
  phone           text,
  contact_history jsonb NOT NULL DEFAULT '[]', -- [{kind,value,retiredAt}]
  notes           text,
  no_show         boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX customers_email_idx ON customers (email);
CREATE INDEX customers_phone_idx ON customers (phone);

ALTER TABLE bookings ADD COLUMN customer_id bigint REFERENCES customers(id);
CREATE INDEX bookings_customer_id_idx ON bookings (customer_id);
