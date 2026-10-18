// PATCH /api/admin/segments/[id]/handover — cierra la ENTREGA (kind='out':
// el tramo pasa a active, la unidad está en calle) o la DEVOLUCIÓN
// (kind='in': el tramo se completa; si era el último, la renta también).
// El estado agregado de la renta se deriva de los tramos (lib/segments) y
// se anuncia por SSE. Todo queda en audit_log.
import type { APIContext } from 'astro';
import { z } from 'zod';
import { sql } from '../../../../../lib/db';
import { requireAdminApi } from '../../../../../lib/auth';
import { broadcastBookingStatus } from '../../../../../lib/alerts';
import { deriveBookingStatus, recalcBookingTotals } from '../../../../../lib/segments';
import { logAudit } from '../../../../../lib/audit';
import { evaluateMaintenance } from '../../../../../lib/maintenance';

export const prerender = false;

const handoverSchema = z
  .object({
    kind: z.enum(['out', 'in']),
    odometer: z.number().int().min(0).max(10_000_000),
    fuel: z.number().int().min(0).max(8),
    // Estado de cada ítem del checklist (id → marcado). Los ids vienen de
    // settings['handover_checklists']; ids desconocidos se conservan tal cual.
    checklist: z.record(z.string(), z.boolean()).default({}),
    notes: z.string().max(2000).optional(),
    // Rutas públicas devueltas por /api/admin/vehicles/photos (dest=handover).
    photos: z.array(z.string().startsWith('/uploads/handover/').max(200)).max(20).default([]),
  })
  .refine((d) => d.photos.length > 0, {
    message: 'Se requiere al menos una foto de evidencia',
  });

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function PATCH(context: APIContext): Promise<Response> {
  const admin = await requireAdminApi(context.cookies, ['admin', 'desk', 'yard']);
  if (!admin) return json({ error: 'unauthorized' }, 401);

  const segmentId = parseInt(context.params.id ?? '', 10);
  if (Number.isNaN(segmentId)) return json({ error: 'invalid_id' }, 400);

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }
  const parsed = handoverSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: 'validation', issues: parsed.error.issues }, 400);
  }
  const d = parsed.data;

  const segRows = (await sql`
    SELECT s.*, b.code, b.status AS booking_status
    FROM booking_segments s
    JOIN bookings b ON b.id = s.booking_id
    WHERE s.id = ${segmentId}
  `) as unknown as Array<{
    id: number; booking_id: number; idx: number; status: string;
    vehicle_id: number | null; code: string; booking_status: string;
  }>;
  const seg = segRows[0];
  if (!seg) return json({ error: 'not_found' }, 404);

  if (d.kind === 'out' && !['quoted', 'reserved'].includes(seg.status)) {
    return json({ error: 'invalid_state', hint: 'Ese tramo ya fue entregado.' }, 409);
  }
  if (d.kind === 'in' && seg.status !== 'active') {
    return json({ error: 'invalid_state', hint: 'Ese tramo no está en calle.' }, 409);
  }

  const record = {
    at: new Date().toISOString(),
    staffEmail: admin.email,
    checklist: d.checklist,
    notes: d.notes ?? null,
    photos: d.photos,
  };

  const newSegStatus = d.kind === 'out' ? 'active' : 'completed';
  await sql.begin(async (sqlTx) => {
    const recordJson = sqlTx.json(JSON.parse(JSON.stringify(record)));
    if (d.kind === 'out') {
      await sqlTx`
        UPDATE booking_segments
        SET status = 'active',
            odometer_out = ${d.odometer},
            fuel_out = ${d.fuel},
            handover_out = ${recordJson}::jsonb,
            updated_at = now()
        WHERE id = ${segmentId}
      `;
    } else {
      await sqlTx`
        UPDATE booking_segments
        SET status = 'completed',
            odometer_in = ${d.odometer},
            fuel_in = ${d.fuel},
            handover_in = ${recordJson}::jsonb,
            updated_at = now()
        WHERE id = ${segmentId}
      `;
    }
    // Estado agregado de la renta derivado de sus tramos.
    const siblings = await sqlTx`
      SELECT status FROM booking_segments WHERE booking_id = ${seg.booking_id}
    `;
    const derived = deriveBookingStatus(
      siblings.map((s) => ({ status: s.status as string })),
      seg.booking_status,
    );
    await sqlTx`UPDATE bookings SET status = ${derived} WHERE id = ${seg.booking_id}`;
  });

  await recalcBookingTotals(sql, seg.booking_id);

  // Mantenimiento por kilometraje: si la devolución cruza el intervalo
  // configurado, la unidad queda marcada (el staff decide el taller).
  let serviceDue: { kmSinceService: number; intervalKm: number } | null = null;
  if (d.kind === 'in' && seg.vehicle_id != null) {
    const due = await evaluateMaintenance(seg.vehicle_id, d.odometer);
    if (due) {
      serviceDue = { kmSinceService: due.kmSinceService, intervalKm: due.intervalKm };
      await logAudit(sql, admin, {
        action: 'maintenance',
        entity: 'vehicle',
        entityId: seg.vehicle_id,
        summary: `Servicio debido: ${due.kmSinceService.toLocaleString('es-MX')} km desde el último servicio (intervalo ${due.intervalKm.toLocaleString('es-MX')} km)`,
      }, context);
    }
  }

  // Auditoría: la evidencia (odómetro/combustible/fotos) es exactamente lo
  // que se discute cuando algo sale mal.
  await logAudit(sql, admin, {
    action: 'handover',
    entity: 'segment',
    entityId: segmentId,
    summary: `${seg.code} (tramo ${seg.idx}): ${d.kind === 'out' ? 'entregado' : 'devuelto'} — odómetro ${d.odometer.toLocaleString('es-MX')} km, combustible ${d.fuel}/8, ${d.photos.length} foto(s)`,
    diff: {
      status: { before: seg.status, after: newSegStatus },
      [`odometer_${d.kind}`]: { after: d.odometer },
      [`fuel_${d.kind}`]: { after: d.fuel },
    },
  }, context);

  // Cambio de estado de la renta → badge del nav en las pestañas del staff.
  const afterRows = await sql`SELECT status FROM bookings WHERE id = ${seg.booking_id}`;
  const bookingAfter = String(afterRows[0]?.status ?? seg.booking_status);
  if (bookingAfter !== seg.booking_status) {
    broadcastBookingStatus({
      id: seg.booking_id,
      code: seg.code,
      from: seg.booking_status,
      to: bookingAfter,
    });
  }

  return json({ ok: true, segmentStatus: newSegStatus, bookingStatus: bookingAfter, serviceDue });
}

export function ALL(): Response {
  return new Response(null, { status: 405, headers: { Allow: 'PATCH' } });
}
