// Seed de DATOS DEMO para mostrar el panel a interesados: reservas en
// varios estados (incluida una completada ayer y una activa HOY para que el
// dashboard luzca), un lead web sin atender, un bloqueo de taller y
// clientes con historial (uno con CURP ya capturado). Ejecutar DESPUÉS del
// seed de flota: `node --env-file=.env --import tsx scripts/seed-demo.ts`.
// Los periodos se calculan RELATIVOS A HOY para que dashboard/reports
// siempre tengan algo que mostrar, sin importar cuándo corras el script.
import postgres from 'postgres';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('falta DATABASE_URL: copia .env.example a .env');
  process.exit(1);
}
const sql = postgres(databaseUrl, { max: 1 });

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
    return r[0];
  };

  const code = () => {
    const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    const bytes = crypto.getRandomValues(new Uint8Array(6));
    return 'RPZ-' + Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
  };

  const insert = async (m: { unit_id: number }, opts: {
    status: string; start: Date; end: Date; name: string; email: string; phone: string;
    total: number; zone: string; kind?: string; notes?: string | null; flight?: string | null;
    requested?: unknown; pricing?: unknown;
  }) => {
    await sql`
      INSERT INTO bookings
        (code, kind, vehicle_id, customer_name, customer_email, customer_phone,
         flight_number, period, pickup_zone, extras, total_cents, deposit_type,
         status, notes, requested, pricing)
      VALUES
        (${code()}, ${opts.kind ?? 'rental'}, ${m.unit_id}, ${opts.name}, ${opts.email},
         ${opts.phone}, ${opts.flight ?? null},
         tstzrange(${opts.start}::timestamptz, ${opts.end}::timestamptz, '[)'),
         ${opts.zone}, '[]'::jsonb, ${opts.total}, ${Math.random() > 0.5 ? 'deposit' : 'on_pickup'},
         ${opts.status}, ${opts.notes ?? null},
         ${sql.json(opts.requested ?? {})}::jsonb, ${sql.json(opts.pricing ?? {})}::jsonb)
    `;
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

  console.log('demo lista: 5 rentas (2 completadas, 1 activa, 2 confirmadas), 1 lead web, 1 bloqueo, 3 expedientes');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => sql.end());
