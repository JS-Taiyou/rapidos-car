-- ============================================================================
-- MIGRACIÓN 008 — Prioridad de temporadas (ROADMAP Fase 6)
-- ============================================================================
-- Cuando dos temporadas se solapan, decide una regla explícita en vez del
-- orden accidental del SELECT: mayor prioridad gana (empate → la que empieza
-- antes). Las temporadas existentes arrancan en 0 (comportamiento estable).

ALTER TABLE seasons ADD COLUMN priority integer NOT NULL DEFAULT 0;
