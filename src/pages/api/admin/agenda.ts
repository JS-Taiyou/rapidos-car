// GET /api/admin/agenda?date=YYYY-MM-DD — entregas y devoluciones del día
// por TRAMO (ROADMAP Fase 3). Es el alimento de /admin/entregas y del PWA
// del staff: lo mínimo para trabajar el patio sin abrir el tablero completo.
// Default: HOY en la zona del negocio (nunca new Date() del servidor, §2.13).
import type { APIContext } from 'astro';
import { sql } from '../../../lib/db';
import { requireAdminApi } from '../../../lib/auth';

export const prerender = false;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function GET(context: APIContext): Promise<Response> {
  const admin = await requireAdminApi(context.cookies, ['admin', 'desk', 'yard']);
  if (!admin) return json({ error: 'unauthorized' }, 401);

  const dateRaw = context.url.searchParams.get('date');
  const date = /^\d{4}-\d{2}-\d{2}$/.test(dateRaw ?? '')
    ? dateRaw!
    : new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Merida' }).format(new Date());

  // Tramos que EMPIEZAN hoy (entregas) o TERMINAN hoy (devoluciones), con
  // la unidad aún por entregar/recoger (reserved/active). handover_* IS NULL
  // distingue lo pendiente de lo ya capturado.
  const rows = await sql`
    SELECT s.id AS segment_id, s.idx, s.status AS seg_status,
           s.handover_out IS NOT NULL AS done_out,
           s.handover_in IS NOT NULL AS done_in,
           lower(s.period) AS start_at, upper(s.period) AS end_at,
           s.pickup_zone, s.return_zone,
           b.id AS booking_id, b.code, b.status AS booking_status, b.kind,
           b.customer_name, b.customer_phone, b.flight_number, b.notes,
           m.name AS model_name, v.plate
    FROM booking_segments s
    JOIN bookings b ON b.id = s.booking_id AND b.kind = 'rental'
                    AND b.status IN ('confirmed','active')
    JOIN vehicle_models m ON m.id = s.model_id
    LEFT JOIN vehicles v ON v.id = s.vehicle_id
    WHERE s.status IN ('reserved','active')
      AND (
        (lower(s.period) AT TIME ZONE 'America/Merida')::date = ${date}::date
        OR (upper(s.period) AT TIME ZONE 'America/Merida')::date = ${date}::date
      )
    ORDER BY lower(s.period), upper(s.period)
  `;

  const pickups = rows.filter((r) => {
    const d = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Merida' }).format(new Date(r.start_at));
    return d === date;
  });
  const returns = rows.filter((r) => {
    const d = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Merida' }).format(new Date(r.end_at));
    return d === date;
  });

  return json({ date, pickups, returns });
}

export function ALL(): Response {
  return new Response(null, { status: 405, headers: { Allow: 'GET' } });
}
