// Seed de DATOS DEMO para mostrar el panel a interesados: reservas en
// varios estados (incluida una completada ayer y una activa HOY para que el
// dashboard luzca), un lead web sin atender, un bloqueo de taller y
// clientes con historial (uno con CURP ya capturado). Ejecutar DESPUÉS del
// seed de flota: `node --env-file=.env --import tsx scripts/seed-demo.ts`.
// Los periodos se calculan RELATIVOS A HOY para que dashboard/reports
// siempre tengan algo que mostrar, sin importar cuándo corras el script.
import { resolveDatabase, closeEmbeddedDatabases } from '../src/lib/db-conn';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('falta DATABASE_URL: copia .env.example a .env');
  process.exit(1);
}
const sql = await resolveDatabase(databaseUrl, { max: 1 });

const DAY = 86_400_000;
const now = Date.now();
const at = (days: number, hour = 12) => {
  const d = new Date(now + days * DAY);
  d.setHours(hour, 0, 0, 0);
  return d;
};

//Clientes demo con CURP válido en formato
async function main() {
  const existing = await sql`SELECT count(*)::int AS n FROM bookings`;
  if (existing[0].n > 0) {
    console.log(`ya hay ${existing[0].n} reservaciones — no se siembran datos demo`);
    return;
  }

  const model = async (slug: string) => {
    const r = await sql`SELECT m.id, m.slug, m.name, m.daily_rate_cents, v.id AS unit_id
                        FROM vehicle_models m JOIN vehicles v ON v.model_id = m.id
                        WHERE m.slug = ${slug} ORDER BY v.id LIMIT 1`;
    return r[0] as { id: number; unit_id: number };
  };

  const code = () => {
    const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    const bytes = crypto.getRandomValues(new Uint8Array(6));
    return 'RPZ-' + Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
  };

  const insert = async (m: { id: number; unit_id: number }, opts: {
    status: string; start: Date; end: Date; name: string; email: string; phone: string;
    total: number; zone: string; kind?: string; notes?: string | null; flight?: string | null;
    requested?: Record<string, unknown>; pricing?: Record<string, unknown>;
  }) => {
    // Cabecera + tramo 1 (migración 006): la unidad/período viven en el
    // segmento. Los 'quoted' (leads) bajan a tramo 'quoted' para no apartar.
    const segStatus = opts.status === 'quoted' ? 'quoted' : opts.status === 'confirmed' ? 'reserved' : opts.status;
    await sql`
      WITH new_booking AS (
        INSERT INTO bookings
          (code, kind, customer_name, customer_email, customer_phone, flight_number,
           total_cents, deposit_type, status, notes, requested, pricing)
        VALUES
          (${code()}, ${opts.kind ?? 'rental'}, ${opts.name}, ${opts.email}, ${opts.phone},
           ${opts.flight ?? null}, ${opts.total},
           ${Math.random() > 0.5 ? 'deposit' : 'on_pickup'},
           ${opts.status}, ${opts.notes ?? null},
           ${sql.json(JSON.parse(JSON.stringify(opts.requested ?? {})))}::jsonb,
           ${sql.json(JSON.parse(JSON.stringify(opts.pricing ?? {})))}::jsonb)
        RETURNING id
      )
      INSERT INTO booking_segments
        (booking_id, idx, model_id, vehicle_id, period, status, pricing,
         total_cents, extras, pickup_zone)
      SELECT nb.id, 1, ${m.id}, ${m.unit_id},
             tstzrange(${opts.start}::timestamptz, ${opts.end}::timestamptz, '[)'),
             ${segStatus},
             ${sql.json(JSON.parse(JSON.stringify(opts.pricing ?? {})))}::jsonb,
             ${opts.total}, '[]'::jsonb, ${opts.zone}
      FROM new_booking nb
    `;
  };

  // Renta MULTI-TRAMO: booking + N segments contiguos (distintos modelos).
  // Es la demo del replan: el board la muestra como chips y el calendario
  // pinta un tramo por placa. Inserts simples por tramo: sin CTEs ni unsafe.
  const insertMulti = async (
    parts: Array<{ m: { id: number; unit_id: number }; start: Date; end: Date; total: number }>,
    opts: {
      name: string; email: string; phone: string; status?: string;
      zone?: string; notes?: string | null;
      requested?: Record<string, unknown>;
    },
  ) => {
    const total = parts.reduce((sum, p) => sum + p.total, 0);
    const rows = await sql`
      INSERT INTO bookings
        (code, kind, customer_name, customer_email, customer_phone,
         total_cents, deposit_type, status, notes, requested, pricing)
      VALUES
        (${code()}, 'rental', ${opts.name}, ${opts.email}, ${opts.phone},
         ${total}, 'deposit', ${opts.status ?? 'confirmed'}, ${opts.notes ?? null},
         ${sql.json(JSON.parse(JSON.stringify({ channel: 'admin', ...(opts.requested ?? {}), totalCents: total })))}::jsonb,
         ${sql.json(JSON.parse(JSON.stringify({ source: 'adjust', reason: 'Cambio de vehículo por staff', totalCents: total })))}::jsonb)
      RETURNING id
    `;
    const bookingId = Number(rows[0].id);
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      await sql`
        INSERT INTO booking_segments
          (booking_id, idx, model_id, vehicle_id, period, status, pricing, total_cents, extras, pickup_zone)
        VALUES
          (${bookingId}, ${i + 1}, ${p.m.id}, ${p.m.unit_id},
           tstzrange(${p.start}::timestamptz, ${p.end}::timestamptz, '[)'),
           'reserved',
           ${sql.json(JSON.parse(JSON.stringify({ source: 'adjust', reason: 'Cambio de vehículo por staff', totalCents: p.total })))}::jsonb,
           ${p.total}, '[]'::jsonb, ${opts.zone ?? 'airport_mid'})
      `;
    }
  };

  const gol = await model('gol-5-puertas');
  const versa = await model('beat-sedan');
  const kicks = await model('kia-soul');
  const attitude = await model('dodge-attitude');
  const matiz = await model('chevrolet-matiz');
  const crv = await model('honda-crv');

  // 1) Completada AYER (dashboard: devolución de ayer, reports: ingreso)
  await insert(gol, {
    status: 'completed', start: at(-3), end: at(-1),
    name: 'Fernando Poot', email: 'fernando.poot@gmail.com', phone: '999 145 2201',
    total: 81200, zone: 'airport_mid', flight: 'AM405',
    requested: { channel: 'web', model: { name: 'V.W. Gol 5 puertas' }, totalCents: 81200 },
    pricing: { source: 'engine', totalCents: 81200 },
  });

  // 2) Completada la semana pasada (más volumen a reports)
  await insert(matiz, {
    status: 'completed', start: at(-9), end: at(-6),
    name: 'Lucía Huchim', email: 'lucia.huchim@outlook.com', phone: '999 208 7745',
    total: 92800, zone: 'centro',
    requested: { channel: 'web', model: { name: 'Chevrolet Matiz' }, totalCents: 92800 },
    pricing: { source: 'engine', totalCents: 92800 },
  });

  // 3) ACTIVA hoy (dashboard: entrega de hoy + ocupación)
  await insert(versa, {
    status: 'active', start: at(0, 9), end: at(2, 9),
    name: 'Óscar Espadas', email: 'oespadas@hotmail.com', phone: '999 310 4478',
    total: 104400, zone: 'airport_mid', flight: 'Y4402',
    notes: 'Entrega en llegadas, ya avisó que su vuelo se retrasa 40 min',
    requested: { channel: 'web', model: { name: 'Beat Sedan' }, totalCents: 104400 },
    pricing: { source: 'engine', totalCents: 104400 },
  });

  // 4) Confirmada futura con anticipo
  await insert(attitude, {
    status: 'confirmed', start: at(4), end: at(8),
    name: 'Marisol Cámara', email: 'marisol.camara@gmail.com', phone: '999 501 9930',
    total: 199640, zone: 'hotel_zone',
    requested: { channel: 'web', model: { name: 'Dodge Attitude' }, totalCents: 199640 },
    pricing: { source: 'engine', totalCents: 199640 },
  });

  // 5) Confirmada futura capturada por staff (canal admin)
  await insert(kicks, {
    status: 'confirmed', start: at(6), end: at(9),
    name: 'Grupo Xtampak (boda)', email: 'coordina@xtampak.mx', phone: '999 777 1122',
    total: 266800, zone: 'centro', notes: 'Coordinadora pidió factura y 2 conductores jóvenes; traer portaequipaje',
    requested: { channel: 'admin', model: { name: 'Kia Soul' }, totalCents: 266800 },
    pricing: { source: 'manual', totalCents: 266800 },
  });

  // 6) LEAD web sin atender (badge + follow-up demo) — choca con la 4)
  await insert(crv, {
    status: 'quoted', start: at(5), end: at(7),
    name: 'Jorge Bacab', email: 'jbacab@gmail.com', phone: '999 640 5512',
    total: 133120, zone: 'airport_mid',
    notes: 'Lead web: sin disponibilidad al intentar reservar',
    requested: { channel: 'web', model: { name: 'Dodge Attitude' }, totalCents: 133120, reason: 'sin_disponibilidad' },
    pricing: { source: 'engine', totalCents: 133120 },
  });

  // 7) Bloqueo de taller (calendario)
  await insert(matiz, {
    status: 'confirmed', kind: 'block', start: at(10, 8), end: at(12, 8),
    name: '', email: '', phone: '', total: 0, zone: 'office',
    notes: 'Taller: servicio de frenos y llantas',
  });

  // 8) Historia del MES PASADO (reportes con rango anterior y comparativas)
  await insert(attitude, {
    status: 'completed', start: at(-38), end: at(-35),
    name: 'Ricardo Cetina', email: 'ricardo.cetina@gmail.com', phone: '999 412 8890',
    total: 121500, zone: 'hotel_zone',
    requested: { channel: 'web', model: { name: 'Dodge Attitude' }, totalCents: 121500 },
    pricing: { source: 'engine', totalCents: 121500 },
  });
  await insert(kicks, {
    status: 'completed', start: at(-33), end: at(-29),
    name: 'Ana Gabriela Ku', email: 'ana.ku@outlook.com', phone: '999 224 6710',
    total: 178600, zone: 'centro',
    requested: { channel: 'admin', model: { name: 'Kia Soul' }, totalCents: 178600 },
    pricing: { source: 'manual', totalCents: 178600 },
  });
  await insert(gol, {
    status: 'cancelled', start: at(-30), end: at(-28),
    name: 'Mauricio Pech', email: 'maupech@gmail.com', phone: '999 330 5512',
    total: 61800, zone: 'airport_mid',
    notes: 'Canceló por cambio de vuelo; re reservó para el mes que entra',
    requested: { channel: 'web', model: { name: 'V.W. Gol 5 puertas' }, totalCents: 61800 },
    pricing: { source: 'engine', totalCents: 61800 },
  });

  // 9) LA JOYA: renta MULTI-TRAMO (2 días matiz + 3 días soul + 2 días CRV) —
  // el cliente cambió de vehículo a mitad de la renta; prorrateo por tramo.
  await insertMulti(
    [
      { m: matiz, start: at(15, 9), end: at(17, 9), total: 47200 },
      { m: kicks, start: at(17, 9), end: at(20, 9), total: 109200 },
      { m: crv, start: at(20, 9), end: at(22, 9), total: 87400 },
    ],
    {
      name: 'Valeria Canul', email: 'valeria.canul@gmail.com', phone: '999 887 2043',
      zone: 'airport_mid',
      notes: 'Cambio de vehículo a mitad de renta: empezó en Matiz, subió a Soul y cierra en CRV',
    },
  );

  // 10) Lead web adicional sin atender (embudo con más carne)
  await insert(crv, {
    status: 'quoted', start: at(19), end: at(22),
    name: 'Eduardo Pool', email: 'edpool@hotmail.com', phone: '999 156 3387',
    total: 149600, zone: 'centro',
    notes: 'Lead web: pidió fechas ya ocupadas; ofrecer alternativas',
    requested: { channel: 'web', model: { name: 'Honda CRV' }, totalCents: 149600, reason: 'sin_disponibilidad' },
    pricing: { source: 'engine', totalCents: 149600 },
  });

  // Expedientes de clientes demo (el CRM linkea por email al existir; estos
  // se crean directos para tener CURP e historial listos)
  const demoCustomers = [
    {
      curp: 'POOF880312HMCRQN09', full_name: 'Fernando Poot Osorio',
      email: 'fernando.poot@gmail.com', phone: '999 145 2201',
      notes: 'Cliente frecuente — siempre pide entrega en aeropuerto.',
      history: [{ kind: 'phone', value: '999 145 0099', retiredAt: new Date(now - 40 * DAY).toISOString() }],
    },
    {
      curp: null, full_name: 'Marisol Cámara Patrón',
      email: 'marisol.camara@gmail.com', phone: '999 501 9930',
      notes: null, history: [],
    },
    {
      curp: null, full_name: 'Jorge Bacab Canul',
      email: 'jbacab@gmail.com', phone: '999 640 5512',
      notes: 'Lead sin confirmar — dijo que llama hoy por la tarde.',
      history: [],
    },
    {
      curp: 'KUAG920418MCRZN03', full_name: 'Ana Gabriela Ku Ek',
      email: 'ana.ku@outlook.com', phone: '999 224 6710',
      notes: 'Cliente recurrente de fin de semana; factura a su empresa.',
      history: [{ kind: 'phone', value: '999 224 0088', retiredAt: new Date(now - 90 * DAY).toISOString() }],
    },
    {
      curp: 'CAUV010730HCRPSA06', full_name: 'Valeria Canul Uc',
      email: 'valeria.canul@gmail.com', phone: '999 887 2043',
      notes: 'La renta multi-tramo (cambió de auto a mitad). Flexible con cambios.',
      history: [],
    },
  ];
  for (const c of demoCustomers) {
    await sql`
      INSERT INTO customers (curp, full_name, email, phone, notes, contact_history)
      VALUES (${c.curp}, ${c.full_name}, ${c.email}, ${c.phone}, ${c.notes}, ${sql.json(c.history)}::jsonb)
      ON CONFLICT DO NOTHING
    `;
  }

  // Vincular bookings ↔ expedientes por email (los del staff/otros quedan sin)
  await sql`
    UPDATE bookings b
    SET customer_id = c.id
    FROM customers c
    WHERE lower(b.customer_email) = lower(c.email)
  `;

  console.log('demo lista: 10 rentas (5 completadas + 1 cancelada, 1 activa, 3 confirmadas incl. 1 multi-tramo), 2 leads web, 1 bloqueo, 5 expedientes');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
  await sql.end({ timeout: 5 });
  await closeEmbeddedDatabases();
  process.exit(0);
});
