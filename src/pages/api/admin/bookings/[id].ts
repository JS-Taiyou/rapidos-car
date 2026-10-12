// /api/admin/bookings/[id] — PATCH transiciones del pipeline (spec §4.3) y
// REPRICE: ajuste de precio de una reserva existente. La máquina de estados
// vive en el SERVIDOR (§2.9); el reprice recalcula desde el motor (modelo,
// periodo y zona de la reserva) aplicando los overrides del staff — nunca
// se pisa el total a ciegas — y persiste el desglose con motivo y autor.
import type { APIContext } from 'astro';
import { sql } from '../../../../lib/db';
import { requireAdminApi } from '../../../../lib/auth';
import { bookingPatchSchema } from '../../../../lib/validation';
import {
  computeQuote,
  loadPricingContext,
  applyPricingOverrides,
  buildPricingRecord,
  pricingJson,
  snapshotExtras,
} from '../../../../lib/pricing';
import { pickFreeUnit, isUnitFree } from '../../../../lib/availability';
import { broadcastBookingStatus } from '../../../../lib/alerts';

export const prerender = false;

// "De confirmada puedo entregar (active) o cancelar; de activa solo
// completar; los estados terminales no se mueven."
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  quoted: ['confirmed', 'cancelled'],
  confirmed: ['active', 'cancelled'],
  active: ['completed'],
  completed: [],
  cancelled: [],
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function PATCH(context: APIContext): Promise<Response> {
  const admin = await requireAdminApi(context.cookies);
  if (!admin) return json({ error: 'unauthorized' }, 401);

  const id = parseInt(context.params.id ?? '', 10);
  if (Number.isNaN(id)) return json({ error: 'invalid_id' }, 400);

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const parsed = bookingPatchSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: 'validation', issues: parsed.error.issues }, 400);
  }
  const { status: to, notes, reprice, edit } = parsed.data;

  const rows = await sql`
    SELECT b.*, lower(b.period) AS period_start, upper(b.period) AS period_end
    FROM bookings b
    WHERE b.id = ${id}
  `;
  if (rows.length === 0) return json({ error: 'not_found' }, 404);
  const booking = rows[0];

  // ---- Reprice: recalcular el desglose de la reserva con overrides -------
  if (reprice) {
    if (booking.kind !== 'rental') {
      return json({ error: 'not_a_rental' }, 400);
    }
    const modelRows = await sql`
      SELECT m.* FROM vehicle_models m
      JOIN vehicles v ON v.model_id = m.id
      WHERE v.id = ${booking.vehicle_id}
      LIMIT 1
    `;
    const m = modelRows[0];
    if (!m) return json({ error: 'model_not_found' }, 500);

    const model = {
      slug: m.slug as string,
      name: m.name as string,
      category: m.category as string,
      transmission: m.transmission as string,
      seats: Number(m.seats),
      luggage: Number(m.luggage),
      dailyRateCents: Number(m.daily_rate_cents),
      photos: [],
      unitsAvailable: 0,
    };
    const start = new Date(booking.period_start);
    const end = new Date(booking.period_end);
    const ctx = await loadPricingContext(sql);
    const base = computeQuote(model, start, end, booking.pickup_zone, [], ctx, booking.return_zone ?? booking.pickup_zone);
    const quote = applyPricingOverrides(base, model, start, end, reprice, ctx);
    const previous = (booking.pricing ?? {}) as Record<string, unknown>;

    const pricing = buildPricingRecord(quote, {
      dailyRateCents: reprice.dailyRateCents ?? model.dailyRateCents,
      extras: (reprice.extras ?? []).map((sel) => {
        const catalog = ctx.extrasCatalog.find((e) => e.id === sel.id);
        return {
          id: sel.id,
          name: catalog?.name ?? `extra ${sel.id}`,
          priceCents: sel.priceCents ?? catalog?.priceCents ?? 0,
          per: (catalog?.per ?? 'rental') as 'day' | 'rental',
          qty: sel.qty,
        };
      }),
      pickupZone: booking.pickup_zone as string,
      discount: reprice.discount
        ? { ...reprice.discount, cents: base.subtotalCents - quote.subtotalCents, reason: reprice.reason ?? '' }
        : quote.discountPct > 0
          ? { kind: 'auto' }
          : { kind: 'none' },
      source: 'adjust',
      reason: reprice.reason,
      editedBy: admin.email,
    });

    const updated = await sql`
      UPDATE bookings
      SET pricing = ${sql.json(pricingJson({ ...pricing, previousSource: previous.source ?? null, previousTotalCents: booking.total_cents }))}::jsonb,
          total_cents = ${pricing.totalCents}
      WHERE id = ${id}
      RETURNING *
    `;
    return json({ booking: updated[0] });
  }

  // ---- Edit: modelo/fechas/zona/extras ------------------------------------
  // Re-asigna unidad dentro de una transacción (FOR UPDATE) y recalcula el
  // desglose desde el motor. `requested` NO se toca: el pedido original del
  // cliente queda congelado para el diff del panel.
  if (edit) {
    if (booking.kind !== 'rental') {
      return json({ error: 'not_a_rental' }, 400);
    }
    const currentModelRows = await sql`
      SELECT m.slug FROM vehicle_models m
      JOIN vehicles v ON v.model_id = m.id
      WHERE v.id = ${booking.vehicle_id} LIMIT 1
    `;
    const currentSlug = currentModelRows[0]?.slug as string | undefined;
    const targetSlug = edit.modelSlug ?? currentSlug;
    const newStart = edit.start ?? new Date(booking.period_start);
    const newEnd = edit.end ?? new Date(booking.period_end);
    const newZone = edit.pickupZone ?? (booking.pickup_zone as string);
  const newReturnZone = edit.returnZone ?? ((booking.return_zone as string | null) ?? newZone);

    const ctx = await loadPricingContext(sql);
    const buffer = ctx.settings.turnaroundBufferMinutes;

    const result = await sql.begin(async (sqlTx) => {
      let unitId: number;
      if (targetSlug === currentSlug) {
        // Mismo modelo: conserva la unidad si sigue libre para el rango
        // nuevo; si no, busca otra del mismo modelo.
        const stillFree = await isUnitFree(sqlTx, Number(booking.vehicle_id), newStart, newEnd, buffer, id);
        if (stillFree) {
          unitId = Number(booking.vehicle_id);
        } else {
          const alt = await pickFreeUnit(sqlTx, targetSlug ?? '', newStart, newEnd, buffer, id);
          if (alt === null) return { unavailable: true as const };
          unitId = alt;
        }
      } else {
        const alt = await pickFreeUnit(sqlTx, targetSlug ?? '', newStart, newEnd, buffer, id);
        if (alt === null) return { unavailable: true as const };
        unitId = alt;
      }

      const modelRows = await sqlTx`
        SELECT slug, name, category, transmission, seats, luggage,
               daily_rate_cents, photos
        FROM vehicle_models WHERE slug = ${targetSlug ?? ''} LIMIT 1
      `;
      const m = modelRows[0];
      if (!m) return { unavailable: true as const };
      const model = {
        slug: m.slug as string,
        name: m.name as string,
        category: m.category as string,
        transmission: m.transmission as string,
        seats: Number(m.seats),
        luggage: Number(m.luggage),
        dailyRateCents: Number(m.daily_rate_cents),
        photos: (m.photos as string[]) ?? [],
        unitsAvailable: 0,
      };

      const chosenExtras = edit.extras ?? [];
      const quote = computeQuote(model, newStart, newEnd, newZone, chosenExtras, ctx, newReturnZone);
      const snapshot = snapshotExtras(chosenExtras, ctx);
      const changes: string[] = [];
      if (targetSlug !== currentSlug) changes.push('modelo');
      if (newStart.getTime() !== new Date(booking.period_start).getTime() || newEnd.getTime() !== new Date(booking.period_end).getTime()) changes.push('fechas');
      if (newZone !== booking.pickup_zone) changes.push('zona');
      if (edit.extras !== undefined) changes.push('extras');

      const pricing = buildPricingRecord(quote, {
        dailyRateCents: model.dailyRateCents,
        extras: snapshot.map((e) => ({ name: e.name, priceCents: e.price_cents, per: e.per, qty: e.qty })),
        pickupZone: newZone,
        discount: quote.discountPct > 0 ? { kind: 'auto' } : { kind: 'none' },
        source: 'adjust',
        reason: `Cambio de ${changes.join(', ') || 'datos'} por staff`,
        editedBy: admin.email,
      });

      const rows = await sqlTx`
        UPDATE bookings
        SET vehicle_id = ${unitId},
            period = tstzrange(${newStart}::timestamptz, ${newEnd}::timestamptz, '[)'),
            pickup_zone = ${newZone},
            return_zone = ${newReturnZone},
            extras = ${sql.json(snapshot)}::jsonb,
            pricing = ${sql.json(pricingJson(pricing))}::jsonb,
            total_cents = ${pricing.totalCents},
            notes = COALESCE(${notes ?? null}, notes)
        WHERE id = ${id}
        RETURNING *
      `;
      return { booking: rows[0], modelName: model.name };
    });

    if ('unavailable' in result) {
      return json({ error: 'unavailable' }, 409);
    }
    return json(result);
  }

  // ---- Transición de estado ----------------------------------------------
  if (to !== undefined) {
    const from = booking.status as string;
    if (!ALLOWED_TRANSITIONS[from]?.includes(to)) {
      return json({ error: 'invalid_transition', from, to }, 409);
    }
  }

  // Cancelar NO requiere "liberar" nada a mano: la constraint y las queries
  // de disponibilidad filtran por status; el inventario es una proyección.
  let updated;
  try {
    updated = await sql`
      UPDATE bookings
      SET
        status = COALESCE(${to ?? null}, status),
        notes = COALESCE(${notes ?? null}, notes)
      WHERE id = ${id}
      RETURNING *
    `;
  } catch (err) {
    // Confirmar un lead cuyas fechas siguen chocando con la reserva que
    // ocupa la unidad: la constraint lo impide — la constraint manda.
    if ((err as { code?: string }).code === '23P01' && to === 'confirmed') {
      return json(
        { error: 'unavailable', hint: 'La unidad sigue ocupada en esas fechas: edítalas (o cambia de modelo) antes de confirmar.' },
        409,
      );
    }
    throw err;
  }

  // La transición se anuncia a las pestañas del staff (badge del nav).
  if (to !== undefined && to !== booking.status) {
    broadcastBookingStatus({
      id,
      code: booking.code as string,
      from: booking.status as string,
      to,
    });
  }

  return json({ booking: updated[0] });
}

export function ALL(): Response {
  return new Response(null, { status: 405, headers: { Allow: 'PATCH' } });
}
