// Mantenimiento por kilometraje (ROADMAP posterior): intervalo global
// configurable en Ajustes (settings['maintenance'] = {enabled, intervalKm});
// al cerrar cada devolución se compara el odómetro contra el último
// servicio de la unidad y se enciende needs_service. La unidad no se
// bloquea sola: el staff decide cuándo mandarla a taller.
import { sql } from './db';

export interface MaintenanceConfig {
  enabled: boolean;
  intervalKm: number;
}

const DEFAULTS: MaintenanceConfig = { enabled: false, intervalKm: 5000 };

export async function getMaintenanceConfig(): Promise<MaintenanceConfig> {
  const rows = await sql`SELECT value FROM settings WHERE key = 'maintenance'`;
  const raw = rows[0]?.value as Partial<MaintenanceConfig> | undefined;
  if (!raw) return DEFAULTS;
  return {
    enabled: raw.enabled === true,
    intervalKm: Number.isFinite(Number(raw.intervalKm)) && Number(raw.intervalKm) > 0 ? Number(raw.intervalKm) : DEFAULTS.intervalKm,
  };
}

// Evalúa una unidad tras registrar su odómetro de devolución. Devuelve el
// aviso para el staff (null si no aplica). Primera vez que se ve la unidad:
// fija la base (last_service_odometer) sin encender la bandera.
export async function evaluateMaintenance(
  vehicleId: number,
  odometerIn: number,
): Promise<{ serviceDue: true; kmSinceService: number; intervalKm: number } | null> {
  const config = await getMaintenanceConfig();
  if (!config.enabled) return null;

  const rows = await sql`
    SELECT last_service_odometer FROM vehicles WHERE id = ${vehicleId}
  `;
  const unit = rows[0];
  if (!unit) return null;

  if (unit.last_service_odometer === null) {
    await sql`UPDATE vehicles SET last_service_odometer = ${odometerIn} WHERE id = ${vehicleId}`;
    return null;
  }

  const kmSinceService = odometerIn - Number(unit.last_service_odometer);
  if (kmSinceService < config.intervalKm) return null;

  await sql`UPDATE vehicles SET needs_service = true WHERE id = ${vehicleId}`;
  return { serviceDue: true, kmSinceService, intervalKm: config.intervalKm };
}
