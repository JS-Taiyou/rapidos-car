-- ============================================================================
-- MIGRACIÓN 007 — Log de auditoría (ROADMAP Fase 2)
-- ============================================================================
-- Quién hizo qué, cuándo y con qué evidencia del antes/después. Transversal:
-- todos los endpoints admin mutantes escriben aquí (y auth registra login
-- ok/fallo y logout). diff jsonb guarda {campo: {before, after}} — NUNCA
-- contraseñas ni hashes. user_email se denormaliza para que el registro
-- sobreviva al borrado del usuario.

CREATE TABLE audit_log (
  id         bigserial PRIMARY KEY,
  at         timestamptz NOT NULL DEFAULT now(),
  user_id    bigint REFERENCES admin_users(id),
  user_email text NOT NULL,
  action     text NOT NULL,   -- login|login_failed|logout|create|update|delete|status|reprice|edit|merge|export|...
  entity     text NOT NULL,   -- booking|segment|vehicle|model|customer|setting|point|extra|season|session|...
  entity_id  bigint,
  summary    text NOT NULL,   -- "RPZ-0012: confirmed → active"
  diff       jsonb,           -- {campo: {before, after}}
  ip         text,
  user_agent text
);

CREATE INDEX audit_log_at_idx ON audit_log (at DESC);
CREATE INDEX audit_log_entity_idx ON audit_log (entity, entity_id);
CREATE INDEX audit_log_user_idx ON audit_log (user_id, at DESC);
