// /api/admin/bookings/[id] — PATCH transiciones del pipeline (spec §4.3),
// REPRICE y EDIT. La máquina de estados vive en el SERVIDOR (§2.9) y desde
// la migración 006 se PROPAGA a los tramos: confirmar un lead despierta sus
// tramos ('quoted'→'reserved', que ya amarran unidad), iniciar renta activa
// el primer tramo, completar cierra los corriendo, cancelar libera todo.
//
// reprice/edit operan sobre el PRIMER TRAMO NO TERMINAL (con rentas de un
// tramo es exactamente el comportamiento histórico; el asistente multi-tramo
// llega con el replan de la Fase 4). El reprice recalcula desde el motor
// (modelo, periodo y zona DEL TRAMO) aplicando los overrides del staff —
// nunca se pisa el total a ciegas — y persiste el desglose con motivo y autor.
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
import { recalcBookingTotals } from '../../../../lib/segments';

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

// El tramo objetivo de reprice/edit: el primero que aún puede moverse.
function firstLiveSegment<T extends { status: string }>(segments: T[]): T | undefined {
  return segments.find((s) => !['completed', 'cancelled'].includes(s.status));
}

// Fila de tramo con su modelo (postgres.js devuelve filas sin firma de
// índice utilizable para genéricos: se castaea a esta interfaz).
interface SegmentWithModel {
  id: number;
  idx: number;
  status: string;
  vehicle_id: number | null;
  period_start: Date;
  period_end: Date;
  pickup_zone: string;
  return_zone: string | null;
  pricing: Record<string, unknown> | null;
  total_cents: number;
  model_id: number;
  model_slug: string;
  model_name: string;
  category: string;
  transmission: string;
  seats: number;
  luggage: number;
  daily_rate_cents: number;
  photos: string[];
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

  const rows = await sql`SELECT b.* FROM bookings b WHERE b.id = ${id}`;
  if (rows.length === 0) return json({ error: 'not_found' }, 404);
  const booking = rows[0];

  const segmentRows = (await sql`
    SELECT s.id, s.idx, s.status, s.vehicle_id,
           lower(s.period) AS period_start, upper(s.period) AS period_end,
           s.pickup_zone, s.return_zone, s.pricing, s.total_cents,
           m.id AS model_id, m.slug AS model_slug, m.name AS model_name,
           m.category, m.transmission, m.seats, m.luggage,
           m.daily_rate_cents, m.photos
    FROM booking_segments s
    JOIN vehicle_models m ON m.id = s.model_id
    WHERE s.booking_id = ${id}
    ORDER BY s.idx
  `) as unknown as SegmentWithModel[];
  if (segmentRows.length === 0) {
    return json({ error: 'no_segments' }, 500);
  }

  // ---- Reprice: recalcular el desglose del tramo con overrides -----------
  if (reprice) {
    if (booking.kind !== 'rental') {
      return json({ error: 'not_a_rental' }, 400);
    }
    const seg = firstLiveSegment(segmentRows);
    if (!seg) return json({ error: 'nothing_to_reprice' }, 409);

    const model = {
      slug: seg.model_slug as string,
      name: seg.model_name as string,
      category: seg.category as string,
      transmission: seg.transmission as string,
      seats: Number(seg.seats),
      luggage: Number(seg.luggage),
      dailyRateCents: Number(seg.daily_rate_cents),
      photos: (seg.photos as string[]) ?? [],
      unitsAvailable: 0,
    };
    const start = new Date(seg.period_start);
    const end = new Date(seg.period_end);
    const pickupZone = seg.pickup_zone as string;
    const returnZone = (seg.return_zone as string | null) ?? pickupZone;
    const ctx = await loadPricingContext(sql);
    const base = computeQuote(model, start, end, pickupZone, [], ctx, returnZone);
    const quote = applyPricingOverrides(base, model, start, end, reprice, ctx);
    const previous = (seg.pricing ?? {}) as Record<string, unknown>;

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
      pickupZone,
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
      UPDATE booking_segments
      SET pricing = ${sql.json(pricingJson({ ...pricing, previousSource: previous.source ?? null, previousTotalCents: seg.total_cents }))}::jsonb,
          total_cents = ${pricing.totalCents},
          updated_at = now()
      WHERE id = ${seg.id}
      RETURNING *
    `;
    await recalcBookingTotals(sql, id);
    const bookingAfter = await sql`SELECT * FROM bookings WHERE id = ${id}`;
    return json({ booking: bookingAfter[0], segment: updated[0] });
  }

  // ---- Edit: modelo/fechas/zona/extras DEL TRAMO ---------------------------
  // Re-asigna unidad dentro de una transacción (FOR UPDATE) y recalcula el
  // desglose desde el motor. `requested` NO se toca: el pedido original del
  // cliente queda congelado para el diff del panel.
  if (edit) {
    if (booking.kind !== 'rental') {
      return json({ error: 'not_a_rental' }, 400);
    }
    const seg = firstLiveSegment(segmentRows);
    if (!seg) return json({ error: 'nothing_to_edit' }, 409);

    const currentSlug = seg.model_slug as string;
    const targetSlug = edit.modelSlug ?? currentSlug;
    const newStart = edit.start ?? new Date(seg.period_start);
    const newEnd = edit.end ?? new Date(seg.period_end);
    const newZone = edit.pickupZone ?? (seg.pickup_zone as string);
    const newReturnZone = edit.returnZone ?? ((seg.return_zone as string | null) ?? newZone);

    // Los tramos hermanos no se tocan: el nuevo rango NO puede solaparlos
    // (la constraint de BD sólo atrapa misma unidad).
    for (const other of segmentRows) {
      if (Number(other.id) === Number(seg.id)) continue;
      if (['completed', 'cancelled'].includes(other.status as string)) continue;
      const os = new Date(other.period_start);
      const oe = new Date(other.period_end);
      if (newStart < oe && os < newEnd) {
        return json({ error: 'segment_overlap', hint: 'El nuevo rango se solapa con otro tramo de la misma renta.' }, 409);
      }
    }

    const ctx = await loadPricingContext(sql);
    const buffer = ctx.settings.turnaroundBufferMinutes;

    const result = await sql.begin(async (sqlTx) => {
      let unitId: number;
      const segVehicleId = seg.vehicle_id === null ? null : Number(seg.vehicle_id);
      if (targetSlug === currentSlug && segVehicleId !== null) {
        // Mismo modelo: conserva la unidad si sigue libre para el rango
        // nuevo; si no, busca otra del mismo modelo.
        const stillFree = await isUnitFree(sqlTx, segVehicleId, newStart, newEnd, buffer, id);
        if (stillFree) {
          unitId = segVehicleId;
        } else {
          const alt = await pickFreeUnit(sqlTx, targetSlug, newStart, newEnd, buffer, id);
          if (alt === null) return { unavailable: true as const };
          unitId = alt;
        }
      } else {
        const alt = await pickFreeUnit(sqlTx, targetSlug, newStart, newEnd, buffer, id);
        if (alt === null) return { unavailable: true as const };
        unitId = alt;
      }

      const modelRows = await sqlTx`
        SELECT id, slug, name, category, transmission, seats, luggage,
               daily_rate_cents, photos
        FROM vehicle_models WHERE slug = ${targetSlug} LIMIT 1
      `;
      const m = modelRows[0];
      if (!m) return { unavailable: true as const };
      const model = {
        id: Number(m.id),
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
      if (newStart.getTime() !== new Date(seg.period_start).getTime() || newEnd.getTime() !== new Date(seg.period_end).getTime()) changes.push('fechas');
      if (newZone !== seg.pickup_zone) changes.push('zona');
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

      const updatedSeg = await sqlTx`
        UPDATE booking_segments
        SET model_id = ${model.id},
            vehicle_id = ${unitId},
            period = tstzrange(${newStart}::timestamptz, ${newEnd}::timestamptz, '[)'),
            pickup_zone = ${newZone},
            return_zone = ${newReturnZone},
            extras = ${sql.json(snapshot)}::jsonb,
            pricing = ${sql.json(pricingJson(pricing))}::jsonb,
            total_cents = ${pricing.totalCents},
            updated_at = now()
        WHERE id = ${seg.id}
        RETURNING *
      `;
      await sqlTx`
        UPDATE bookings SET notes = COALESCE(${notes ?? null}, notes) WHERE id = ${id}
      `;
      return { segment: updatedSeg[0], modelName: model.name };
    });

    if ('unavailable' in result) {
      return json({ error: 'unavailable' }, 409);
    }
    await recalcBookingTotals(sql, id);
    const bookingAfter = await sql`SELECT * FROM bookings WHERE id = ${id}`;
    return json({ booking: bookingAfter[0], segment: result.segment, modelName: result.modelName });
  }

  // ---- Transición de estado (con propagación a tramos) ---------------------
  if (to !== undefined) {
    const from = booking.status as string;
    if (!ALLOWED_TRANSITIONS[from]?.includes(to)) {
      return json({ error: 'invalid_transition', from, to }, 409);
    }
  }

  // Cancelar NO requiere "liberar" nada a mano: la constraint y las queries
  // de disponibilidad filtran por status; el inventario es una proyección.
  try {
    if (to === 'confirmed') {
      // El lead despierta: sus tramos 'quoted' pasan a 'reserved' y por fin
      // amarran unidad. Si las fechas siguen chocando con otra reserva, la
      // constraint lo impide — la constraint manda.
      await sql`
        UPDATE booking_segments SET status = 'reserved', updated_at = now()
        WHERE booking_id = ${id} AND status = 'quoted'
      `;
    } else if (to === 'active') {
      // Se entrega la primera unidad de la línea de tiempo; los tramos
      // futuros quedan 'reserved' hasta su hora.
      await sql`
        UPDATE booking_segments SET status = 'active', updated_at = now()
        WHERE id = (
          SELECT id FROM booking_segments
          WHERE booking_id = ${id} AND status IN ('quoted','reserved')
          ORDER BY idx LIMIT 1
        )
      `;
    } else if (to === 'completed') {
      // Cerrar la renta: los tramos en calle se completan; los futuros que
      // ya no van a correr se cancelan (no deben seguir amarrando unidades).
      await sql`
        UPDATE booking_segments SET status = 'completed', updated_at = now()
        WHERE booking_id = ${id} AND status = 'active'
      `;
      await sql`
        UPDATE booking_segments SET status = 'cancelled', updated_at = now()
        WHERE booking_id = ${id} AND status IN ('quoted','reserved')
      `;
    } else if (to === 'cancelled') {
      await sql`
        UPDATE booking_segments SET status = 'cancelled', updated_at = now()
        WHERE booking_id = ${id} AND status IN ('quoted','reserved','active')
      `;
    }

    const updated = await sql`
      UPDATE bookings
      SET
        status = COALESCE(${to ?? null}, status),
        notes = COALESCE(${notes ?? null}, notes)
      WHERE id = ${id}
      RETURNING *
    `;
    await recalcBookingTotals(sql, id);
    return json({ booking: updated[0] });
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
  } finally {
    // La transición se anuncia a las pestañas del staff (badge del nav).
    if (to !== undefined && to !== booking.status) {
      broadcastBookingStatus({
        id,
        code: booking.code as string,
        from: booking.status as string,
        to,
      });
    }
  }
}

export function ALL(): Response {
  return new Response(null, { status: 405, headers: { Allow: 'PATCH' } });
}
