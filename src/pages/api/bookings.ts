// POST /api/bookings — crea reservación (EL endpoint crítico del MVP).
// NUNCA confía en totales del cliente: el servidor recalcula con computeQuote
// (ARCHITECTURE §2.9). Dos líneas de defensa: pickFreeUnit con FOR UPDATE
// (serializa la carrera por placa) y la constraint no_overlap_segment (si aun
// así hay solape, Postgres lanza 23P01 → mismo 409).
// Desde la migración 006 la renta nace en DOS filas: la cabecera (bookings)
// y su tramo 1 (booking_segments, que es donde vive la unidad).
import type { APIContext } from 'astro';
import { sql, type Sql } from '../../lib/db';
import { pickFreeUnit, type ModelAvailability } from '../../lib/availability';
import {
  computeQuote,
  loadPricingContext,
  snapshotExtras,
  buildPricingRecord,
  pricingJson,
  type PricingContext,
  type PriceBreakdown,
} from '../../lib/pricing';
import { bookingInputSchema, generateBookingCode } from '../../lib/validation';
import { buildWhatsAppUrl, bookingConfirmationMessage } from '../../lib/whatsapp';
import { broadcastNewBooking } from '../../lib/alerts';
import { linkBookingToCustomer } from '../../lib/customers';
import { getTenant } from '../../lib/tenant';

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
): Promise<(ModelAvailability & { id: number }) | null> {
  const rows = await sqlTx`
    SELECT id, slug, name, category, transmission, seats, luggage,
           daily_rate_cents, photos
    FROM vehicle_models
    WHERE slug = ${modelSlug} AND active = true
    LIMIT 1
  `;
  const r = rows[0];
  if (!r) return null;
  return {
    id: Number(r.id),
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
  const { modelSlug, start, end, pickupZone, returnZone, extras, customer, depositType, lang } = parsed.data;

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
      const quote: PriceBreakdown = computeQuote(model, start, end, pickupZone, extras, ctx, returnZone ?? pickupZone);

      // Desglose completo con procedencia: qué se cotizó, con qué reglas y
      // quién lo calculó (engine = el motor, sin intervención humana).
      const pricing = buildPricingRecord(quote, {
        dailyRateCents: model.dailyRateCents,
        extras: snapshot.map((e) => ({ name: e.name, priceCents: e.price_cents, per: e.per, qty: e.qty })),
        pickupZone,
        discount: quote.discountPct > 0 ? { kind: 'auto' } : { kind: 'none' },
        source: 'engine',
      });

      // El pedido del cliente, congelado: aunque el staff mueva fechas,
      // modelo o extras después, aquí queda el original para el diff del
      // panel ("Reservación original") y el follow-up.
      const requested = {
        channel: 'web' as const,
        model: { slug: model.slug, name: model.name },
        start: start.toISOString(),
        end: end.toISOString(),
        pickupZone,
        returnZone: returnZone ?? pickupZone,
        extras: snapshot.map((e) => ({ name: e.name, price_cents: e.price_cents, per: e.per, qty: e.qty })),
        customer: {
          name: customer.name,
          email: customer.email,
          phone: customer.phone,
          flightNumber: customer.flightNumber ?? null,
        },
        totalCents: quote.totalCents,
        createdAt: new Date().toISOString(),
      };

      // Retry por 23505 de code duplicado (probabilidad ~0; importa el
      // patrón generar → insertar → reintentar). La renta web nace
      // 'confirmed' → su tramo 1 nace 'reserved' (aparta la unidad).
      let inserted: { id: number; code: string } | undefined;
      for (let attempt = 0; attempt < 3 && !inserted; attempt++) {
        const code = generateBookingCode();
        try {
          const rows = await sqlTx`
            INSERT INTO bookings
              (code, kind, customer_name, customer_email, customer_phone,
               flight_number, total_cents, deposit_type, status, pricing, requested)
            VALUES
              (${code}, 'rental', ${customer.name}, ${customer.email},
               ${customer.phone}, ${customer.flightNumber ?? null},
               ${pricing.totalCents}, ${depositType}, 'confirmed',
               ${sql.json(pricingJson(pricing))}::jsonb, ${sql.json(requested)}::jsonb)
            RETURNING id, code
          `;
          inserted = { id: Number(rows[0].id), code: rows[0].code as string };
          await sqlTx`
            INSERT INTO booking_segments
              (booking_id, idx, model_id, vehicle_id, period, status,
               pricing, total_cents, extras, pickup_zone, return_zone)
            VALUES
              (${inserted.id}, 1, ${model.id}, ${unitId},
               tstzrange(${start}::timestamptz, ${end}::timestamptz, '[)'),
               'reserved', ${sql.json(pricingJson(pricing))}::jsonb,
               ${pricing.totalCents}, ${sql.json(snapshot)}::jsonb,
               ${pickupZone}, ${returnZone ?? pickupZone})
          `;
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
      // El wizard recarga el paso de autos (ARCHITECTURE §4)… pero el
      // cliente YA decidió reservar: es un lead que merece follow-up. Se
      // captura como booking status='quoted' + tramo 'quoted' — la
      // constraint de exclusión ignora esos estados, así que NO aparta
      // inventario; el staff la ve en el tablero, ajusta fechas/modelo/extras
      // y confirma (el tramo pasa a 'reserved' al confirmar). Best-effort:
      // si el insert falla, el 409 no se enmascara.
      try {
        const model = await fetchModel(sql, modelSlug);
        const refUnit = model
          ? await sql`SELECT v.id, v.model_id FROM vehicles v JOIN vehicle_models m ON m.id = v.model_id
                      WHERE m.slug = ${modelSlug} ORDER BY v.id LIMIT 1`
          : [];
        if (model && refUnit.length > 0) {
          const quote = computeQuote(model, start, end, pickupZone, extras, ctx, returnZone ?? pickupZone);
          const lead = {
            channel: 'web' as const,
            model: { slug: model.slug, name: model.name },
            start: start.toISOString(),
            end: end.toISOString(),
            pickupZone,
            extras: snapshot.map((e) => ({ name: e.name, price_cents: e.price_cents, per: e.per, qty: e.qty })),
            customer: {
              name: customer.name,
              email: customer.email,
              phone: customer.phone,
              flightNumber: customer.flightNumber ?? null,
            },
            totalCents: quote.totalCents,
            createdAt: new Date().toISOString(),
            reason: 'sin_disponibilidad',
          };
          const pricing = buildPricingRecord(quote, {
            dailyRateCents: model.dailyRateCents,
            extras: snapshot.map((e) => ({ name: e.name, priceCents: e.price_cents, per: e.per, qty: e.qty })),
            pickupZone,
            discount: { kind: 'none' },
            source: 'engine',
          });
          const rows2 = await sql`
            INSERT INTO bookings
              (code, kind, customer_name, customer_email, customer_phone,
               flight_number, total_cents, deposit_type, status, pricing, requested, notes)
            VALUES
              (${generateBookingCode()}, 'rental', ${customer.name},
               ${customer.email}, ${customer.phone}, ${customer.flightNumber ?? null},
               ${quote.totalCents}, ${depositType}, 'quoted',
               ${sql.json(pricingJson(pricing))}::jsonb,
               ${sql.json(lead)}::jsonb, 'Lead web: sin disponibilidad al intentar reservar')
            RETURNING id, code
          `;
          await sql`
            INSERT INTO booking_segments
              (booking_id, idx, model_id, vehicle_id, period, status,
               pricing, total_cents, extras, pickup_zone, return_zone)
            VALUES
              (${Number(rows2[0].id)}, 1, ${Number(refUnit[0].model_id)},
               ${Number(refUnit[0].id)},
               tstzrange(${start}::timestamptz, ${end}::timestamptz, '[)'),
               'quoted', ${sql.json(pricingJson(pricing))}::jsonb,
               ${quote.totalCents}, ${sql.json(snapshot)}::jsonb,
               ${pickupZone}, ${returnZone ?? pickupZone})
          `;
          try {
            await linkBookingToCustomer(sql, Number(rows2[0].id), {
              name: customer.name,
              email: customer.email,
              phone: customer.phone,
            });
          } catch {
            // best-effort: el lead vive aunque el vínculo falle
          }
          broadcastNewBooking({
            id: Number(rows2[0].id),
            code: rows2[0].code as string,
            kind: 'lead',
            modelName: model.name,
            customerName: customer.name,
            start: start.toISOString(),
            end: end.toISOString(),
            totalCents: quote.totalCents,
          });
        }
      } catch (leadErr) {
        console.error('No se pudo capturar el lead del 409:', leadErr);
      }
      return json({ error: 'unavailable' }, 409);
    }

    // La renta web nace 'confirmed': los 'quoted' no apartan inventario.
    const { booking, modelName } = result;

    // CRM: find-or-link del cliente (best-effort: si falla, la reservación
    // vive; el vínculo se puede crear después desde el expediente).
    try {
      await linkBookingToCustomer(sql, result.booking.id, {
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
      });
    } catch (crmErr) {
      console.error('CRM: no se pudo vincular el cliente:', crmErr);
    }

    // Push en vivo a las pestañas del staff conectadas (globito + beep).
    broadcastNewBooking({
      id: booking.id,
      code: booking.code,
      kind: 'rental',
      modelName,
      customerName: customer.name,
      start: start.toISOString(),
      end: end.toISOString(),
      totalCents: booking.quote.totalCents,
    });
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
      (await getTenant()).name,
    );
    // El deep link wa.me ES la notificación del MVP (spec §5): el mensaje
    // sale del teléfono del cliente hacia el negocio.
    const whatsappUrl = buildWhatsAppUrl(message, (await getTenant()).staffWhatsapp);

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
