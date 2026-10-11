-- ============================================================================
-- MIGRACIÓN 002 — Desglose de precio con procedencia en bookings
-- ============================================================================
-- pricing jsonb guarda el SNAPSHOT completo del desglose (días, tarifa
-- aplicada, extras con precios editables, descuento explícito, entrega,
-- IVA, total) + PROCEDENCIA: source (engine|manual|adjust), reason y
-- editedBy/editedAt — el "por qué ese número quedó así" viaja con el número.
-- total_cents sigue siendo la columna denormalizada para queries/reports.

ALTER TABLE bookings ADD COLUMN pricing jsonb NOT NULL DEFAULT '{}'::jsonb;
