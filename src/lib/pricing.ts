// Motor de precios (la otra mitad del showcase, spec §9). computeQuote es
// FUNCIÓN PURA: no toca BD; recibe seasons/extrasCatalog/settings ya
// cargados por el caller (evita N+1 en /api/quote, que cotiza todos los
// modelos a la vez). Dinero en centavos enteros SIEMPRE (§2.13).
import type { Sql } from './db';
import type { ModelAvailability } from './availability';

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
  deliveryZones: Array<{ zone: string; feeCents: number }>;
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

  const deliveryFeeCents =
    ctx.settings.deliveryZones.find((z) => z.zone === pickupZone)?.feeCents ?? 0;

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
      deliveryZones: rawZones.map((z) => ({ zone: z.zone, feeCents: Number(z.fee_cents) })),
      longRentalDiscounts: rawDiscounts.map((d) => ({ minDays: Number(d.min_days), pct: Number(d.pct) })),
      turnaroundBufferMinutes: Number(settingsMap.turnaround_buffer_minutes ?? 0),
      whatsappStaffNumber: String(settingsMap.whatsapp_staff_number ?? ''),
    },
  };
}
