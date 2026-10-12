// GET /api/admin/export/rentas?from=&to=&status= — libro XLS para el
// contador (ROADMAP 7.3): hoja "Rentas" (una fila por renta) y hoja
// "Desglose" (una fila por tramo). Moneda MXN, fechas dd/mm/yyyy en
// América/Mérida y totales con fórmula SUM (el contador puede auditar la
// celda). La exportación queda en audit_log.
import type { APIContext } from 'astro';
import type ExcelJSNamespace from 'exceljs';
import { sql } from '../../../../lib/db';
import { requireAdminApi } from '../../../../lib/auth';
import { getTenant } from '../../../../lib/tenant';
import { logAudit } from '../../../../lib/audit';

export const prerender = false;

const CHANNEL_LABEL: Record<string, string> = { web: 'Web', admin: 'Staff', sin_dato: 'Sin dato' };
const STATUS_LABEL: Record<string, string> = {
  quoted: 'Cotizada', confirmed: 'Confirmada', active: 'Activa',
  completed: 'Completada', cancelled: 'Cancelada',
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function GET(context: APIContext): Promise<Response> {
  const admin = await requireAdminApi(context.cookies);
  if (!admin) return json({ error: 'unauthorized' }, 401);

  const params = context.url.searchParams;
  const from = params.get('from');
  const to = params.get('to');
  if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return json({ error: 'invalid_range' }, 400);
  }
  const status = params.get('status');

  const rows = await sql`
    SELECT b.id, b.code, b.kind, b.status, b.total_cents, b.deposit_type,
           b.customer_name, b.customer_phone, b.requested->>'channel' AS channel,
           lower(s.period) AS seg_start, upper(s.period) AS seg_end,
           s.idx AS seg_idx, s.total_cents AS seg_total, s.pricing AS seg_pricing,
           m.name AS model_name, v.plate,
           min(lower(s.period)) OVER (PARTITION BY b.id) AS rental_start,
           max(upper(s.period)) OVER (PARTITION BY b.id) AS rental_end
    FROM bookings b
    JOIN booking_segments s ON s.booking_id = b.id
    JOIN vehicle_models m ON m.id = s.model_id
    LEFT JOIN vehicles v ON v.id = s.vehicle_id
    WHERE b.kind = 'rental'
      AND ${status ? sql`b.status = ${status}` : sql`TRUE`}
      AND EXISTS (
        SELECT 1 FROM booking_segments s2
        WHERE s2.booking_id = b.id
          AND s2.period && tstzrange(${from}::timestamptz, ${to}::timestamptz, '[)')
      )
    ORDER BY min(lower(s.period)) OVER (PARTITION BY b.id), b.id, s.idx
  `;

  const tenant = await getTenant();
  // Import dinámico: exceljs es CJS/UMD — así Node lo requiere nativo y Vite
  // no intenta transformarlo para SSR (rompería con "module is not defined").
  const ExcelJS = (await import('exceljs')).default as typeof ExcelJSNamespace;
  const wb = new ExcelJS.Workbook();
  wb.creator = tenant.name;
  wb.created = new Date();

  const moneyFmt = '"$"#,##0.00';
  const dateFmt = 'dd/mm/yyyy';

  const bold = { font: { bold: true } };
  const headerFill = { fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE3F2F5' } } };

  // ---- Hoja Rentas: una fila por renta -------------------------------------
  const ws = wb.addWorksheet('Rentas', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [
    { header: 'Código', key: 'code', width: 15 },
    { header: 'Cliente', key: 'customer', width: 26 },
    { header: 'Teléfono', key: 'phone', width: 15 },
    { header: 'Canal', key: 'channel', width: 10 },
    { header: 'Estado', key: 'status', width: 12 },
    { header: 'Entrega', key: 'start', width: 12 },
    { header: 'Devolución', key: 'end', width: 12 },
    { header: 'Tramos', key: 'segments', width: 48 },
    { header: 'Depósito', key: 'deposit', width: 12, style: { numFmt: moneyFmt } },
    { header: 'Total', key: 'total', width: 13, style: { numFmt: moneyFmt } },
  ];
  ws.getRow(1).eachCell((c) => Object.assign(c, bold, headerFill));

  // Agrupa por renta (la query trae una fila por tramo).
  interface RentalAcc {
    code: string; customer: string; phone: string; channel: string; status: string;
    start: Date; end: Date; segments: string[]; deposit: number; total: number;
  }
  const acc = new Map<number, RentalAcc>();
  for (const r of rows as unknown as Array<Record<string, unknown>>) {
    const id = Number(r.id);
    let a = acc.get(id);
    if (!a) {
      a = {
        code: r.code as string,
        customer: (r.customer_name as string) ?? '',
        phone: (r.customer_phone as string) ?? '',
        channel: CHANNEL_LABEL[(r.channel as string) ?? 'sin_dato'] ?? (r.channel as string),
        status: STATUS_LABEL[r.status as string] ?? (r.status as string),
        start: new Date(r.rental_start as string),
        end: new Date(r.rental_end as string),
        segments: [],
        deposit: 0,
        total: Number(r.total_cents) / 100,
      };
      acc.set(id, a);
    }
    const price = (r.seg_pricing ?? {}) as Record<string, unknown>;
    a.deposit += Number(price.depositCents ?? 0) / 100;
    const d = new Intl.DateTimeFormat('es-MX', { day: '2-digit', month: 'short', timeZone: 'America/Merida' });
    a.segments.push(`${d.format(new Date(r.seg_start as string))} ${r.model_name}${r.plate ? ` (${r.plate})` : ''}`);
  }
  for (const a of acc.values()) {
    ws.addRow({
      ...a,
      start: { formula: `DATE(${a.start.getFullYear()},${a.start.getMonth() + 1},${a.start.getDate()})`, result: a.start },
      end: { formula: `DATE(${a.end.getFullYear()},${a.end.getMonth() + 1},${a.end.getDate()})`, result: a.end },
      segments: a.segments.join(' · '),
    }).getCell('start').numFmt = dateFmt;
  }
  const n = acc.size;
  if (n > 0) {
    const totalRow = ws.addRow({ code: 'TOTAL', total: { formula: `SUM(J2:J${n + 1})` } });
    totalRow.eachCell((c) => Object.assign(c, bold));
    totalRow.getCell('total').numFmt = moneyFmt;
    ws.autoFilter = { from: 'A1', to: 'J1' };
  }

  // ---- Hoja Desglose: una fila por tramo -----------------------------------
  const ws2 = wb.addWorksheet('Desglose', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws2.columns = [
    { header: 'Código', key: 'code', width: 15 },
    { header: 'Tramo', key: 'idx', width: 7 },
    { header: 'Inicio', key: 'start', width: 12 },
    { header: 'Fin', key: 'end', width: 12 },
    { header: 'Días', key: 'days', width: 7 },
    { header: 'Modelo', key: 'model', width: 22 },
    { header: 'Placa', key: 'plate', width: 11 },
    { header: 'Tarifa/día', key: 'rate', width: 11, style: { numFmt: moneyFmt } },
    { header: 'Subtotal días', key: 'subtotal', width: 13, style: { numFmt: moneyFmt } },
    { header: 'Extras', key: 'extras', width: 11, style: { numFmt: moneyFmt } },
    { header: 'Entrega/recogida', key: 'delivery', width: 15, style: { numFmt: moneyFmt } },
    { header: 'IVA', key: 'tax', width: 11, style: { numFmt: moneyFmt } },
    { header: 'Total tramo', key: 'total', width: 13, style: { numFmt: moneyFmt } },
  ];
  ws2.getRow(1).eachCell((c) => Object.assign(c, bold, headerFill));
  const asDate = (v: unknown) => {
    const d = new Date(v as string);
    return { formula: `DATE(${d.getFullYear()},${d.getMonth() + 1},${d.getDate()})`, result: d };
  };
  let m = 0;
  for (const r of rows as unknown as Array<Record<string, unknown>>) {
    const p = (r.seg_pricing ?? {}) as Record<string, unknown>;
    const cents = (k: string) => Number(p[k] ?? 0) / 100;
    const row = ws2.addRow({
      code: r.code,
      idx: Number(r.seg_idx),
      start: asDate(r.seg_start),
      end: asDate(r.seg_end),
      days: Number(p.daysCount ?? 0),
      model: r.model_name,
      plate: (r.plate as string) ?? '',
      rate: Number(p.dailyRateCents ?? 0) / 100,
      subtotal: cents('subtotalCents'),
      extras: cents('extrasCents'),
      delivery: cents('deliveryFeeCents'),
      tax: cents('taxCents'),
      total: Number(r.seg_total) / 100,
    });
    row.getCell('start').numFmt = dateFmt;
    row.getCell('end').numFmt = dateFmt;
    m++;
  }
  if (m > 0) {
    const totalRow = ws2.addRow({ code: 'TOTAL', total: { formula: `SUM(M2:M${m + 1})` } });
    totalRow.eachCell((c) => Object.assign(c, bold));
    totalRow.getCell('total').numFmt = moneyFmt;
    ws2.autoFilter = { from: 'A1', to: 'M1' };
  }

  const buffer = await wb.xlsx.writeBuffer();

  await logAudit(sql, admin, {
    action: 'export',
    entity: 'booking',
    summary: `Exportación XLS (${from} → ${to}${status ? `, estado ${status}` : ''}): ${n} renta(s), ${m} tramo(s)`,
  }, context);

  return new Response(buffer as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="rentas_${from}_${to}.xlsx"`,
    },
  });
}

export function ALL(): Response {
  return new Response(null, { status: 405, headers: { Allow: 'GET' } });
}
