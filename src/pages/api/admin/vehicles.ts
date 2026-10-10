// ============================================================================
// API: /api/admin/vehicles — GET catálogo completo · POST alta de modelo
// ============================================================================
// PROPÓSITO
// Alimentar el FleetManager: lista de modelos CON sus unidades anidadas
// (incluidos inactivos — el admin necesita ver lo que el público no) y alta de
// modelos nuevos con sus placas iniciales.
//
// ----------------------------------------------------------------------------
// DECISIONES
// ----------------------------------------------------------------------------
// * Unidades anidadas vía DOS queries simples + merge en JS por model_id, NO
//   json_agg anidado: con ~20 unidades el volumen es ínfimo y "SELECT * FROM
//   vehicles" + un groupBy en JS se lee de un vistazo; el SQL anidado ahorra
//   un roundtrip que aquí no importa y cuesta legibilidad (§2.4: la lógica
//   estrella es SQL; el plumbing, en JS legible).
// * GET incluye active=false: es la vista del GESTOR, no el catálogo público
//   (el público filtra active=true en availability.ts; aquí deliberadamente no).
// * UNIQUE violations traducidas a 409 amables: slug duplicado y placa
//   duplicada son errores de captura comunes; responder con el valor que chocó
//   ahorra al admin un viaje a los logs y al cliente un 500 ilegible.
//
// ----------------------------------------------------------------------------
// PASOS
// ----------------------------------------------------------------------------
// 0. PASO 0 de todo /api/admin/* (§2.3): const admin = await
//    requireAdminApi(context.cookies); if (!admin) → 401
//    { error: 'unauthorized' }.
// 1. export const prerender = false (COMENTADO hasta instalar el adapter, §6).
// 2. Imports (comentados): type APIContext de 'astro'; sql desde
//    '../../../lib/db'; vehicleUpsertSchema desde '../../../lib/validation'.
//    Helper json(data, status) como en quote.ts.
// 3. export async function GET(context: APIContext):
//    a. models = SELECT * FROM vehicle_models ORDER BY daily_rate_cents ASC.
//    b. units  = SELECT * FROM vehicles ORDER BY plate ASC.
//    c. Merge: construye un Map<model_id, units[]> recorriendo units una vez y
//       responde models.map(m => ({ ...m, units: byModel.get(m.id) ?? [] })).
//    d. 200 { models }.
// 4. export async function POST(context: APIContext):
//    a. request.json() en try/catch → 400 invalid_json;
//       vehicleUpsertSchema.safeParse(body) → 400 { error: 'validation',
//       issues } (§2.12). Shape: { slug, name, category, transmission, seats,
//       luggage, dailyRateCents, photos: string[], active?, units?: [{ plate }] }.
//    b. INSERT INTO vehicle_models (slug, name, category, transmission, seats,
//       luggage, daily_rate_cents, photos, active) VALUES (...) RETURNING *.
//       catch 23505 sobre slug → 409 { error: 'duplicate_slug', slug } —
//       mensaje amable: "ese slug ya existe; cámbialo o edita el modelo".
//    c. Si vienen units[]: INSERT cada placa con model_id del RETURNING. Un
//       loop secuencial con await está bien (son 1-5 placas, no 10 000).
//       catch 23505 sobre plate → 409 { error: 'duplicate_plate', plate }.
//       OJO: si falla la 3ª placa, el modelo y las 2 primeras YA quedaron —
//       aceptable en MVP (el PATCH de [id].ts permite agregar las faltantes);
//       si quieres todo-o-nada, envuelve b+c en sql.begin y documenta por qué.
//    d. 201 { model: { ...created, units: insertedUnits } }.
// 5. export function ALL(): 405 con header Allow: GET, POST.
//
// ----------------------------------------------------------------------------
// CONTRATO
// ----------------------------------------------------------------------------
// GET /api/admin/vehicles
//   → 200 { models: (VehicleModel & { units: Vehicle[] })[] } | 401
// POST /api/admin/vehicles
//   { slug, name, category, transmission, seats, luggage, dailyRateCents,
//     photos: string[], active?, units?: [{ plate }] }
//   → 201 { model } | 400 validation · 401 ·
//     409 { error: 'duplicate_slug', slug } | { error: 'duplicate_plate', plate }
//
// ----------------------------------------------------------------------------
// ERRORES COMUNES
// ----------------------------------------------------------------------------
// - Filtrar active=true en el GET del gestor: el admin no vería los modelos
//   desactivados y parecería que el borrado lógico borró de verdad.
// - Usar json_agg "por eficiencia": optimización prematura (DECISIONES #1); dos
//   queries + merge se leen mejor y el volumen no justifica más.
// - Devolver el 23505 crudo al cliente: expone detalle del esquema y no dice
//   nada útil; traduce a 409 con el valor que chocó.
// - Insertar placas con Promise.all: el orden de errores se vuelve caótico y
//   el 409 ya no sabría decir qué placa falló; loop secuencial.
// ============================================================================
