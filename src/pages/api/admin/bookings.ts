// ============================================================================
// API: /api/admin/bookings — GET lista con filtros · POST captura manual/bloqueo
// ============================================================================
// PROPÓSITO
// El corazón del ReservationsBoard: listar el pipeline con filtros y dar de
// alta rentas de teléfono/walk-in y bloqueos de taller (spec §4.3).
//
// ----------------------------------------------------------------------------
// DECISIONES
// ----------------------------------------------------------------------------
// * PASO 0 SIEMPRE: requireAdminApi(context.cookies) → 401. Todo archivo bajo
//   /api/admin/* empieza así; no hay middleware (ARCHITECTURE §2.3).
// * kind='block' es una fila más de bookings (§2.10): la constraint no_overlap
//   lo cubre GRATIS, pero solo si status='confirmed' — el WHERE parcial de la
//   constraint solo mira 'confirmed' y 'active' (001_init.sql paso 4). Un
//   block en 'quoted' NO bloquea nada. Por eso el INSERT de bloqueo nace
//   'confirmed'.
// * Captura manual con override de total: el walk-in negocia precio en
//   mostrador. computeQuote da el total de referencia; el admin puede mandar
//   totalCentsOverride, y el override queda registrado en notes ("tarifa
//   calculada X, cobrado Y, motivo...").
// * Límite 200 sin cursor: con el volumen de un negocio chico (cientos de
//   rentas al mes) basta paginar por rango de fechas; un cursor por id sería
//   complejidad sin beneficio real.
//
// ----------------------------------------------------------------------------
// PASOS
// ----------------------------------------------------------------------------
// 0. En AMBOS handlers, primera línea: const admin = await
//    requireAdminApi(context.cookies); if (!admin) → 401
//    { error: 'unauthorized' }. (Paso 0 de todo /api/admin/*, §2.3.)
// 1. export const prerender = false (COMENTADO hasta instalar el adapter, §6).
// 2. Imports (comentados): type APIContext de 'astro'; sql, pickFreeUnit,
//    computeQuote, manualBookingSchema desde '../../../lib/...'. Helper json().
// 3. export async function GET(context: APIContext):
//    a. Lee query params de context.url.searchParams: from, to (ISO date),
//       status, kind — todos opcionales.
//    b. WHERE dinámico con fragments de postgres.js: arma un arreglo de
//       condiciones (sql`b.period && tstzrange(${from}, ${to}, '[)')` si hay
//       rango; sql`b.status = ${status}`; sql`b.kind = ${kind}`) y redúcelo:
//       conds.reduce((acc, c) => sql`${acc} AND ${c}`, sql`TRUE`). NUNCA
//       concatenes strings de SQL: los fragments de postgres.js escapan los
//       valores; la concatenación manual no (inyección SQL).
//    c. Query: SELECT b.*, v.plate, m.name AS model_name, m.slug AS model_slug
//       FROM bookings b JOIN vehicles v ON v.id = b.vehicle_id
//       JOIN vehicle_models m ON m.id = v.model_id
//       WHERE <condiciones> ORDER BY lower(b.period) DESC LIMIT 200.
//    d. 200 { bookings: rows }.
// 4. export async function POST(context: APIContext):
//    a. request.json() en try/catch → 400; manualBookingSchema.safeParse → 400
//       { error: 'validation', issues } (§2.12).
//    b. Si kind === 'block': vehicleId OBLIGATORIO (un bloqueo es de una placa
//       concreta: "el Kicks placa X al taller"). INSERT directo, sin
//       transacción: kind 'block', vehicle_id, period tstzrange(start, end,
//       '[)'), pickup_zone 'office' (placeholder), extras '[]', total_cents 0,
//       deposit_type 'on_pickup' (placeholder: el CHECK lo exige), status
//       'confirmed', notes del body, customer_* NULL (el CHECK
//       kind='block' OR customer_name IS NOT NULL lo permite). catch 23P01 →
//       409 { error: 'unavailable' }. Éxito: 201 { booking }.
//    c. Si kind === 'rental': MISMO flujo transaccional que /api/bookings
//       público (carga ctx de precios, sql.begin, TODO con sqlTx):
//       - Si el body trae vehicleId (el admin eligió placa en el calendario):
//         SELECT ... FOR UPDATE de ESA unidad y verifica el NOT EXISTS de
//         solape con el buffer a mano (misma query de pickFreeUnit pero con
//         v.id = ${vehicleId} fijo); si solapa → sentinel → 409
//         { error: 'unavailable' }.
//       - Si NO trae vehicleId: pickFreeUnit(sqlTx, modelSlug, start, end,
//         buffer) igual que el endpoint público.
//       - Total: computeQuote(...) salvo que venga totalCentsOverride → usa el
//         override y anexa en notes el calculado y el motivo (DECISIONES #3).
//       - Mismo INSERT 'confirmed' con código RPZ- (mismo generateBookingCode
//         y retry por 23505), mismo catch 23P01 → 409.
//       - 201 { booking } — SIN whatsappUrl: la captura manual no dispara
//         mensaje automático (el staff ya tiene al cliente enfrente o al
//         teléfono; si lo necesita, copia el resumen desde el detalle).
// 5. export function ALL(): 405 con header Allow: GET, POST.
//
// ----------------------------------------------------------------------------
// CONTRATO
// ----------------------------------------------------------------------------
// GET /api/admin/bookings?from=…&to=…&status=confirmed&kind=rental
//   → 200 { bookings: [...] } | 401
// POST kind='rental': { kind, modelSlug, vehicleId?, start, end, pickupZone,
//   extras, customer { name, email, phone, flightNumber? }, depositType,
//   totalCentsOverride?, notes? } → 201 { booking }
// POST kind='block': { kind, vehicleId, start, end, notes? } → 201 { booking }
// Errores: 400 validation · 401 unauthorized · 409 { error: 'unavailable' } · 405
//
// ----------------------------------------------------------------------------
// ERRORES COMUNES
// ----------------------------------------------------------------------------
// - Crear el block con status 'quoted' "porque no es renta": NO bloquea (el
//   WHERE de la constraint lo ignora) y el solape explotará después en la
//   renta que intente confirmarse sobre el taller.
// - Concatenar condiciones WHERE como strings → inyección SQL; usa fragments
//   sql`` de postgres.js.
// - Aceptar totalCentsOverride sin registrar el total calculado en notes: en 3
//   meses nadie sabrá por qué esa renta cobró menos.
// - Usar el sql global dentro del sql.begin (igual que en /api/bookings: todo
//   lo transaccional va con sqlTx).
// ============================================================================
