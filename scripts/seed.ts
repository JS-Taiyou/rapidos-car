// ============================================================================
// SCRIPT: seed — datos iniciales realistas (flota, extras, temporadas, admin)
// ============================================================================
// Propósito: poblar la BD recién migrada con un catálogo usable para
// desarrollo: 4 modelos, 6 unidades, 3 extras, 3 temporadas, los settings
// obligatorios y el usuario admin. IDEMPOTENTE: corre mil veces sin duplicar
// ni tronar (ON CONFLICT DO NOTHING) — patrón esencial en scripts de datos:
// el seed que "solo corre una vez" siempre termina corriéndose dos veces.
//
// ----------------------------------------------------------------------------
// DECISIONES
// ----------------------------------------------------------------------------
// * Mismo bootstrap de cliente que scripts/migrate.ts (ver sus pasos 1-3):
//   import postgres from 'postgres', DATABASE_URL de process.env con el
//   mismo mensaje de error, { max: 1 } y sql.end() al final (§2.4/§2.5).
// * hashPassword se DUPLICA de src/lib/auth.ts en vez de importarse: auth.ts
//   vive en el mundo Astro/Vite (import.meta.env) y este script corre como
//   proceso Node independiente (process.env vía --env-file); importar auth.ts
//   arrastraría ese acoplamiento al script. Son ~15 líneas. La copia lleva el
//   aviso "MANTENER EN SYNC CON src/lib/auth.ts".
// * Flota típica de renta económica en Mérida (compactos Nissan + una van
//   familiar) y slugs cortos: son las URLs públicas (/flota/march).
// * Toda la corrida en UNA transacción: un seed a medias deja settings sin
//   iva_rate y pricing roto.
//
// ----------------------------------------------------------------------------
// PASOS
// ----------------------------------------------------------------------------
// 1. Bootstrap del cliente: copia los pasos 1-3 de scripts/migrate.ts
//    (import, DATABASE_URL con "copia .env.example a .env", { max: 1 }).
//    Envuelve todo en try/catch: error code '42P01' (undefined_table) →
//    aborta con "falta el esquema: corre primero `npm run db:migrate`".
//
// 2. Declara async function hashPassword(password: string): Promise<string>,
//    DUPLICADA de src/lib/auth.ts (PBKDF2 con Web Crypto, ARCHITECTURE §2.11):
//      - sal: crypto.getRandomValues(new Uint8Array(16))
//      - importa la password: crypto.subtle.importKey('raw', bytes, 'PBKDF2', false, ['deriveBits'])
//      - deriva: crypto.subtle.deriveBits({ name:'PBKDF2', salt, iterations: 210_000, hash:'SHA-256' }, key, 256)
//      - sal y hash a hex; retorna `pbkdf2:210000:${saltHex}:${hashHex}`
//    // MANTENER EN SYNC CON src/lib/auth.ts — si allá cambian iteraciones o
//    // formato, este seed genera passwords que el login rechaza.
//
// 3. vehicle_models — 4 renglones (photos '{}' por ahora, ver ERRORES COMUNES):
//      'march'   Nissan March       compact manual    5 asientos 2 maletas 45000 ($450.00 MXN/día)
//      'versa'   Nissan Versa       compact automatic 5          2         50000 ($500.00)
//      'kicks'   Nissan Kicks       suv     automatic 5          3         75000 ($750.00)
//      'avanza'  Chevrolet Avanza   van     manual    7          4         90000 ($900.00)
//    INSERT con ON CONFLICT (slug) DO NOTHING. Centavos enteros, siempre
//    (ARCHITECTURE §2.13): nunca 450.00 como float.
//
// 4. vehicles — 6 unidades: 2 March ('YXB-1234', 'YXB-1235'), 2 Versa
//    ('YXC-2345', 'YXC-2346'), 1 Kicks ('YXD-3456'), 1 Avanza ('YXE-4567').
//    Placas ficticias formato Yucatán (3 letras + 4 dígitos). model_id con
//    subquery: (SELECT id FROM vehicle_models WHERE slug='march').
//    ON CONFLICT (plate) DO NOTHING.
//
// 5. extras — ON CONFLICT (name) DO NOTHING:
//      'Silla de bebé'                   8000   per 'day'  ($80.00/día)
//      'Conductor adicional'             5000   per 'day'  ($50.00/día)
//      'Seguro premium cobertura amplia' 25000  per 'day'  ($250.00/día)
//
// 6. seasons — OJO: daterange en Postgres es [) (incluye inicio, EXCLUYE
//    fin): "hasta el 5 de enero inclusive" se escribe con límite '2026-01-06'.
//    Si al capturar piensas en el último día, súmale uno.
//      'Temporada alta diciembre'  ['2025-12-15','2026-01-06')  multiplier 1.30
//      'Semana Santa'              ['2026-03-29','2026-04-05')  multiplier 1.25
//      'Verano'                    ['2026-07-15','2026-08-20')  multiplier 1.20
//    seasons.name NO tiene UNIQUE (ver 001_init.sql paso 3): en vez de
//    ON CONFLICT usa INSERT … SELECT … WHERE NOT EXISTS (SELECT 1 FROM
//    seasons WHERE name = …) para lograr la misma idempotencia.
//
// 7. settings — ON CONFLICT (key) DO NOTHING; value es jsonb: serializa con
//    JSON.stringify en JS y castea ::jsonb en el INSERT:
//      'turnaround_buffer_minutes'  120
//      'delivery_zones'             [{"zone":"airport_mid","fee_cents":0},
//                                    {"zone":"centro","fee_cents":15000},
//                                    {"zone":"norte","fee_cents":20000},
//                                    {"zone":"hotel_zone","fee_cents":25000}]
//      'iva_rate'                   0.16
//      'long_rental_discounts'      [{"min_days":7,"pct":10},{"min_days":30,"pct":20}]
//      'whatsapp_staff_number'      "5219990000000"   (placeholder; cámbialo)
//
// 8. admin_users — un renglón: email 'admin@rapidoz.local', password de
//    process.env.ADMIN_PASSWORD ?? 'cambia-esto-ahora', hasheada con la
//    función del paso 2. ON CONFLICT (email) DO NOTHING.
//    // CAMBIA ESTA PASSWORD EN EL PRIMER LOGIN Y NUNCA COMMITEES LA REAL:
//    // ni en .env (está en .gitignore por algo) ni escrita en este archivo.
//
// 9. Envuelve los pasos 3-8 en una sola transacción (BEGIN/COMMIT/ROLLBACK
//    como en migrate.ts paso 7, o el wrapper sql.begin(tx => …)) y log de
//    conteos por tabla. OJO: con DO NOTHING el `count` dice cuántos entraron
//    de verdad (0 = ya existía): "vehicle_models: 2 insertados, 2 ya existían".
//    Cierra con await sql.end().
//
// ----------------------------------------------------------------------------
// CONTRATO
// ----------------------------------------------------------------------------
// Ejecuta: `npm run db:seed` DESPUÉS de `npm run db:migrate`. Deja en la
// BD: catálogo cotizable vía /api/quote, los settings que leen
// availability.ts y pricing.ts, y un admin para /admin/login. Re-ejecutable.
//
// ----------------------------------------------------------------------------
// ERRORES COMUNES
// ----------------------------------------------------------------------------
// 1. Insertar el admin con la password en PLANO → el login calcula PBKDF2 y
//    nunca hará match; el hash se genera aquí (paso 2), no en la BD.
// 2. Olvidar que photos queda '{}' → /flota sale sin fotos. Patrón de rutas:
//    sube archivos a /public/images/fleet/ (march-1.jpg…) y actualiza:
//    UPDATE vehicle_models SET photos = '{/images/fleet/march-1.jpg}' WHERE slug='march';
// 3. Correr el seed sin haber migrado → Postgres lanza 42P01; detecta ese
//    code y sugiere `npm run db:migrate` en vez de soltar el stacktrace.
// ============================================================================
