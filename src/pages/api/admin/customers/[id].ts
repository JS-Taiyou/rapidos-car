// /api/admin/customers/[id] — GET expediente completo (datos + historial de
// contacto + rentas) · PATCH edición. El caso estrella del PATCH: capturar
// un CURP que ya existía → AUTO-UNIFICACIÓN con el expediente antiguo (se
// mueven las reservas, se fusionan historiales, gana el nombre registrado).
import type { APIContext } from 'astro';
import { z } from 'zod';
import { sql } from '../../../../lib/db';
import { requireAdminApi } from '../../../../lib/auth';
import { logAudit } from '../../../../lib/audit';
import { mergeCustomers } from '../../../../lib/customers';

export const prerender = false;

const customerPatchSchema = z.object({
  curp: z.string().regex(/^[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]\d$/, 'CURP con formato inválido').nullable().optional(),
  fullName: z.string().min(3).optional(),
  email: z.string().email().nullable().optional(),
  phone: z.string().min(8).nullable().optional(),
  notes: z.string().nullable().optional(),
  noShow: z.boolean().optional(),
});

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function loadCustomer(id: number) {
  const rows = await sql`
    SELECT * FROM customers WHERE id = ${id} LIMIT 1
  `;
  return rows[0] ?? null;
}

async function loadBookings(customerId: number) {
  // Período agregado de la línea de tiempo (min lower → max upper) y
  // modelo/placa del primer tramo (migración 006).
  return sql`
    SELECT b.id, b.code, b.status, b.kind, b.total_cents,
           agg.period_start, agg.period_end,
           agg.model_name, agg.plate
    FROM bookings b
    LEFT JOIN LATERAL (
      SELECT min(lower(s.period)) AS period_start,
             max(upper(s.period)) AS period_end,
             (array_agg(m.name ORDER BY s.idx))[1] AS model_name,
             (array_agg(v.plate ORDER BY s.idx))[1] AS plate
      FROM booking_segments s
      JOIN vehicle_models m ON m.id = s.model_id
      LEFT JOIN vehicles v ON v.id = s.vehicle_id
      WHERE s.booking_id = b.id
    ) agg ON true
    WHERE b.customer_id = ${customerId}
    ORDER BY agg.period_start DESC
    LIMIT 50
  `;
}

export async function GET(context: APIContext): Promise<Response> {
  const admin = await requireAdminApi(context.cookies, ['admin', 'desk']);
  if (!admin) return json({ error: 'unauthorized' }, 401);

  const id = parseInt(context.params.id ?? '', 10);
  if (Number.isNaN(id)) return json({ error: 'invalid_id' }, 400);

  const customer = await loadCustomer(id);
  if (!customer) return json({ error: 'not_found' }, 404);

  return json({ customer, bookings: await loadBookings(id) });
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
  const parsed = customerPatchSchema.safeParse(body);
  if (!parsed.success) return json({ error: 'validation', issues: parsed.error.issues }, 400);
  const data = parsed.data;

  const customer = await loadCustomer(id);
  if (!customer) return json({ error: 'not_found' }, 404);

  // ---- Caso estrella: CURP que ya existe en OTRO expediente → merge -----
  if (data.curp && data.curp !== customer.curp) {
    const clash = await sql`SELECT id, full_name FROM customers WHERE curp = ${data.curp} AND id <> ${id} LIMIT 1`;
    if (clash.length > 0) {
      // Gana el expediente que YA tenía el CURP (decisión del dueño): este
      // expediente se une a aquél; las reservas y el historial viajan.
      const merged = await mergeCustomers(sql, id, Number(clash[0].id));
      // El resto de campos editados (si venían) se aplican al sobreviviente
      // SOLO si no chocan con su nombre registrado.
      if (data.notes !== undefined) {
        await sql`UPDATE customers SET notes = COALESCE(${data.notes}, notes), updated_at = now() WHERE id = ${merged.id}`;
      }
      if (data.noShow !== undefined) {
        await sql`UPDATE customers SET no_show = ${data.noShow}, updated_at = now() WHERE id = ${merged.id}`;
      }
      const survivor = await loadCustomer(Number(merged.id));
      await logAudit(sql, admin, {
        action: 'merge',
        entity: 'customer',
        entityId: Number(merged.id),
        summary: `Expedientes fusionados por CURP: #${id} (${customer.full_name}) → #${merged.id} (${clash[0].full_name})`,
      }, context);
      return json({
        customer: survivor,
        mergedInto: { id: Number(clash[0].id), fullName: clash[0].full_name as string },
        bookings: await loadBookings(Number(merged.id)),
      });
    }
  }

  const columns: Record<string, unknown> = {};
  if (data.curp !== undefined) columns.curp = data.curp;
  if (data.fullName !== undefined) columns.full_name = data.fullName;
  if (data.email !== undefined) columns.email = data.email;
  if (data.phone !== undefined) columns.phone = data.phone;
  if (data.notes !== undefined) columns.notes = data.notes;
  if (data.noShow !== undefined) columns.no_show = data.noShow;

  if (Object.keys(columns).length > 0) {
    columns.updated_at = sql`now()`;
    await sql`UPDATE customers SET ${sql(columns)} WHERE id = ${id}`;
    await logAudit(sql, admin, {
      action: 'update',
      entity: 'customer',
      entityId: id,
      summary: `Expediente de ${data.fullName ?? customer.full_name} actualizado (${Object.keys(columns).filter(c => c !== 'updated_at').join(', ')})`,
      diff: Object.fromEntries(Object.entries(columns).map(([k, v]) => [k, { before: (customer as Record<string, unknown>)[k] ?? null, after: v }])),
    }, context);
  }

  const updated = await loadCustomer(id);
  return json({ customer: updated, bookings: await loadBookings(id) });
}

export function ALL(): Response {
  return new Response(null, { status: 405, headers: { Allow: 'GET, PATCH' } });
}
