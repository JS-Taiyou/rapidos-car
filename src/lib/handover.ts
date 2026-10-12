// Checklists de entrega/devolución (ROADMAP Fase 3). Configurables por
// tenant en settings['handover_checklists']; estos son los defaults sanos
// para arrancar. La captura la hace el staff en el patio (tablet/móvil).
import { sql } from './db';

export interface ChecklistItem {
  id: string;
  label: string;
  defaultChecked: boolean;
}

export interface HandoverChecklists {
  out: ChecklistItem[];
  in: ChecklistItem[];
}

export const DEFAULT_CHECKLISTS: HandoverChecklists = {
  out: [
    { id: 'fuel', label: 'Tanque lleno', defaultChecked: true },
    { id: 'odometer', label: 'Odómetro registrado', defaultChecked: true },
    { id: 'damages', label: 'Rayones y golpes revisados con el cliente', defaultChecked: false },
    { id: 'tires', label: 'Llantas y refacción en buen estado', defaultChecked: true },
    { id: 'docs', label: 'Contrato y documentos entregados', defaultChecked: false },
    { id: 'bluetooth', label: 'Bluetooth / clima configurados', defaultChecked: false },
  ],
  in: [
    { id: 'damages', label: 'Daños nuevos revisados', defaultChecked: false },
    { id: 'fuel', label: 'Combustible al mismo nivel', defaultChecked: true },
    { id: 'cleanliness', label: 'Limpieza revisada', defaultChecked: true },
    { id: 'belongings', label: 'Sin objetos olvidados', defaultChecked: true },
    { id: 'keys', label: 'Llaves y controles devueltos', defaultChecked: true },
  ],
};

function coerceChecklist(raw: unknown, fallback: ChecklistItem[]): ChecklistItem[] {
  if (!Array.isArray(raw)) return fallback;
  const items = raw
    .filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null)
    .map((x, i) => ({
      id: String(x.id ?? `item${i}`).replace(/[^a-z0-9_-]/gi, '').slice(0, 40) || `item${i}`,
      label: String(x.label ?? '').slice(0, 120),
      defaultChecked: x.defaultChecked === true,
    }))
    .filter((x) => x.label.length > 0);
  return items.length > 0 ? items : fallback;
}

// Se lee por request (la edición en Ajustes es poco frecuente y la página de
// entregas la pide una vez por carga): sin cache de módulo.
export async function getHandoverChecklists(): Promise<HandoverChecklists> {
  const rows = await sql`SELECT value FROM settings WHERE key = 'handover_checklists'`;
  const raw = rows[0]?.value as { out?: unknown; in?: unknown } | undefined;
  if (!raw) return DEFAULT_CHECKLISTS;
  return {
    out: coerceChecklist(raw.out, DEFAULT_CHECKLISTS.out),
    in: coerceChecklist(raw.in, DEFAULT_CHECKLISTS.in),
  };
}
