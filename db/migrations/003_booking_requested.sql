-- ============================================================================
-- MIGRACIÓN 003 — Snapshot de la solicitud original del cliente
-- ============================================================================
-- requested jsonb: lo que el cliente PIDIÓ (web) o lo que el staff capturó,
-- congelado. Aunque staff cambie modelo/fechas/extras de la reservación, el
-- original queda aquí para el diff "Reservación original → actual" del
-- panel y el follow-up del lead. En 409 (sin disponibilidad), la solicitud
-- se guarda como booking status='quoted' (la constraint de exclusión los
-- ignora: no apartan inventario) con requested completo.
ALTER TABLE bookings ADD COLUMN requested jsonb NOT NULL DEFAULT '{}'::jsonb;
