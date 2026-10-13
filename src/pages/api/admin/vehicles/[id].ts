// /api/admin/vehicles/[id] — PATCH edición (campos presentes + alta/estado
// de unidades) · DELETE borrado LÓGICO (active=false; jamás físico: bookings
// referencia vehicle_id y el historial no se rompe).
import type { APIContext } from 'astro';
import { sql } from '../../../../lib/db';
import { requireAdminApi } from '../../../../lib/auth';
import { vehicleUpsertSchema } from '../../../../lib/validation';
import { invalidateFleetCache } from '../../../../lib/fleet-cache';
import { logAudit } from '../../../../lib/audit';
import { getMaintenanceConfig } from '../../../../lib/maintenance';

export const prerender = false;

// Mismo mapa camelCase que vehicles.ts: la isla habla dailyRateCents.
function toModel(row: Record<string, unknown>, units: unknown[]) {
  return {
    id: Number(row.id),
    slug: row.slug,
    name: row.name,
    category: row.category,
    transmission: row.transmission,
    seats: Number(row.seats),
    luggage: Number(row.luggage),
    dailyRateCents: Number(row.daily_rate_cents),
    photos: row.photos ?? [],
    active: row.active,
    units,
  };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function PATCH(context: APIContext): Promise<Response> {
  const admin = await requireAdminApi(context.cookies, ['admin', 'desk']);
  if (!admin) return json({ error: 'unauthorized' }, 401);

  const id = parseInt(context.params.id ?? '', 10);
  if (Number.isNaN(id)) return json({ error: 'invalid_id' }, 400);

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  // PATCH semántico: solo los campos PRESENTES se actualizan (ausente ≠
  // null). Los campos de operación (addUnits/setUnitStatus/serviceDone) se
  // sacan antes.
  const parsed = vehicleUpsertSchema.partial().safeParse(body);
  if (!parsed.success) {
    return json({ error: 'validation', issues: parsed.error.issues }, 400);
  }
  const data = parsed.data;
  const { addUnits, setUnitStatus, ...modelFields } = data;
  const serviceDone = (body as { serviceDone?: { unitId: number } }).serviceDone;

  if (serviceDone) {
    // Servicio realizado: la base pasa al ÚLTIMO odómetro conocido de la
    // unidad (su devolución más reciente) y la bandera se apaga.
    const unit = await sql`
      SELECT v.id, v.plate,
             COALESCE(
               (SELECT MAX(s.odometer_in) FROM booking_segments s WHERE s.vehicle_id = v.id AND s.odometer_in IS NOT NULL),
               v.last_service_odometer
             ) AS odometer
      FROM vehicles v
      WHERE v.id = ${serviceDone.unitId} AND v.model_id = ${id}
    `;
    if (unit.length === 0) return json({ error: 'not_found' }, 404);
    const odometer = unit[0].odometer === null ? 0 : Number(unit[0].odometer);
    const config = await getMaintenanceConfig();
    await sql`
      UPDATE vehicles
      SET last_service_odometer = ${odometer},
          needs_service = false
      WHERE id = ${serviceDone.unitId}
    `;
    await logAudit(sql, admin, {
      action: 'maintenance',
      entity: 'vehicle',
      entityId: serviceDone.unitId,
      summary: `Servicio realizado en ${unit[0].plate} (base: ${odometer.toLocaleString('es-MX')} km, próximo a +${config.intervalKm.toLocaleString('es-MX')} km)`,
    }, context);
    const refreshed = await sql`SELECT id, plate, status, needs_service FROM vehicles WHERE model_id = ${id} ORDER BY plate`;
    const modelRow = (await sql`SELECT * FROM vehicle_models WHERE id = ${id}`)[0];
    return json({ model: toModel(modelRow, refreshed) });
  }

  const columns: Record<string, unknown> = {};
  if (modelFields.slug !== undefined) columns.slug = modelFields.slug;
  if (modelFields.name !== undefined) columns.name = modelFields.name;
  if (modelFields.category !== undefined) columns.category = modelFields.category;
  if (modelFields.transmission !== undefined) columns.transmission = modelFields.transmission;
  if (modelFields.seats !== undefined) columns.seats = modelFields.seats;
  if (modelFields.luggage !== undefined) columns.luggage = modelFields.luggage;
  if (modelFields.dailyRateCents !== undefined) columns.daily_rate_cents = modelFields.dailyRateCents;
  if (modelFields.photos !== undefined) columns.photos = modelFields.photos;
  if (modelFields.active !== undefined) columns.active = modelFields.active;

  try {
    let model: Record<string, unknown>;
    if (Object.keys(columns).length > 0) {
      // El helper sql(objeto) de postgres.js genera "col = val" solo con las
      // llaves presentes — cubre también el toggle de active.
      const rows = await sql`
        UPDATE vehicle_models SET ${sql(columns)} WHERE id = ${id} RETURNING *
      `;
      if (rows.length === 0) return json({ error: 'not_found' }, 404);
      model = rows[0];
    } else {
      const rows = await sql`SELECT * FROM vehicle_models WHERE id = ${id}`;
      if (rows.length === 0) return json({ error: 'not_found' }, 404);
      model = rows[0];
    }

    if (addUnits && addUnits.length > 0) {
      for (const unit of addUnits) {
        try {
          await sql`INSERT INTO vehicles (model_id, plate) VALUES (${id}, ${unit.plate})`;
        } catch (err) {
          if ((err as { code?: string }).code === '23505') {
            return json({ error: 'duplicate_plate', plate: unit.plate }, 409);
          }
          throw err;
        }
      }
    }

    if (setUnitStatus) {
      // El AND model_id es guardia: evita que un id adivinado cambie
      // unidades de OTRO modelo.
      const result = await sql`
        UPDATE vehicles SET status = ${setUnitStatus.status}
        WHERE id = ${setUnitStatus.unitId} AND model_id = ${id}
      `;
      if (result.count === 0) return json({ error: 'not_found' }, 404);
    }

    invalidateFleetCache();
    await logAudit(sql, admin, {
      action: 'update',
      entity: 'model',
      entityId: id,
      summary: `Modelo ${model.name} actualizado${Object.keys(columns).length > 0 ? ` (${Object.keys(columns).join(', ')})` : ''}${addUnits?.length ? ` · +${addUnits.length} unidad(es)` : ''}${setUnitStatus ? ` · unidad ${setUnitStatus.unitId} → ${setUnitStatus.status}` : ''}`,
      diff: Object.fromEntries(Object.entries(columns).map(([k, v]) => [k, { after: v }])),
    }, context);
    // Re-lectura con el merge de unidades (mismo patrón que el GET).
    const units = await sql`
      SELECT id, plate, status, needs_service FROM vehicles WHERE model_id = ${id} ORDER BY plate
    `;
    return json({ model: toModel(model, units) });
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      return json({ error: 'duplicate_slug' }, 409);
    }
    console.error('PATCH /api/admin/vehicles/[id] falló:', err);
    return json({ error: 'internal' }, 500);
  }
}

export async function DELETE(context: APIContext): Promise<Response> {
  const admin = await requireAdminApi(context.cookies, ['admin', 'desk']);
  if (!admin) return json({ error: 'unauthorized' }, 401);

  const id = parseInt(context.params.id ?? '', 10);
  if (Number.isNaN(id)) return json({ error: 'invalid_id' }, 400);

  // Verificación ANTES de tocar nada: rentas futuras confirmadas → 409 con
  // la lista (mejor un 409 explícito que clientes sin auto). Por tramos
  // (migración 006): la unidad vive en booking_segments.
  const future = await sql`
    SELECT DISTINCT b.id, b.code, s.period, v.plate
    FROM booking_segments s
    JOIN bookings b ON b.id = s.booking_id
    JOIN vehicles v ON v.id = s.vehicle_id
    WHERE v.model_id = ${id}
      AND b.status IN ('confirmed','active')
      AND s.status IN ('reserved','active')
      AND upper(s.period) > now()
  `;
  if (future.length > 0) {
    return json({ error: 'has_future_bookings', bookings: future }, 409);
  }

  let retireUnits = false;
  try {
    const body = (await context.request.json()) as { retireUnits?: boolean };
    retireUnits = body?.retireUnits === true;
  } catch {
    // Sin body (o no-JSON): solo desactivar el modelo.
  }

  const rows = await sql`
    UPDATE vehicle_models SET active = false WHERE id = ${id} RETURNING *
  `;
  if (rows.length === 0) return json({ error: 'not_found' }, 404);

  if (retireUnits) {
    // Las unidades en 'maintenance' se quedan como están: su estado ya dice
    // la verdad.
    await sql`UPDATE vehicles SET status = 'retired' WHERE model_id = ${id} AND status = 'active'`;
  }

  invalidateFleetCache();
  await logAudit(sql, admin, {
    action: 'delete',
    entity: 'model',
    entityId: id,
    summary: `Modelo ${rows[0].name} desactivado (borrado lógico)${retireUnits ? ' · unidades retiradas' : ''}`,
  }, context);
  return json({ ok: true, model: toModel(rows[0], []) });
}

export function ALL(): Response {
  return new Response(null, { status: 405, headers: { Allow: 'PATCH, DELETE' } });
}
