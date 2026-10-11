// Snapshot en memoria del catálogo de flota (/flota y /en/fleet).
//
// El catálogo NO consulta disponibilidad (ni taller ni fechas — eso vive en
// /api/quote dentro del embudo), así que su resultado es función pura de
// vehicle_models/vehicles: entre mutaciones de flota, el HTML es siempre el
// mismo. El primer visitante paga la query; todos los demás reciben el
// snapshot de memoria (local ~1ms; con Supabase remoto ahorra 50–200ms por
// visita).
//
// INVALIDACIÓN: exacta por versión — los endpoints /api/admin/vehicles
// (alta/edición/borrado lógico de modelos y unidades) llaman
// invalidateFleetCache() al mutar. Válido porque el despliegue es UN
// proceso Node standalone (ARCHITECTURE §2.14): el contador vive en el
// mismo módulo que las páginas. Si algún día se despliega serverless (§8,
// N instancias sin memoria compartida), el TTL de 15 min acota el stale.
//
// El catálogo completo (28 renglones) se cachea sin filtro: el ?cat= se
// filtra en JS — una entrada de cache menos y sin invalidación extra.
import { sql } from './db';

export interface CatalogModel {
  slug: string;
  name: string;
  category: string;
  transmission: string;
  seats: number;
  luggage: number;
  dailyRateCents: number;
  photos: string[];
}

const TTL_MS = 15 * 60 * 1000;

let fleetVersion = 0;
let snapshot: CatalogModel[] | null = null;
let snapshotVersion = -1;
let snapshotAt = 0;
let inflight: Promise<CatalogModel[]> | null = null;

// La llaman los endpoints de admin tras mutar flota.
export function invalidateFleetCache(): void {
  fleetVersion++;
}

export async function getFleetCatalog(): Promise<CatalogModel[]> {
  const fresh =
    snapshot !== null &&
    snapshotVersion === fleetVersion &&
    Date.now() - snapshotAt < TTL_MS;
  if (fresh) return snapshot!;

  // Deduplica ráfagas concurrentes (thundering herd): todos esperan la
  // MISMA query en vuelo.
  if (!inflight) {
    inflight = (async () => {
      const rows = await sql`
        SELECT m.slug, m.name, m.category, m.transmission, m.seats,
               m.luggage, m.daily_rate_cents, m.photos
        FROM vehicle_models m
        WHERE m.active = true
        ORDER BY m.daily_rate_cents ASC
      `;
      const models: CatalogModel[] = rows.map((r) => ({
        slug: r.slug as string,
        name: r.name as string,
        category: r.category as string,
        transmission: r.transmission as string,
        seats: Number(r.seats),
        luggage: Number(r.luggage),
        dailyRateCents: Number(r.daily_rate_cents),
        photos: (r.photos as string[]) ?? [],
      }));
      snapshot = models;
      snapshotVersion = fleetVersion;
      snapshotAt = Date.now();
      return models;
    })();
  }
  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}
