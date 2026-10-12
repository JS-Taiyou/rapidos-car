// Puntos de entrega/recogida gestionables desde /admin/puntos. Cache en
// memoria con invalidación (patrón fleet-cache/tenant): el wizard y las
// páginas SSR leen memoria.
import { sql } from './db';

export interface PickupPoint {
  id: number;
  key: string;
  name: string;
  feeCents: number | null; // null = gratuito
  lat: number | null;
  lng: number | null;
  active: boolean;
  sortOrder: number;
}

const TTL_MS = 15 * 60 * 1000;

let version = 0;
let snapshot: PickupPoint[] | null = null;
let snapshotVersion = -1;
let snapshotAt = 0;
let inflight: Promise<PickupPoint[]> | null = null;

export function invalidatePickupPointsCache(): void {
  version++;
}

export async function getPickupPoints(activeOnly = true): Promise<PickupPoint[]> {
  if (snapshot && snapshotVersion === version && Date.now() - snapshotAt < TTL_MS) {
    return activeOnly ? snapshot.filter((p) => p.active) : snapshot;
  }
  if (!inflight) {
    inflight = (async () => {
      const rows = await sql`
        SELECT id, key, name, fee_cents, lat, lng, active, sort_order
        FROM pickup_points
        ORDER BY sort_order, id
      `;
      snapshot = rows.map((r) => ({
        id: Number(r.id),
        key: r.key as string,
        name: r.name as string,
        feeCents: r.fee_cents === null ? null : Number(r.fee_cents),
        lat: r.lat === null ? null : Number(r.lat),
        lng: r.lng === null ? null : Number(r.lng),
        active: Boolean(r.active),
        sortOrder: Number(r.sort_order),
      }));
      snapshotVersion = version;
      snapshotAt = Date.now();
      return snapshot;
    })();
  }
  try {
    const all = await inflight;
    return activeOnly ? all.filter((p) => p.active) : all;
  } finally {
    inflight = null;
  }
}
