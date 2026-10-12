// Motor de precios (la otra mitad del showcase, spec §9). computeQuote es
// FUNCIÓN PURA: no toca BD; recibe seasons/extrasCatalog/settings ya
// cargados por el caller (evita N+1 en /api/quote, que cotiza todos los
// modelos a la vez). Dinero en centavos enteros SIEMPRE (§2.13).
import type postgres from 'postgres';
import type { Sql } from './db';
import type { ModelAvailability } from './availability';
import { getPickupPoints } from './pickup-points';

export interface Season {
  name: string;
  /** [from, to) en YYYY-MM-DD, límites del daterange */
  period: [string, string];
  multiplier: number;
}

export interface Extra {
  id: number;
  name: string;
  priceCents: number;
  per: 'day' | 'rental';
}

export interface Settings {
  ivaRate: number;
  pickupPoints: Array<{ key: string; feeCents: number | null }>;
  longRentalDiscounts: Array<{ minDays: number; pct: number }>;
  turnaroundBufferMinutes: number;
  whatsappStaffNumber: string;
}

export interface PricingContext {
  seasons: Season[];
  extrasCatalog: Extra[];
  settings: Settings;
}

export interface PriceBreakdown {
  days: Array<{ date: string; seasonName: string | null; multiplier: number; cents: number }>;
  daysCount: number;
  subtotalCents: number;
  discountPct: number;
  extrasCents: number;
  deliveryFeeCents: number;
  taxCents: number;
  totalCents: number;
  depositCents: number;
}

// type alias (no interface): los alias reciben firma de índice implícita y
// así postgres.js los acepta como JSONValue en sql.json().
export type ExtraSnapshot = {
  name: string;
  price_cents: number;
  per: 'day' | 'rental';
  qty: number;
};

export type QuoteResult = ModelAvailability & { price: PriceBreakdown };

// "YYYY-MM-DD" del día calendario en la zona del negocio (CST fijo, sin DST).
function meridaDateKey(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Merida',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function computeQuote(
  model: ModelAvailability,
  start: Date,
  end: Date,
  pickupZone: string,
  selectedExtras: Array<{ id: number; qty: number }>,
  ctx: PricingContext,
  returnZone: string = pickupZone,
): PriceBreakdown {
  // Días = bloques de 24 h con ceil (26 h = 2 días, estándar de renta).
  const ms = end.getTime() - start.getTime();
  const daysCount = Math.max(1, Math.ceil(ms / 86_400_000));

  // Precio POR DÍA con suma diaria: una renta que cruza de temporada baja a
  // alta paga cada día según la temporada que lo contiene.
  const days: PriceBreakdown['days'] = [];
  let subtotalCents = 0;
  for (let i = 0; i < daysCount; i++) {
    const dayDate = new Date(start.getTime() + i * 86_400_000);
    const key = meridaDateKey(dayDate);
    const season = ctx.seasons.find(
      (s) => key >= s.period[0] && key < s.period[1],
    );
    const multiplier = season ? season.multiplier : 1;
    const cents = Math.round(model.dailyRateCents * multiplier);
    days.push({
      date: key,
      seasonName: season?.name ?? null,
      multiplier,
      cents,
    });
    subtotalCents += cents;
  }

  // Descuento por renta larga: SOLO sobre el subtotal de días.
  let discountPct = 0;
  for (const rule of ctx.settings.longRentalDiscounts) {
    if (daysCount >= rule.minDays) discountPct = Math.max(discountPct, rule.pct);
  }
  if (discountPct > 0) {
    subtotalCents = Math.round(subtotalCents * (1 - discountPct / 100));
  }

  // Extras: precio del catálogo EN ESTE MOMENTO (el snapshot se persiste en
  // bookings.extras). ids desconocidos se ignoran (defensa en profundidad).
  let extrasCents = 0;
  for (const sel of selectedExtras) {
    const extra = ctx.extrasCatalog.find((e) => e.id === sel.id);
    if (!extra) continue;
    extrasCents +=
      extra.per === 'day' ? extra.priceCents * sel.qty * daysCount : extra.priceCents * sel.qty;
  }

  // Tarifa de servicio: entrega en pickupZone + recogida en returnZone
  // cuando son puntos distintos (recoger el auto en otro punto también
  // cuesta: es un traslado del staff). Mismo punto = una sola tarifa.
  const feeOf = (key: string) =>
    ctx.settings.pickupPoints.find((p) => p.key === key)?.feeCents ?? 0;
  const deliveryFeeCents =
    feeOf(pickupZone) + (returnZone !== pickupZone ? feeOf(returnZone) : 0);

  // IVA AL FINAL sobre la base completa (cuadra con facturación mexicana).
  const taxCents = Math.round((subtotalCents + extrasCents + deliveryFeeCents) * ctx.settings.ivaRate);
  const totalCents = subtotalCents + extrasCents + deliveryFeeCents + taxCents;
  const depositCents = Math.round(totalCents * 0.2);

  return {
    days,
    daysCount,
    subtotalCents,
    discountPct,
    extrasCents,
    deliveryFeeCents,
    taxCents,
    totalCents,
    depositCents,
  };
}

// Snapshot de extras para persistir en bookings.extras: nombre y precio del
// catálogo en este momento, no lo que mandó el cliente.
export function snapshotExtras(
  selectedExtras: Array<{ id: number; qty: number }>,
  ctx: PricingContext,
): ExtraSnapshot[] {
  const snapshot: ExtraSnapshot[] = [];
  for (const sel of selectedExtras) {
    const extra = ctx.extrasCatalog.find((e) => e.id === sel.id);
    if (!extra) continue;
    snapshot.push({ name: extra.name, price_cents: extra.priceCents, per: extra.per, qty: sel.qty });
  }
  return snapshot;
}

// ---------------------------------------------------------------------------
// Overrides de precio (staff): la base SIEMPRE la calcula el motor; el staff
// puede sustituir tarifa diaria, precios de extras y aplicar un descuento
// explícito. Todo queda registrado con procedencia.
// ---------------------------------------------------------------------------
export interface PricingOverrides {
  /** Tarifa diaria fija a mano (centavos) — sustituye la del catálogo. */
  dailyRateCents?: number;
  /** Extras con qty y precio EDITABLE por el staff. */
  extras?: Array<{ id: number; qty: number; priceCents: number }>;
  /** Descuento explícito (reemplaza el automático por renta larga). */
  discount?: { kind: 'pct' | 'amount'; value: number };
  /** Motivo del ajuste — obligatorio si hay cualquier override. */
  reason?: string;
}

// type alias (no interface): firma de índice implícita para sql.json().
export type PricingRecord = PriceBreakdown & {
  extras: Array<{ id?: number; name: string; priceCents: number; per: 'day' | 'rental'; qty: number }>;
  dailyRateCents: number;
  discount:
    | { kind: 'none' | 'auto' }
    | { kind: 'pct' | 'amount'; value: number; cents: number; reason: string };
  pickupZone: string;
  source: 'engine' | 'manual' | 'adjust';
  reason?: string;
  editedBy?: string;
  editedAt?: string;
};

export function buildPricingRecord(
  quote: PriceBreakdown,
  meta: {
    dailyRateCents: number;
    extras: PricingRecord['extras'];
    pickupZone: string;
    discount: PricingRecord['discount'];
    source: PricingRecord['source'];
    reason?: string;
    editedBy?: string;
  },
): PricingRecord {
  return {
    ...quote,
    dailyRateCents: meta.dailyRateCents,
    extras: meta.extras,
    discount: meta.discount,
    pickupZone: meta.pickupZone,
    source: meta.source,
    reason: meta.reason,
    editedBy: meta.editedBy,
    ...(meta.editedBy ? { editedAt: new Date().toISOString() } : {}),
  };
}

// Aplica los overrides del staff sobre un desglose calculado por el motor.
// Recalcula TODA la cadena (días → descuento → extras → entrega → IVA) para
// que el total siga siendo coherente: nunca se pisa el total a ciegas.
export function applyPricingOverrides(
  base: PriceBreakdown,
  model: ModelAvailability,
  start: Date,
  end: Date,
  overrides: PricingOverrides,
  ctx: PricingContext,
): PriceBreakdown {
  const daysCount = base.daysCount;
  const dailyRateCents = overrides.dailyRateCents ?? model.dailyRateCents;

  // Días recalculados con la tarifa (posiblemente fijada a mano) y los
  // multiplicadores de temporada originales del desglose base.
  const days = base.days.map((d) => ({
    ...d,
    cents: Math.round(dailyRateCents * d.multiplier),
  }));
  let subtotalCents = days.reduce((sum, d) => sum + d.cents, 0);

  // Descuento: el explícito del staff REEMPLAZA el automático por renta larga.
  let discountPct = 0;
  let discountCents = 0;
  let discountKind: 'none' | 'auto' | 'pct' | 'amount' = 'none';
  if (overrides.discount) {
    discountKind = overrides.discount.kind;
    if (overrides.discount.kind === 'pct') {
      discountPct = overrides.discount.value;
      discountCents = Math.round((subtotalCents * discountPct) / 100);
    } else {
      discountCents = Math.min(overrides.discount.value, subtotalCents);
    }
  } else if (base.discountPct > 0) {
    discountKind = 'auto';
    discountPct = base.discountPct;
    discountCents = subtotalCents - Math.round(subtotalCents * (1 - discountPct / 100));
  }
  subtotalCents -= discountCents;

  // Extras con precio editable por el staff (fallback al catálogo).
  let extrasCents = 0;
  const selected = overrides.extras ?? [];
  for (const sel of selected) {
    const catalog = ctx.extrasCatalog.find((e) => e.id === sel.id);
    const priceCents = sel.priceCents ?? catalog?.priceCents ?? 0;
    const per = catalog?.per ?? 'rental';
    extrasCents += per === 'day' ? priceCents * sel.qty * daysCount : priceCents * sel.qty;
  }

  const deliveryFeeCents = base.deliveryFeeCents;
  const taxCents = Math.round((subtotalCents + extrasCents + deliveryFeeCents) * ctx.settings.ivaRate);
  const totalCents = subtotalCents + extrasCents + deliveryFeeCents + taxCents;

  return {
    ...base,
    days,
    subtotalCents,
    discountPct,
    extrasCents,
    deliveryFeeCents,
    taxCents,
    totalCents,
    depositCents: Math.round(totalCents * 0.2),
  };
}

// daterange de Postgres llega como texto '[2025-12-15,2026-01-06)'.
function parseDaterange(raw: string): [string, string] {
  const body = raw.slice(1, -1);
  const [from, to] = body.split(',');
  return [from.trim(), (to ?? '').trim()];
}

// jsonb puede llegar doble-codificado como string (registro histórico):
// parse defensivo antes de usar.
function parseMaybeJson<T>(value: unknown): T[] {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T[];
    } catch {
      return [];
    }
  }
  return Array.isArray(value) ? (value as T[]) : [];
}

// Carga el contexto de precios (seasons/extras/settings) UNA sola vez para
// inyectárselo a computeQuote. Extraída a este módulo (lo sanciona la guía
// de /api/bookings: "si crece, extrae loadPricingContext(sql) a pricing.ts")
// para no duplicar las ~30 líneas entre /api/quote y /api/bookings.
export async function loadPricingContext(sql: Sql): Promise<PricingContext> {
  const [seasonRows, extraRows, settingRows] = await Promise.all([
    sql`SELECT id, name, period, multiplier FROM seasons`,
    sql`SELECT id, name, price_cents, per FROM extras WHERE active = true`,
    sql`SELECT key, value FROM settings`,
  ]);

  const settingsMap = Object.fromEntries(
    settingRows.map((r) => [r.key, r.value]),
  ) as Record<string, unknown>;

  const rawZones = parseMaybeJson<{ zone: string; fee_cents: number }>(
    settingsMap.delivery_zones ?? [],
  );
  const rawDiscounts = parseMaybeJson<{ min_days: number; pct: number }>(
    settingsMap.long_rental_discounts ?? [],
  );

  const points = (await getPickupPoints()).map((p) => ({ key: p.key, feeCents: p.feeCents }));

  return {
    seasons: (seasonRows as unknown as Array<{ name: string; period: string; multiplier: string | number }>).map(
      (r) => ({
        name: r.name,
        period: parseDaterange(r.period),
        multiplier: Number(r.multiplier),
      }),
    ),
    extrasCatalog: (
      extraRows as unknown as Array<{ id: number; name: string; price_cents: number; per: 'day' | 'rental' }>
    ).map((r) => ({
      id: Number(r.id),
      name: r.name,
      priceCents: Number(r.price_cents),
      per: r.per,
    })),
    settings: {
      ivaRate: Number(settingsMap.iva_rate ?? 0),
      pickupPoints: points,

      longRentalDiscounts: rawDiscounts.map((d) => ({ minDays: Number(d.min_days), pct: Number(d.pct) })),
      turnaroundBufferMinutes: Number(settingsMap.turnaround_buffer_minutes ?? 0),
      whatsappStaffNumber: String(settingsMap.whatsapp_staff_number ?? ''),
    },
  };
}

// Parámetro jsonb listo para sql.json(): PricingRecord es JSON por
// construcción; el cast existe porque las intersecciones de tipos no
// obtienen firma de índice implícita en TS (postgres.js la exige).
export function pricingJson(record: object): postgres.JSONValue {
  return record as unknown as postgres.JSONValue;
}
