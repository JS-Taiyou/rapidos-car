-- ============================================================================
-- MIGRACIÓN 009 — Roles de usuario y mantenimiento por kilometraje
-- ============================================================================
-- ROLES: admin (todo, incluye usuarios y ajustes), desk/recepción
-- (operación completa: reservas, flota, clientes, tarifas, reportes) y
-- yard/patio (agenda de entregas y captura de handovers). `active` permite
-- desactivar sin borrar (audit_log referencia user_id: el historial nunca
-- se rompe).

ALTER TABLE admin_users ADD COLUMN role text NOT NULL DEFAULT 'admin'
  CHECK (role IN ('admin', 'desk', 'yard'));
ALTER TABLE admin_users ADD COLUMN active boolean NOT NULL DEFAULT true;

-- MANTENIMIENTO: cada unidad recuerda el odómetro de su último servicio;
-- needs_service se enciende al cerrar una devolución si la config global
-- (settings['maintenance'] = {enabled, intervalKm}) está activa y el
-- kilometraje recorrido desde el servicio supera el intervalo. El intervalo
-- vive en settings para ajustarse desde el panel sin tocar la BD.
ALTER TABLE vehicles ADD COLUMN last_service_odometer integer;
ALTER TABLE vehicles ADD COLUMN needs_service boolean NOT NULL DEFAULT false;
