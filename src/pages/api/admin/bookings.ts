// /api/admin/bookings — GET lista con filtros · POST captura manual/bloqueo
// (spec §4.3). Desde la migración 006 la renta es cabecera (bookings) +
// tramos (booking_segments): el GET agrega la línea de tiempo con LATERAL y
// el POST crea ambas filas. kind='block' sigue siendo una renta de 1 tramo
// (§2.10): la constraint no_overlap_segment lo cubre gratis, pero SOLO si el
// tramo nace 'reserved' (el WHERE parcial de la constraint ignora otros
// estados).
import type { APIContext } from 'astro';
import { sql, type Sql } from '../../../lib/db';
import { requireAdminApi } from '../../../lib/auth';
import { pickFreeUnit, isUnitFree, type ModelAvailability } from '../../../lib/availability';
import {
  computeQuote,
  loadPricingContext,
  snapshotExtras,
  applyPricingOverrides,
  buildPricingRecord,
  pricingJson,
} from '../../../lib/pricing';
import { manualBookingSchema, generateBookingCode } from '../../../lib/validation';
import type { ManualBookingInput } from '../../../lib/validation';
import { linkBookingToCustomer } from '../../../lib/customers';
import { logAudit } from '../../../lib/audit';

export const prerender = false;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function GET(context: APIContext): Promise<Response> {
  const admin = await requireAdminApi(context.cookies, ['admin', 'desk']);
  if (!admin) return json({ error: 'unauthorized' }, 401);

  const params = context.url.searchParams;
  const from = params.get('from');
  const to = params.get('to');
  const status = params.get('status');
  const kind = params.get('kind');

  // WHERE dinámico con fragments de postgres.js: NUNCA concatenar strings
  // de SQL (inyección); los fragments escapan los valores.
  const conds = [
    sql`TRUE`,
    ...(from && to
      ? [
          sql`EXISTS (
            SELECT 1 FROM booking_segments s
            WHERE s.booking_id = b.id
              AND s.period && tstzrange(${from}::timestamptz, ${to}::timestamptz, '[)')
          )`,
        ]
      : []),
    ...(status ? [sql`b.status = ${status}`] : []),
    ...(kind ? [sql`b.kind = ${kind}`] : []),
  ];
  const where = conds.reduce((acc, c) => sql`${acc} AND ${c}`);

  // Agregado de la línea de tiempo: período total (min lower → max upper),
  // unidad/modelo/extras del PRIMER tramo (compat del board) y el arreglo
  // de tramos completo por idx (chips multi-vehículo del panel).
  const rows = await sql`
    SELECT b.*, agg.period_start, agg.period_end, agg.plate,
           agg.model_name, agg.model_slug, agg.extras, agg.segments
    FROM bookings b
    LEFT JOIN LATERAL (
      SELECT min(lower(s.period)) AS period_start,
             max(upper(s.period)) AS period_end,
             (array_agg(v.plate ORDER BY s.idx))[1] AS plate,
             (array_agg(m.name ORDER BY s.idx))[1] AS model_name,
             (array_agg(m.slug ORDER BY s.idx))[1] AS model_slug,
             (array_agg(s.extras ORDER BY s.idx))[1] AS extras,
             json_agg(json_build_object(
               'id', s.id, 'idx', s.idx, 'status', s.status,
               'model_slug', m.slug, 'model_name', m.name, 'plate', v.plate,
               'period_start', lower(s.period), 'period_end', upper(s.period),
               'total_cents', s.total_cents
             ) ORDER BY s.idx) AS segments
      FROM booking_segments s
      JOIN vehicle_models m ON m.id = s.model_id
      LEFT JOIN vehicles v ON v.id = s.vehicle_id
      WHERE s.booking_id = b.id
    ) agg ON true
    WHERE ${where}
    ORDER BY agg.period_start DESC
    LIMIT 200
  `;

  return json({ bookings: rows });
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
  const admin = await requireAdminApi(context.cookies, ['admin', 'desk']);
  if (!admin) return json({ error: 'unauthorized' }, 401);

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const parsed = manualBookingSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: 'validation', issues: parsed.error.issues }, 400);
  }

  const data = parsed.data;

  try {
    if (data.kind === 'block') {
      // Bloqueo: INSERT directo (sin pricing): customer NULL, total 0,
      // deposit 'on_pickup' como placeholder (el CHECK lo exige) y tramo
      // 'reserved' — en otro estado NO bloquearía la unidad. El refine del
      // schema garantiza vehicleId presente en los blocks.
      const blockVehicleId = data.vehicleId!;
      const rows = await sql`
        WITH new_block AS (
          INSERT INTO bookings
            (code, kind, total_cents, deposit_type, status, notes)
          VALUES
            (${generateBookingCode()}, 'block', 0, 'on_pickup', 'confirmed',
             ${data.notes ?? null})
          RETURNING id
        )
        INSERT INTO booking_segments
          (booking_id, idx, model_id, vehicle_id, period, status,
           pickup_zone, return_zone)
        SELECT nb.id, 1, v.model_id, v.id,
               tstzrange(${data.start}::timestamptz, ${data.end}::timestamptz, '[)'),
               'reserved', ${data.pickupZone}, ${data.returnZone ?? data.pickupZone}
        FROM new_block nb
        JOIN vehicles v ON v.id = ${blockVehicleId}
        RETURNING booking_id
      `;
      const created = await sql`
        SELECT b.*, agg.period_start, agg.period_end, agg.plate,
               agg.model_name, agg.model_slug, agg.segments
        FROM bookings b
        LEFT JOIN LATERAL (
          SELECT min(lower(s.period)) AS period_start,
                 max(upper(s.period)) AS period_end,
                 (array_agg(v.plate ORDER BY s.idx))[1] AS plate,
                 (array_agg(m.name ORDER BY s.idx))[1] AS model_name,
                 (array_agg(m.slug ORDER BY s.idx))[1] AS model_slug,
                 json_agg(json_build_object(
                   'id', s.id, 'idx', s.idx, 'status', s.status,
                   'model_slug', m.slug, 'model_name', m.name, 'plate', v.plate,
                   'period_start', lower(s.period), 'period_end', upper(s.period),
                   'total_cents', s.total_cents
                 ) ORDER BY s.idx) AS segments
          FROM booking_segments s
          JOIN vehicle_models m ON m.id = s.model_id
          LEFT JOIN vehicles v ON v.id = s.vehicle_id
          WHERE s.booking_id = b.id
        ) agg ON true
        WHERE b.id = ${Number(rows[0].booking_id)}
      `;
      await logAudit(sql, admin, {
        action: 'create',
        entity: 'booking',
        entityId: Number(rows[0].booking_id),
        summary: `Bloqueo ${created[0].code} creado (${data.start.toISOString().slice(0, 10)} → ${data.end.toISOString().slice(0, 10)})`,
      }, context);
      return json({ booking: created[0] }, 201);
    }

    // Captura manual (renta): MISMO flujo transaccional que el endpoint
    // público — todo con sqlTx, jamás el sql global.
    const ctx = await loadPricingContext(sql);
    const buffer = ctx.settings.turnaroundBufferMinutes;

    const result = await sql.begin(async (sqlTx) => {
      let unitId: number | null = null;
      if (data.vehicleId !== undefined) {
        // El admin eligió placa en el calendario: verifica esa unidad.
        const free = await isUnitFree(sqlTx, data.vehicleId, data.start, data.end, buffer);
        if (!free) return { unavailable: true as const };
        unitId = data.vehicleId;
      } else {
        unitId = await pickFreeUnit(sqlTx, data.modelSlug!, data.start, data.end, buffer);
      }
      if (unitId === null) return { unavailable: true as const };

      const model = await fetchModel(sqlTx, data.modelSlug!);
      if (!model) return { unavailable: true as const };

      // Base calculada por el motor; los overrides del staff (tarifa fija,
      // precios de extras, descuento) se aplican ENCIMA y quedan registrados
      // en pricing con motivo y autor — nunca se pisa el total a ciegas.
      const base = computeQuote(model, data.start, data.end, data.pickupZone, data.extras, ctx);
      const overrides = data.pricing ?? {};
      const quote = applyPricingOverrides(base, model, data.start, data.end, overrides, ctx);
      const chosenExtras = overrides.extras ?? data.extras;
      const extrasRecord = chosenExtras.map((sel) => {
        const catalog = ctx.extrasCatalog.find((e) => e.id === sel.id);
        return {
          id: sel.id,
          name: catalog?.name ?? `extra ${sel.id}`,
          priceCents: Number(('priceCents' in sel ? sel.priceCents : undefined) ?? catalog?.priceCents ?? 0),
          per: catalog?.per ?? ('rental' as const),
          qty: sel.qty,
        };
      });
      const pricing = buildPricingRecord(quote, {
        dailyRateCents: overrides.dailyRateCents ?? model.dailyRateCents,
        extras: extrasRecord,
        pickupZone: data.pickupZone,
        discount: overrides.discount
          ? { ...overrides.discount, cents: base.subtotalCents - quote.subtotalCents, reason: overrides.reason ?? '' }
          : quote.discountPct > 0
            ? { kind: 'auto' }
            : { kind: 'none' },
        source: 'manual',
        reason: overrides.reason,
        editedBy: admin.email,
      });

      // El pedido tal como se capturó, congelado (diff del panel después).
      const requested = {
        channel: 'admin' as const,
        model: { slug: model.slug, name: model.name },
        start: data.start.toISOString(),
        end: data.end.toISOString(),
        pickupZone: data.pickupZone,
        extras: extrasRecord.map((e) => ({ name: e.name, price_cents: e.priceCents, per: e.per, qty: e.qty })),
        totalCents: pricing.totalCents,
        createdAt: new Date().toISOString(),
      };

      for (let attempt = 0; attempt < 3; attempt++) {
        const code = generateBookingCode();
        try {
          const rows = await sqlTx`
            INSERT INTO bookings
              (code, kind, customer_name, customer_email, customer_phone,
               flight_number, total_cents, deposit_type, status, notes,
               pricing, requested)
            VALUES
              (${code}, 'rental', ${data.customer!.name},
               ${data.customer!.email ?? null}, ${data.customer!.phone ?? null},
               ${data.customer!.flightNumber ?? null},
               ${pricing.totalCents}, ${data.depositType}, 'confirmed',
               ${data.notes ?? null}, ${sql.json(pricingJson(pricing))}::jsonb,
               ${sql.json(requested)}::jsonb)
            RETURNING id
          `;
          const bookingId = Number(rows[0].id);
          await sqlTx`
            INSERT INTO booking_segments
              (booking_id, idx, model_id, vehicle_id, period, status,
               pricing, total_cents, extras, pickup_zone, return_zone)
            VALUES
              (${bookingId}, 1, ${model.id}, ${unitId},
               tstzrange(${data.start}::timestamptz, ${data.end}::timestamptz, '[)'),
               'reserved', ${sql.json(pricingJson(pricing))}::jsonb,
               ${pricing.totalCents},
               ${sql.json(snapshotExtras(data.extras, ctx))}::jsonb,
               ${data.pickupZone}, ${data.returnZone ?? data.pickupZone})
          `;
          return { bookingId };
        } catch (err) {
          if ((err as { code?: string }).code === '23505') continue;
          throw err;
        }
      }
      throw new Error('no se pudo generar un código único');
    });

    if ('unavailable' in result) {
      return json({ error: 'unavailable' }, 409);
    }

    // Respuesta con el agregado de tramos (misma forma que el GET).
    const created = await sql`
      SELECT b.*, agg.period_start, agg.period_end, agg.plate,
             agg.model_name, agg.model_slug, agg.extras, agg.segments
      FROM bookings b
      LEFT JOIN LATERAL (
        SELECT min(lower(s.period)) AS period_start,
               max(upper(s.period)) AS period_end,
               (array_agg(v.plate ORDER BY s.idx))[1] AS plate,
               (array_agg(m.name ORDER BY s.idx))[1] AS model_name,
               (array_agg(m.slug ORDER BY s.idx))[1] AS model_slug,
               (array_agg(s.extras ORDER BY s.idx))[1] AS extras,
               json_agg(json_build_object(
                 'id', s.id, 'idx', s.idx, 'status', s.status,
                 'model_slug', m.slug, 'model_name', m.name, 'plate', v.plate,
                 'period_start', lower(s.period), 'period_end', upper(s.period),
                 'total_cents', s.total_cents
               ) ORDER BY s.idx) AS segments
        FROM booking_segments s
        JOIN vehicle_models m ON m.id = s.model_id
        LEFT JOIN vehicles v ON v.id = s.vehicle_id
        WHERE s.booking_id = b.id
      ) agg ON true
      WHERE b.id = ${result.bookingId}
    `;

    // CRM: find-or-link del cliente capturado (best-effort).
    try {
      await linkBookingToCustomer(sql, result.bookingId, {
        name: data.customer?.name ?? '',
        email: data.customer?.email ?? null,
        phone: data.customer?.phone ?? null,
      });
    } catch (crmErr) {
      console.error('CRM: no se pudo vincular el cliente:', crmErr);
    }
    await logAudit(sql, admin, {
      action: 'create',
      entity: 'booking',
      entityId: result.bookingId,
      summary: `Renta ${created[0].code} capturada manualmente — ${data.customer?.name ?? ''} (${(created[0].total_cents / 100).toFixed(2)} MXN)`,
    }, context);
    // SIN whatsappUrl: la captura manual no dispara mensaje automático (el
    // staff ya tiene al cliente enfrente o al teléfono).
    return json({ booking: created[0] }, 201);
  } catch (err) {
    if ((err as { code?: string }).code === '23P01') {
      return json({ error: 'unavailable' }, 409);
    }
    console.error('POST /api/admin/bookings falló:', err);
    return json({ error: 'internal' }, 500);
  }
}

export function ALL(): Response {
  return new Response(null, { status: 405, headers: { Allow: 'GET, POST' } });
}
