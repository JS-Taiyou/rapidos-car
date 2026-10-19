// Seed de datos iniciales realistas (flota, extras, temporadas, settings,
// admin). IDEMPOTENTE: ON CONFLICT DO NOTHING / WHERE NOT EXISTS — corre mil
// veces sin duplicar. `npm run db:seed` DESPUÉS de `npm run db:migrate`.
import { resolveDatabase, closeEmbeddedDatabases } from '../src/lib/db-conn';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('falta DATABASE_URL: copia .env.example a .env');
  process.exit(1);
}

const sql = await resolveDatabase(databaseUrl, { max: 1 });

// MANTENER EN SYNC CON src/lib/auth.ts — si allá cambian iteraciones o
// formato, este seed genera passwords que el login rechaza.
async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 210_000, hash: 'SHA-256' },
    keyMaterial,
    256,
  );
  const toHex = (bytes: Uint8Array) =>
    Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `pbkdf2:210000:${toHex(salt)}:${toHex(new Uint8Array(bits))}`;
}

try {
  await sql.begin(async (tx) => {
    // Flota de ejemplo replicada de un negocio real de renta en Mérida
    // (nombres, categorías, transmisión, asientos y tarifa por día
    // según publican). Maletas estimadas por categoría (TODO: confirmar).
    // Dodge Attitude aparece en mediano ($350) y grande ($400): dos filas,
    // como en el original.
    const FLEET = [
      // chico $250/día, estándar, 4 personas
      { slug: 'beat-hatchback', name: 'Beat Hatchback', category: 'small', transmission: 'manual', seats: 4, luggage: 1, rate: 25000 },
      { slug: 'chevrolet-matiz', name: 'Chevrolet Matiz', category: 'small', transmission: 'manual', seats: 4, luggage: 1, rate: 25000 },
      { slug: 'chevrolet-spark', name: 'Chevrolet Spark', category: 'small', transmission: 'manual', seats: 4, luggage: 1, rate: 25000 },
      { slug: 'dodge-i10', name: 'Dodge i 10', category: 'small', transmission: 'manual', seats: 4, luggage: 1, rate: 25000 },
      // compacto $300/día, estándar, 4 personas
      { slug: 'gol-5-puertas', name: 'V.W. Gol 5 puertas', category: 'compact', transmission: 'manual', seats: 4, luggage: 2, rate: 30000 },
      { slug: 'beat-sedan', name: 'Beat Sedan', category: 'compact', transmission: 'manual', seats: 4, luggage: 2, rate: 30000 },
      { slug: 'chevy-aveo', name: 'Chevy Aveo', category: 'compact', transmission: 'manual', seats: 4, luggage: 2, rate: 30000 },
      { slug: 'gol-4-puertas', name: 'V.W. Gol 4 puertas', category: 'compact', transmission: 'manual', seats: 4, luggage: 2, rate: 30000 },
      // mediano $350/día, 5 personas
      { slug: 'dodge-attitude', name: 'Dodge Attitude', category: 'medium', transmission: 'manual', seats: 5, luggage: 2, rate: 35000 },
      { slug: 'chevrolet-aveo', name: 'Chevrolet Aveo', category: 'medium', transmission: 'manual', seats: 5, luggage: 2, rate: 35000 },
      { slug: 'vw-jetta', name: 'V.W. Jetta', category: 'medium', transmission: 'automatic', seats: 5, luggage: 2, rate: 35000 },
      { slug: 'nissan-tida', name: 'Nissan Tida', category: 'medium', transmission: 'manual', seats: 5, luggage: 2, rate: 35000 },
      // grande $400/día, 5 personas
      { slug: 'kia-soul', name: 'Kia Soul', category: 'large', transmission: 'automatic', seats: 5, luggage: 3, rate: 40000 },
      { slug: 'jeep-liberty', name: 'Jeep Liberty', category: 'large', transmission: 'automatic', seats: 5, luggage: 3, rate: 40000 },
      { slug: 'dodge-attitude-grande', name: 'Dodge Attitude', category: 'large', transmission: 'manual', seats: 5, luggage: 3, rate: 40000 },
      { slug: 'honda-crv', name: 'Honda CRV', category: 'large', transmission: 'automatic', seats: 5, luggage: 3, rate: 40000 },
      { slug: 'toyota-corolla', name: 'Toyota Corolla', category: 'large', transmission: 'automatic', seats: 5, luggage: 3, rate: 40000 },
      { slug: 'jetta-mk', name: 'Jetta MK', category: 'large', transmission: 'automatic', seats: 5, luggage: 3, rate: 40000 },
      // camioneta o van
      { slug: 'chevrolet-extress', name: 'Chevrolet Extress', category: 'van', transmission: 'manual', seats: 8, luggage: 6, rate: 45000 },
      { slug: 'chevrolet-suburban', name: 'Chevrolet Suburban', category: 'van', transmission: 'automatic', seats: 8, luggage: 6, rate: 55000 },
      { slug: 'town-country', name: 'Chrysler Town & Country', category: 'van', transmission: 'automatic', seats: 8, luggage: 6, rate: 55000 },
      { slug: 'toyota-siena', name: 'Toyota Siena', category: 'van', transmission: 'automatic', seats: 8, luggage: 6, rate: 55000 },
      { slug: 'nissan-urvan', name: 'Nissan Urvan', category: 'van', transmission: 'manual', seats: 15, luggage: 8, rate: 60000 },
      // camioneta de carga $650/día, 3 personas
      { slug: 'toyota-tacoma', name: 'Toyota Tacoma', category: 'cargo', transmission: 'manual', seats: 3, luggage: 0, rate: 65000 },
      { slug: 'nissan-estacas', name: 'Nissan Estacas', category: 'cargo', transmission: 'manual', seats: 3, luggage: 0, rate: 65000 },
      { slug: 'nissan-caja-seca', name: 'Nissan Caja Seca', category: 'cargo', transmission: 'manual', seats: 3, luggage: 0, rate: 65000 },
      { slug: 'toyota-pick-up', name: 'Toyota Pick Up', category: 'cargo', transmission: 'manual', seats: 3, luggage: 0, rate: 65000 },
      { slug: 'ford-ranger', name: 'Ford Ranger', category: 'cargo', transmission: 'manual', seats: 3, luggage: 0, rate: 65000 },
    ];

    // Fotos del catálogo: viven en el repo (public/images/fleet/<slug>-N.webp,
    // 56 archivos commiteados) — el seed las asigna por convención de nombre,
    // sin URLs externas. Para modelos ya existentes SIN fotos (siembras viejas),
    // el upsert las repara: photos vacía => rellenar.
    const { readdir } = await import('node:fs/promises');
    const fleetDir = new URL('../public/images/fleet/', import.meta.url);
    const imageFiles = (await readdir(fleetDir)).filter((f) => f.endsWith('.webp')).sort();
    const photosBySlug = new Map<string, string[]>();
    for (const file of imageFiles) {
      const match = file.match(/^(.+)-\d+\.webp$/);
      if (!match) continue;
      const slug = match[1];
      const list = photosBySlug.get(slug) ?? [];
      list.push(`/images/fleet/${file}`);
      photosBySlug.set(slug, list);
    }

    let insertedModels = 0;
    for (const m of FLEET) {
      const photos = photosBySlug.get(m.slug) ?? [];
      const rows = await tx`
        INSERT INTO vehicle_models
          (slug, name, category, transmission, seats, luggage, daily_rate_cents, photos)
        VALUES
          (${m.slug}, ${m.name}, ${m.category}, ${m.transmission}, ${m.seats},
           ${m.luggage}, ${m.rate}, ${photos}::text[])
        ON CONFLICT (slug) DO UPDATE
          SET photos = EXCLUDED.photos
          WHERE vehicle_models.photos = '{}'
        RETURNING slug
      `;
      insertedModels += rows.length;
    }
    console.log(`vehicle_models: ${insertedModels} insertados/reparados (${photosBySlug.size} con fotos)`);

    // 1 unidad por modelo con placa pendiente (TODO: reemplazar por placas
    // reales desde /admin/flota) — sin unidad física el modelo no cotiza.
    const units = await tx`
      INSERT INTO vehicles (model_id, plate)
      SELECT m.id, 'PEND-' || lpad((row_number() over (ORDER BY m.slug))::text, 3, '0')
      FROM vehicle_models m
      WHERE NOT EXISTS (SELECT 1 FROM vehicles v WHERE v.model_id = m.id)
      RETURNING id
    `;
    console.log(`vehicles: ${units.length} insertados`);

    const extras = await tx`
      INSERT INTO extras (name, price_cents, per)
      VALUES
        ('Silla de bebé',                    8000, 'day'),
        ('Conductor adicional',              5000, 'day'),
        ('Seguro premium cobertura amplia', 25000, 'day')
      ON CONFLICT (name) DO NOTHING
      RETURNING id
    `;
    console.log(`extras: ${extras.length} insertados`);

    // seasons — daterange es [): "hasta el 5 de enero inclusive" se escribe
    // con límite '2026-01-06'. seasons.name NO tiene UNIQUE → WHERE NOT EXISTS.
    const seasons = await tx`
      INSERT INTO seasons (name, period, multiplier)
      SELECT * FROM (VALUES
        ('Temporada alta diciembre', daterange('2025-12-15', '2026-01-06'), 1.30::numeric),
        ('Semana Santa',             daterange('2026-03-29', '2026-04-05'), 1.25::numeric),
        ('Verano',                   daterange('2026-07-15', '2026-08-20'), 1.20::numeric)
      ) AS s(name, period, multiplier)
      WHERE NOT EXISTS (SELECT 1 FROM seasons se WHERE se.name = s.name)
      RETURNING id
    `;
    console.log(`seasons: ${seasons.length} insertados`);

    const settings = await tx`
      INSERT INTO settings (key, value) VALUES
        ('turnaround_buffer_minutes', '120'::jsonb),
        ('delivery_zones', ${sql.json([
          { zone: 'airport_mid', fee_cents: 0 },
          { zone: 'centro', fee_cents: 15000 },
          { zone: 'norte', fee_cents: 20000 },
          { zone: 'hotel_zone', fee_cents: 25000 },
        ])}::jsonb),
        ('iva_rate', '0.16'::jsonb),
        ('long_rental_discounts', ${sql.json([
          { min_days: 7, pct: 10 },
          { min_days: 30, pct: 20 },
        ])}::jsonb),
        ('whatsapp_staff_number', '5219990000000'::jsonb)
      ON CONFLICT (key) DO NOTHING
      RETURNING key
    `;
    console.log(`settings: ${settings.length} insertados`);

    // Puntos de entrega — catálogo COMPLETO (catálogo vivo de /admin/puntos).
    // La migración 005 importa las zonas desde settings.delivery_zones, pero
    // en una base fresca las migraciones corren ANTES de que exista ese
    // setting y el import no encuentra nada (el select público queda vacío);
    // el seed es quien garantiza el catálogo base. Idempotente.
    const points = await tx`
      INSERT INTO pickup_points (key, name, fee_cents, lat, lng, sort_order)
      VALUES
        ('airport_mid',  'Aeropuerto Internacional de Mérida', 0,     20.9370, -89.6579, 1),
        ('centro',       'Centro de Mérida',                   15000, NULL,    NULL,     2),
        ('norte',        'Zona norte',                         20000, NULL,    NULL,     3),
        ('hotel_zone',   'Zona hotelera',                      25000, NULL,    NULL,     4),
        ('altabrisa',    'Plaza Altabrisa',                    18000, 20.9980, -89.6174, 5),
        ('chapur',       'Plaza Chapur',                       15000, 20.9741, -89.6249, 6),
        ('hyatt_merida', 'Hyatt Regency Mérida',               20000, 21.0536, -89.6215, 7)
      ON CONFLICT (key) DO NOTHING
      RETURNING id
    `;
    console.log(`pickup_points: ${points.length} insertados`);

    // CAMBIA ESTA PASSWORD EN EL PRIMER USO Y NUNCA COMMITEES LA REAL.
    const adminPassword = process.env.ADMIN_PASSWORD ?? 'cambia-esto-ahora';
    const admins = await tx`
      INSERT INTO admin_users (email, password_hash)
      VALUES ('admin@rapidoz.local', ${await hashPassword(adminPassword)})
      ON CONFLICT (email) DO NOTHING
      RETURNING id
    `;
    console.log(`admin_users: ${admins.length} insertados`);
  });
} catch (err) {
  if ((err as { code?: string }).code === '42P01') {
    console.error('falta el esquema: corre primero `npm run db:migrate`');
    process.exit(1);
  }
  throw err;
} finally {
  await sql.end({ timeout: 5 });
  await closeEmbeddedDatabases();
  // Salida explícita: el socket de PGlite puede dejar handlers vivos en Windows.
  process.exit(0);
}
