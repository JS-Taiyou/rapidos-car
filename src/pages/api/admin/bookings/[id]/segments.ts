// /api/admin/bookings/[id]/segments — el REPLAN (ROADMAP Fase 4): la
// herramienta para extender, acortar o trocear una renta en varios vehículos
// ("2 días compacto + 3 pickup + 2 sedán") con prorrateo natural: cada tramo
// se cotiza por sus días con SU tarifa.
//
//   POST → plan-preview: valida SIN persistir. Devuelve desglose por tramo,
//          total/delta vs contrato actual y, si un tramo colisiona, las
//          ALTERNATIVAS con unidad libre y su delta de precio.
//   PUT  → aplica el plan completo en UNA transacción: updates de tramos
//          existentes, inserts de nuevos, cancelación de los vivos que
//          desaparecieron del plan. La constraint no_overlap_segment sigue
//          siendo el juez final de las carreras.
//
// Regla de negocio (ROADMAP decisión #1): el descuento por renta larga se
// evalúa sobre el TOTAL de días de la renta (suma de tramos), no por tramo —
// el cliente que rentó 7 días en 2 modelos conserva el trato de 7 días.
// Tramos 'completed' son historial: el plan no puede tocarlos.
import type { APIContext } from 'astro';
import { z } from 'zod';
import { sql, type Sql } from '../../../../../lib/db';
import { requireAdminApi } from '../../../../../lib/auth';
import { pickFreeUnit, isUnitFree, type ModelAvailability } from '../../../../../lib/availability';
import {
  computeQuote,
  loadPricingContext,
  applyPricingOverrides,
  buildPricingRecord,
  pricingJson,
  snapshotExtras,
  type PricingContext,
} from '../../../../../lib/pricing';
import { pricingOverridesSchema } from '../../../../../lib/validation';
import { recalcBookingTotals } from '../../../../../lib/segments';
import { logAudit } from '../../../../../lib/audit';

export const prerender = false;

const planSegmentSchema = z
  .object({
    id: z.number().int().optional(), // presente = actualizar ese tramo
    modelSlug: z.string().min(1),
    start: z.coerce.date(),
    end: z.coerce.date(),
    pickupZone: z.string().min(1).optional(),
    returnZone: z.string().nullable().optional(),
    extras: z.array(z.object({ id: z.number().int(), qty: z.number().int().min(1) })).optional(),
    vehicleId: z.number().int().optional(), // placa elegida a mano
  })
  .refine((d) => d.end > d.start, { message: 'La devolución debe ser posterior a la entrega' });

const replanSchema = z.object({
  segments: z.array(planSegmentSchema).min(1).max(6),
  overrides: pricingOverridesSchema.optional(),
});

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

interface CurrentSegment {
  id: number;
  idx: number;
  status: string;
  vehicle_id: number | null;
  period_start: Date;
  period_end: Date;
  pickup_zone: string;
  return_zone: string | null;
  extras: Array<{ id?: number; name: string; qty: number }>;
  model_slug: string;
  total_cents: number;
}

async function loadCurrentSegments(sqlTx: Sql, bookingId: number): Promise<CurrentSegment[]> {
  const rows = await sqlTx`
    SELECT s.id, s.idx, s.status, s.vehicle_id,
           lower(s.period) AS period_start, upper(s.period) AS period_end,
           s.pickup_zone, s.return_zone, s.extras, s.total_cents,
           m.slug AS model_slug
    FROM booking_segments s
    JOIN vehicle_models m ON m.id = s.model_id
    WHERE s.booking_id = ${bookingId}
    ORDER BY s.idx
  `;
  return (rows as unknown as Array<Record<string, unknown>>).map((r) => ({
    id: Number(r.id),
    idx: Number(r.idx),
    status: r.status as string,
    vehicle_id: r.vehicle_id === null ? null : Number(r.vehicle_id),
    period_start: new Date(r.period_start as string),
    period_end: new Date(r.period_end as string),
    pickup_zone: r.pickup_zone as string,
    return_zone: (r.return_zone as string | null) ?? null,
    extras: (r.extras as CurrentSegment['extras']) ?? [],
    model_slug: r.model_slug as string,
    total_cents: Number(r.total_cents),
  }));
}

// Resuelve el plan contra el inventario real. Devuelve los pasos listos para
// persistir (o para describir en el preview) y los errores/alternativas por
// tramo. Es la ÚNICA fuente de verdad de validación: el preview y el PUT
// venexactamente lo mismo.
interface ResolvedStep {
  planId: number | null; // id del tramo existente (null = nuevo)
  model: ModelAvailability & { id: number };
  start: Date;
  end: Date;
  pickupZone: string;
  returnZone: string;
  extras: Array<{ id: number; qty: number }>;
  unitId: number | null;
  totalCents: number;
  pricing: ReturnType<typeof buildPricingRecord>;
  keptUnit: boolean;
}

interface PlanResolution {
  steps: ResolvedStep[];
  removed: CurrentSegment[];
  daysTotal: number;
  discountPct: number;
  errors: Array<{ index: number; message: string }>;
  alternatives: Record<number, Array<{ slug: string; name: string; dailyRateCents: number; totalCents: number; deltaCents: number }>>;
}

async function resolvePlan(
  sqlTx: Sql,
  bookingId: number,
  current: CurrentSegment[],
  plan: z.infer<typeof replanSchema>,
  ctx: PricingContext,
): Promise<PlanResolution> {
  const buffer = ctx.settings.turnaroundBufferMinutes;
  const errors: PlanResolution['errors'] = [];
  const alternatives: PlanResolution['alternatives'] = {};

  // Tramos completados = historial, intocables. Y los ids del plan deben
  // ser tramos REALES de esta renta (un id ajeno cancelaría todo lo vivo).
  const completed = current.filter((s) => s.status === 'completed');
  const planIds = new Set(plan.segments.filter((s) => s.id !== undefined).map((s) => s.id!));
  for (const s of completed) {
    if (planIds.has(s.id)) {
      errors.push({ index: plan.segments.findIndex((p) => p.id === s.id), message: `El tramo ${s.idx} ya está completado (historial): no se puede mover.` });
    }
  }
  const live = current.filter((s) => s.status !== 'completed' && s.status !== 'cancelled');
  for (let i = 0; i < plan.segments.length; i++) {
    const pid = plan.segments[i].id;
    if (pid !== undefined && !current.some((s) => s.id === pid)) {
      errors.push({ index: i, message: `El tramo ${pid} no pertenece a esta renta.` });
    }
  }
  const removed = live.filter((s) => !planIds.has(s.id));

  // Sin solapes entre tramos del plan.
  const sorted = [...plan.segments].sort((a, b) => a.start.getTime() - b.start.getTime());
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].start < sorted[i - 1].end) {
      errors.push({ index: plan.segments.indexOf(sorted[i]), message: 'El plan tiene tramos que se solapan entre sí.' });
    }
  }

  // Descuento por renta larga sobre el TOTAL de días de la renta (decisión
  // #1 del ROADMAP): la suma incluye los tramos completados que ya corrieron.
  const daysOf = (s: Date, e: Date) => Math.max(1, Math.ceil((e.getTime() - s.getTime()) / 86_400_000));
  const daysTotal =
    completed.reduce((sum, s) => sum + daysOf(s.period_start, s.period_end), 0) +
    plan.segments.reduce((sum, s) => sum + daysOf(s.start, s.end), 0);
  let discountPct = 0;
  for (const rule of ctx.settings.longRentalDiscounts) {
    if (daysTotal >= rule.minDays) discountPct = Math.max(discountPct, rule.pct);
  }

  const steps: ResolvedStep[] = [];
  for (let i = 0; i < plan.segments.length; i++) {
    const p = plan.segments[i];
    const model = await fetchModel(sqlTx, p.modelSlug);
    if (!model) {
      errors.push({ index: i, message: `El modelo "${p.modelSlug}" no existe o está inactivo.` });
      continue;
    }

    // Zonas: las del tramo original si viene id; si no, las del último tramo
    // previo del plan (o el último existente para el primero).
    const prevSeg = p.id !== undefined ? live.find((s) => s.id === p.id) : undefined;
    const lastKnown = steps.at(-1) ?? null;
    const fallbackZone = prevSeg?.pickup_zone ?? lastKnown?.pickupZone ?? live[0]?.pickup_zone ?? 'office';
    const pickupZone = p.pickupZone ?? fallbackZone;
    const inheritedReturn = p.id !== undefined ? (prevSeg?.return_zone ?? null) : null;
    const returnZone = p.returnZone ?? inheritedReturn ?? pickupZone;

    // Unidad: conserva la del tramo si sigue libre; placa a mano si el staff
    // la fijó; si no, cualquiera del modelo.
    let unitId: number | null = null;
    let keptUnit = false;
    if (prevSeg && prevSeg.vehicle_id !== null && prevSeg.model_slug === p.modelSlug) {
      const stillFree = await isUnitFree(sqlTx, prevSeg.vehicle_id, p.start, p.end, buffer, bookingId);
      if (stillFree) {
        unitId = prevSeg.vehicle_id;
        keptUnit = true;
      }
    }
    if (unitId === null && p.vehicleId !== undefined) {
      const free = await isUnitFree(sqlTx, p.vehicleId, p.start, p.end, buffer, bookingId);
      if (free) {
        unitId = p.vehicleId;
        keptUnit = true;
      }
    }
    if (unitId === null) {
      unitId = await pickFreeUnit(sqlTx, p.modelSlug, p.start, p.end, buffer, bookingId);
    }

    // Cotización del tramo: base del motor + overrides del staff (si los
    // hay) + descuento de renta larga (total de días) si no hay descuento
    // manual que lo reemplace.
    const extras = p.extras ?? prevSeg?.extras.filter((e) => e.id !== undefined).map((e) => ({ id: e.id!, qty: e.qty })) ?? [];
    const base = computeQuote(model, p.start, p.end, pickupZone, extras, ctx, returnZone);
    const overrides = { ...plan.overrides };
    if (!overrides.discount && discountPct > 0) {
      overrides.discount = { kind: 'pct', value: discountPct };
    }
    const quote = applyPricingOverrides(base, model, p.start, p.end, overrides, ctx);
    const catalog = ctx.extrasCatalog;
    const pricing = buildPricingRecord(quote, {
      dailyRateCents: overrides.dailyRateCents ?? model.dailyRateCents,
      extras: extras.map((sel) => {
        const cat = catalog.find((e) => e.id === sel.id);
        return {
          id: sel.id,
          name: cat?.name ?? `extra ${sel.id}`,
          priceCents: cat?.priceCents ?? 0,
          per: cat?.per ?? ('rental' as const),
          qty: sel.qty,
        };
      }),
      pickupZone,
      discount: overrides.discount
        ? {
            ...overrides.discount,
            cents: base.subtotalCents - quote.subtotalCents,
            reason:
              overrides.discount.kind === 'pct' && overrides.discount.value === discountPct && !plan.overrides?.discount
                ? `Renta larga: ${daysTotal} días en total`
                : (overrides.reason ?? ''),
          }
        : quote.discountPct > 0
          ? { kind: 'auto' }
          : { kind: 'none' },
      source: 'adjust',
      reason: overrides.reason ?? 'Replan de la renta (extensión/cambio de vehículo)',
      editedBy: undefined, // lo pone el caller con el admin real
    });

    if (unitId === null) {
      // Sin unidad para ESTE tramo: alternativas con unidad libre (mismo
      // buffer, misma renta excluida) y su delta de precio vs este tramo.
      const altRows = await sqlTx`
        SELECT m.slug, m.name, m.daily_rate_cents
        FROM vehicle_models m
        WHERE m.active = true
          AND EXISTS (
            SELECT 1 FROM vehicles v
            WHERE v.model_id = m.id AND v.status = 'active'
              AND NOT EXISTS (
                SELECT 1 FROM booking_segments s2
                JOIN bookings b2 ON b2.id = s2.booking_id
                WHERE s2.vehicle_id = v.id
                  AND b2.id <> ${bookingId}
                  AND b2.status <> 'cancelled'
                  AND s2.status IN ('reserved','active')
                  AND s2.period && tstzrange(
                    ${p.start}::timestamptz - (${buffer} || ' minutes')::interval,
                    ${p.end}::timestamptz + (${buffer} || ' minutes')::interval, '[)')
              )
          )
        ORDER BY m.daily_rate_cents ASC
        LIMIT 8
      `;
      alternatives[i] = (altRows as unknown as Array<Record<string, unknown>>).map((r) => {
        const daily = Number(r.daily_rate_cents);
        const altModel = { ...model, dailyRateCents: daily };
        const altQuote = computeQuote(altModel, p.start, p.end, pickupZone, extras, ctx, returnZone);
        return {
          slug: r.slug as string,
          name: r.name as string,
          dailyRateCents: daily,
          totalCents: altQuote.totalCents,
          deltaCents: altQuote.totalCents - quote.totalCents,
        };
      });
      errors.push({ index: i, message: `Sin unidades de ${model.name} disponibles en ese período.` });
      continue;
    }

    steps.push({
      planId: p.id ?? null,
      model,
      start: p.start,
      end: p.end,
      pickupZone,
      returnZone,
      extras,
      unitId,
      totalCents: quote.totalCents,
      pricing,
      keptUnit,
    });
  }

  return { steps, removed, daysTotal, discountPct, errors, alternatives };
}

async function readBooking(sqlTx: Sql, id: number) {
  const rows = (await sqlTx`SELECT * FROM bookings WHERE id = ${id} FOR UPDATE`) as unknown as Array<
    Record<string, unknown>
  >;
  return rows[0] ?? null;
}

export async function POST(context: APIContext): Promise<Response> {
  // plan-preview
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
  const parsed = replanSchema.safeParse(body);
  if (!parsed.success) return json({ error: 'validation', issues: parsed.error.issues }, 400);

  const ctx = await loadPricingContext(sql);
  type PreviewResult =
    | { notFound: true }
    | { notRental: true }
    | {
        ok: boolean;
        errors: PlanResolution['errors'];
        alternatives: PlanResolution['alternatives'];
        daysTotal: number;
        discountPct: number;
        segments: Array<{
          index: number;
          segmentId: number | null;
          model: string;
          modelSlug: string;
          start: string;
          end: string;
          days: number;
          totalCents: number;
          keptUnit: boolean;
        }>;
        removedSegments: Array<{ segmentId: number; idx: number }>;
        totals: { currentCents: number; proposedCents: number; deltaCents: number };
      };
  const resolution = await sql.begin(async (sqlTx): Promise<PreviewResult> => {
    const booking = await readBooking(sqlTx, id);
    if (!booking) return { notFound: true };
    if (booking.kind !== 'rental') return { notRental: true };
    const current = await loadCurrentSegments(sqlTx, id);
    const res = await resolvePlan(sqlTx, id, current, parsed.data, ctx);
    // Totales para el delta: lo que cuesta HOY (vivos + ya completados) vs
    // lo que costaría el plan propuesto.
    const currentTotal = current
      .filter((s) => s.status !== 'cancelled')
      .reduce((sum, s) => sum + s.total_cents, 0);
    const proposedTotal = res.steps.reduce((sum, st) => sum + st.totalCents, 0);
    return {
      ok: res.errors.length === 0,
      errors: res.errors,
      alternatives: res.alternatives,
      daysTotal: res.daysTotal,
      discountPct: res.discountPct,
      segments: res.steps.map((st, i) => ({
        index: i,
        segmentId: st.planId,
        model: st.model.name,
        modelSlug: st.model.slug,
        start: st.start.toISOString(),
        end: st.end.toISOString(),
        days: Math.max(1, Math.ceil((st.end.getTime() - st.start.getTime()) / 86_400_000)),
        totalCents: st.totalCents,
        keptUnit: st.keptUnit,
      })),
      removedSegments: res.removed.map((s) => ({ segmentId: s.id, idx: s.idx })),
      totals: { currentCents: currentTotal, proposedCents: proposedTotal, deltaCents: proposedTotal - currentTotal },
    };
  });
  if ('notFound' in resolution) return json({ error: 'not_found' }, 404);
  if ('notRental' in resolution) return json({ error: 'not_a_rental' }, 400);
  return json(resolution);
}

export async function PUT(context: APIContext): Promise<Response> {
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
  const parsed = replanSchema.safeParse(body);
  if (!parsed.success) return json({ error: 'validation', issues: parsed.error.issues }, 400);

  const ctx = await loadPricingContext(sql);
  try {
    const result = await sql.begin(async (sqlTx) => {
      const booking = await readBooking(sqlTx, id);
      if (!booking) return { notFound: true as const };
      if (booking.kind !== 'rental') return { notRental: true as const };

      const current = await loadCurrentSegments(sqlTx, id);
      const before = current.map((s) => ({ id: s.id, idx: s.idx, status: s.status, model: s.model_slug, total: s.total_cents }));
      const resolution = await resolvePlan(sqlTx, id, current, parsed.data, ctx);
      if (resolution.errors.length > 0) {
        return { errors: resolution.errors, alternatives: resolution.alternatives };
      }

      // 1) Cancelar los vivos que salieron del plan.
      for (const s of resolution.removed) {
        await sqlTx`UPDATE booking_segments SET status = 'cancelled', updated_at = now() WHERE id = ${s.id}`;
      }
      // 2) Aplicar tramos con idx provisional (evita chocar el UNIQUE
      //    (booking_id, idx) durante la danza de updates).
      const applied: Array<{ segmentId: number; idx: number }> = [];
      for (let i = 0; i < resolution.steps.length; i++) {
        const st = resolution.steps[i];
        const snapshot = snapshotExtras(st.extras, ctx);
        const pricingWithAuthor = { ...st.pricing, editedBy: admin.email };
        const tempIdx = 10_000 + i;
        if (st.planId !== null) {
          await sqlTx`
            UPDATE booking_segments
            SET idx = ${tempIdx},
                model_id = ${st.model.id},
                vehicle_id = ${st.unitId},
                period = tstzrange(${st.start}::timestamptz, ${st.end}::timestamptz, '[)'),
                pickup_zone = ${st.pickupZone},
                return_zone = ${st.returnZone},
                extras = ${sqlTx.json(snapshot)}::jsonb,
                pricing = ${sqlTx.json(pricingJson(pricingWithAuthor))}::jsonb,
                total_cents = ${st.totalCents},
                updated_at = now()
            WHERE id = ${st.planId}
          `;
          applied.push({ segmentId: st.planId, idx: i + 1 });
        } else {
          const rows = await sqlTx`
            INSERT INTO booking_segments
              (booking_id, idx, model_id, vehicle_id, period, status, pricing,
               total_cents, extras, pickup_zone, return_zone)
            VALUES
              (${id}, ${tempIdx}, ${st.model.id}, ${st.unitId},
               tstzrange(${st.start}::timestamptz, ${st.end}::timestamptz, '[)'),
               'reserved', ${sqlTx.json(pricingJson(pricingWithAuthor))}::jsonb,
               ${st.totalCents}, ${sqlTx.json(snapshot)}::jsonb,
               ${st.pickupZone}, ${st.returnZone})
            RETURNING id
          `;
          applied.push({ segmentId: Number(rows[0].id), idx: i + 1 });
        }
      }
      // 3) Renumerar en dos pasos: primero TODOS a idx provisional ≥1000
      //    (libera los índices bajos), luego definitiva 1..n por fecha con
      //    los cancelados al final — sin chocar el UNIQUE por el camino.
      await sqlTx`UPDATE booking_segments SET idx = idx + 1000 WHERE booking_id = ${id}`;
      await sqlTx`
        WITH ordered AS (
          SELECT id, ROW_NUMBER() OVER (
            ORDER BY (status <> 'cancelled') DESC, lower(period), id
          ) AS rn
          FROM booking_segments
          WHERE booking_id = ${id}
        )
        UPDATE booking_segments s
        SET idx = o.rn
        FROM ordered o
        WHERE o.id = s.id
      `;
      await recalcBookingTotals(sqlTx, id);

      const after = await sqlTx`
        SELECT s.id, s.idx, s.status, m.name AS model, s.total_cents, v.plate
        FROM booking_segments s
        JOIN vehicle_models m ON m.id = s.model_id
        LEFT JOIN vehicles v ON v.id = s.vehicle_id
        WHERE s.booking_id = ${id}
        ORDER BY s.idx
      `;
      return { applied, after, before };
    });

    if ('notFound' in result) return json({ error: 'not_found' }, 404);
    if ('notRental' in result) return json({ error: 'not_a_rental' }, 400);
    if ('errors' in result) return json(result, 409);

    await logAudit(sql, admin, {
      action: 'replan',
      entity: 'booking',
      entityId: id,
      summary: `Renta replanificada: ${result.before.filter((s) => s.status !== 'cancelled').length} → ${result.after.filter((s) => s.status !== 'cancelled').length} tramo(s) vivos`,
      diff: {
        segments: { before: result.before, after: result.after },
      },
    }, context);
    return json({ ok: true, segments: result.after });
  } catch (err) {
    if ((err as { code?: string }).code === '23P01') {
      return json({ error: 'unavailable', hint: 'Otra reserva tomó la unidad mientras se aplicaba el plan; valida de nuevo.' }, 409);
    }
    console.error('PUT /api/admin/bookings/[id]/segments falló:', err);
    return json({ error: 'internal' }, 500);
  }
}

export function ALL(): Response {
  return new Response(null, { status: 405, headers: { Allow: 'POST, PUT' } });
}
