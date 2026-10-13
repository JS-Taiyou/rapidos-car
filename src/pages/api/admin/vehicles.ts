// /api/admin/vehicles — GET catálogo completo (incluye inactivos: es la
// vista del GESTOR, no la pública) · POST alta de modelo con sus unidades.
import type { APIContext } from 'astro';
import { sql } from '../../../lib/db';
import { requireAdminApi } from '../../../lib/auth';
import { vehicleUpsertSchema } from '../../../lib/validation';
import { logAudit } from '../../../lib/audit';
import { invalidateFleetCache } from '../../../lib/fleet-cache';

export const prerender = false;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// SELECT * devuelve snake_case; la isla FleetManager habla camelCase
// (dailyRateCents). Sin este mapa, undefined/100 pinta NaN en la tarifa.
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

export async function GET(context: APIContext): Promise<Response> {
  const admin = await requireAdminApi(context.cookies, ['admin', 'desk']);
  if (!admin) return json({ error: 'unauthorized' }, 401);

  // Dos queries simples + merge en JS (no json_agg anidado): con ~20
  // unidades, legibilidad > un roundtrip menos.
  const models = await sql`SELECT * FROM vehicle_models ORDER BY daily_rate_cents ASC`;
  const units = await sql`SELECT * FROM vehicles ORDER BY plate ASC`;

  const byModel = new Map<number, unknown[]>();
  for (const unit of units) {
    const modelId = Number(unit.model_id);
    const list = byModel.get(modelId) ?? [];
    list.push({ id: Number(unit.id), plate: unit.plate, status: unit.status, needsService: unit.needs_service === true });
    byModel.set(modelId, list);
  }

  return json({
    models: models.map((m) => toModel(m, byModel.get(Number(m.id)) ?? [])),
  });
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

  const parsed = vehicleUpsertSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: 'validation', issues: parsed.error.issues }, 400);
  }
  const data = parsed.data;

  try {
    const created = await sql`
      INSERT INTO vehicle_models
        (slug, name, category, transmission, seats, luggage, daily_rate_cents, photos, active)
      VALUES
        (${data.slug}, ${data.name}, ${data.category}, ${data.transmission},
         ${data.seats}, ${data.luggage}, ${data.dailyRateCents},
         ${data.photos}::text[], ${data.active ?? true})
      RETURNING *
    `;

    // Loop SECUENCIAL: con Promise.all el orden de errores se vuelve caótico
    // y el 409 ya no sabría decir qué placa falló.
    const insertedUnits = [];
    for (const unit of data.units ?? []) {
      try {
        const rows = await sql`
          INSERT INTO vehicles (model_id, plate)
          VALUES (${Number(created[0].id)}, ${unit.plate})
          RETURNING id, plate, status
        `;
        insertedUnits.push(rows[0]);
      } catch (err) {
        if ((err as { code?: string }).code === '23505') {
          return json({ error: 'duplicate_plate', plate: unit.plate }, 409);
        }
        throw err;
      }
    }

    // Flota cambiada: tumba el snapshot del catálogo público.
    invalidateFleetCache();
    await logAudit(sql, admin, {
      action: 'create',
      entity: 'model',
      entityId: Number(created[0].id),
      summary: `Modelo ${data.name} (${data.slug}) creado con ${insertedUnits.length} unidad(es)`,
    }, context);
    return json({ model: toModel(created[0], insertedUnits) }, 201);
  } catch (err) {
    if ((err as { code?: string; constraint?: string }).code === '23505') {
      return json({ error: 'duplicate_slug', slug: data.slug }, 409);
    }
    console.error('POST /api/admin/vehicles falló:', err);
    return json({ error: 'internal' }, 500);
  }
}

export function ALL(): Response {
  return new Response(null, { status: 405, headers: { Allow: 'GET, POST' } });
}
