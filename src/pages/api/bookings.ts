// POST /api/bookings — crea reservación (EL endpoint crítico del MVP).
// NUNCA confía en totales del cliente: el servidor recalcula con computeQuote
// (ARCHITECTURE §2.9). Dos líneas de defensa: pickFreeUnit con FOR UPDATE
// (serializa la carrera por placa) y la constraint no_overlap (si aun así
// hay solape, Postgres lanza 23P01 → mismo 409).
import type { APIContext } from 'astro';
import { sql, type Sql } from '../../lib/db';
import { pickFreeUnit, type ModelAvailability } from '../../lib/availability';
import {
  computeQuote,
  loadPricingContext,
  snapshotExtras,
  type PricingContext,
  type PriceBreakdown,
} from '../../lib/pricing';
import { bookingInputSchema, generateBookingCode } from '../../lib/validation';
import { buildWhatsAppUrl, bookingConfirmationMessage } from '../../lib/whatsapp';

export const prerender = false;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function fetchModel(
  sqlTx: Sql,
  modelSlug: string,
): Promise<ModelAvailability | null> {
  const rows = await sqlTx`
    SELECT slug, name, category, transmission, seats, luggage,
           daily_rate_cents, photos
    FROM vehicle_models
    WHERE slug = ${modelSlug} AND active = true
    LIMIT 1
  `;
  const r = rows[0];
  if (!r) return null;
  return {
    slug: r.slug as string,
    name: r.name as string,
    category: r.category as string,
    transmission: r.transmission as string,
    seats: Number(r.seats),
    luggage: Number(r.luggage),
    dailyRateCents: Number(r.daily_rate_cents),
    photos: (r.photos as string[]) ?? [],
    unitsAvailable: 0,
  };
}

export async function POST(context: APIContext): Promise<Response> {
  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const parsed = bookingInputSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: 'validation', issues: parsed.error.issues }, 400);
  }
  const { modelSlug, start, end, pickupZone, extras, customer, depositType, lang } = parsed.data;

  // Carga el ctx de precios ANTES de la transacción (lo mismo que
  // /api/quote). Validación de extras contra el catálogo activo.
  const ctx: PricingContext = await loadPricingContext(sql);
  const unknownExtra = extras.find((sel) => !ctx.extrasCatalog.some((e) => e.id === sel.id));
  if (unknownExtra) {
    return json({ error: 'unknown_extra', id: unknownExtra.id }, 400);
  }

  const buffer = ctx.settings.turnaroundBufferMinutes;
  const snapshot = snapshotExtras(extras, ctx);

  try {
    const result = await sql.begin(async (sqlTx) => {
      const unitId = await pickFreeUnit(sqlTx, modelSlug, start, end, buffer);
      if (unitId === null) {
        // Sentinel, no excepción: aún no se escribió nada; el COMMIT vacío
        // equivale al rollback.
        return { unavailable: true as const };
      }

      const model = await fetchModel(sqlTx, modelSlug);
      if (!model) return { unavailable: true as const };

      // Recalculado en servidor: puro, no alarga la transacción.
      const quote: PriceBreakdown = computeQuote(model, start, end, pickupZone, extras, ctx);

      // Retry por 23505 de code duplicado (probabilidad ~0; importa el
      // patrón generar → insertar → reintentar).
      let inserted: { id: number; code: string } | undefined;
      for (let attempt = 0; attempt < 3 && !inserted; attempt++) {
        const code = generateBookingCode();
        try {
          const rows = await sqlTx`
            INSERT INTO bookings
              (code, kind, vehicle_id, customer_name, customer_email,
               customer_phone, flight_number, period, pickup_zone, extras,
               total_cents, deposit_type, status)
            VALUES
              (${code}, 'rental', ${unitId}, ${customer.name}, ${customer.email},
               ${customer.phone}, ${customer.flightNumber ?? null},
               tstzrange(${start}::timestamptz, ${end}::timestamptz, '[)'),
               ${pickupZone}, ${sql.json(snapshot)}::jsonb, ${quote.totalCents},
               ${depositType}, 'confirmed')
            RETURNING id, code
          `;
          inserted = { id: Number(rows[0].id), code: rows[0].code as string };
        } catch (err) {
          const pgErr = err as { code?: string };
          if (pgErr.code === '23505') continue;
          throw err;
        }
      }
      if (!inserted) throw new Error('no se pudo generar un código único');

      return { booking: { ...inserted, quote }, modelName: model.name };
    });

    if ('unavailable' in result) {
      // El wizard recarga el paso de autos (ARCHITECTURE §4).
      return json({ error: 'unavailable' }, 409);
    }

    // La renta web nace 'confirmed': los 'quoted' no apartan inventario.
    const { booking, modelName } = result;
    const message = bookingConfirmationMessage(
      {
        code: booking.code,
        modelName,
        start,
        end,
        pickupZone,
        totalCents: booking.quote.totalCents,
        depositCents: depositType === 'deposit' ? booking.quote.depositCents : 0,
      },
      lang,
    );
    // El deep link wa.me ES la notificación del MVP (spec §5): el mensaje
    // sale del teléfono del cliente hacia el negocio.
    const whatsappUrl = buildWhatsAppUrl(message, ctx.settings.whatsappStaffNumber);

    return json(
      {
        booking: {
          id: booking.id,
          code: booking.code,
          totalCents: booking.quote.totalCents,
          depositCents: depositType === 'deposit' ? booking.quote.depositCents : 0,
          period: { start: start.toISOString(), end: end.toISOString() },
        },
        whatsappUrl,
      },
      201,
    );
  } catch (err) {
    const pgErr = err as { code?: string };
    // La constraint es quien decide en la carrera final (exclusion_violation).
    if (pgErr.code === '23P01') {
      return json({ error: 'unavailable' }, 409);
    }
    console.error('POST /api/bookings falló:', err);
    return json({ error: 'internal' }, 500);
  }
}

export function ALL(): Response {
  return new Response(null, { status: 405, headers: { Allow: 'POST' } });
}
