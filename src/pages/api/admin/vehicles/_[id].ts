// ============================================================================
// API: /api/admin/vehicles/[id] — PATCH edición · DELETE borrado LÓGICO
// ============================================================================
// NOTA DE SCAFFOLDING: el archivo se llama `_[id].ts` (guion bajo) para que
// el router de Astro lo ignore mientras es guía — sin exports, Astro exigiría
// getStaticPaths y el build fallaría. Al implementarlo, renómbralo a
// `[id].ts` (y descomenta el `prerender = false` del paso 1).
// ============================================================================
// PROPÓSITO
// Editar un modelo (incluidas altas y cambios de estado de sus unidades) y
// "borrar" sin romper el historial de reservaciones.
//
// ----------------------------------------------------------------------------
// DECISIONES
// ----------------------------------------------------------------------------
// * BORRADO FÍSICO PROHIBIDO: bookings.vehicle_id es FK y las rentas históricas
//   referencian la unidad (001_init.sql paso 4). Borrar modelo o unidad rompe
//   historial, reportes y la trazabilidad de cobros. DELETE aquí significa
//   UPDATE vehicle_models SET active=false y, si se pide, UPDATE vehicles SET
//   status='retired' para sus unidades. Si la BD te rechaza un DELETE físico
//   por violación de FK, es la BD salvándote: escúchala.
// * Antes de desactivar, verificar que NO haya bookings FUTUROS confirmados de
//   unidades del modelo → si los hay, 409 con la lista: primero se reasignan a
//   otro modelo o se cancelan. Caso real de negocio: "doy de baja el Versa en
//   diciembre pero tengo 3 rentas de enero" — mejor un 409 explícito que
//   clientes con reservación y sin auto.
// * Operaciones de unidad DENTRO del PATCH ({ addUnits, setUnitStatus }) en vez
//   de un /api/admin/units separado: en el MVP el gestor es una sola pantalla y
//   las operaciones son triviales; si la flota crece o aparecen flujos de
//   taller complejos, se extrae a su propio endpoint (anótalo aquí si pasa).
// * vehicleUpsertSchema.partial(): PATCH semántico — solo los campos PRESENTES
//   se actualizan; ausente ≠ null (un campo ausente no debe pisar la columna).
//
// ----------------------------------------------------------------------------
// PASOS
// ----------------------------------------------------------------------------
// 0. PASO 0 de todo /api/admin/* (§2.3): requireAdminApi(context.cookies) →
//    401 { error: 'unauthorized' } si null.
// 1. export const prerender = false (COMENTADO hasta instalar el adapter, §6).
// 2. Imports (comentados): type APIContext de 'astro'; sql desde
//    '../../../../lib/db'; vehicleUpsertSchema desde '../../../../lib/validation'.
// 3. export async function PATCH(context: APIContext):
//    a. const id = parseInt(context.params.id ?? '', 10) → 400
//       { error: 'invalid_id' } si Number.isNaN(id).
//    b. request.json() en try/catch → 400; vehicleUpsertSchema.partial()
//       .safeParse(body) → 400 { error: 'validation', issues }. Shape: campos
//       del modelo opcionales + addUnits?: [{ plate }] + setUnitStatus?:
//       { unitId, status: 'active'|'maintenance'|'retired' }.
//    c. UPDATE solo de campos presentes: sql`UPDATE vehicle_models SET
//       ${ sql(camposPresentes) } WHERE id = ${id} RETURNING *` — el helper
//       sql(objeto) de postgres.js genera "col = val" solo con las llaves del
//       objeto; constrúyelo copiando del body validado ÚNICAMENTE los campos
//       definidos. Esto cubre también el toggle de active: es un campo más.
//       404 { error: 'not_found' } si RETURNING viene vacío.
//    d. Si body.addUnits: INSERT cada placa como en POST de vehicles.ts (loop
//       secuencial); catch 23505 → 409 { error: 'duplicate_plate', plate }.
//    e. Si body.setUnitStatus: UPDATE vehicles SET status = ${status} WHERE id
//       = ${unitId} AND model_id = ${id} — el AND es guardia: evita que un id
//       adivinado cambie unidades de OTRO modelo; 404 si no afectó filas.
//    f. 200 { model } con el modelo re-leído y sus unidades (mismo merge de
//       dos queries que el GET de vehicles.ts).
// 4. export async function DELETE(context: APIContext):
//    a. id parseado → 400 invalid_id si NaN.
//    b. Verificación previa (la de DECISIONES #2, ANTES de tocar nada):
//       SELECT b.id, b.code, b.period, v.plate FROM bookings b
//       JOIN vehicles v ON v.id = b.vehicle_id
//       WHERE v.model_id = ${id} AND b.status IN ('confirmed','active')
//         AND upper(b.period) > now()
//       → si hay filas, 409 { error: 'has_future_bookings', bookings: rows }.
//    c. UPDATE vehicle_models SET active = false WHERE id = ${id} RETURNING *
//       → 404 si no existe.
//    d. Si el body trae { retireUnits: true }: UPDATE vehicles SET status =
//       'retired' WHERE model_id = ${id} AND status = 'active'. (Las unidades
//       en 'maintenance' se quedan como están: su estado ya dice la verdad.)
//    e. 200 { ok: true, model }.
// 5. export function ALL(): 405 con header Allow: PATCH, DELETE.
//
// ----------------------------------------------------------------------------
// CONTRATO
// ----------------------------------------------------------------------------
// PATCH /api/admin/vehicles/3
//   { name?, dailyRateCents?, active?, photos?, ...,
//     addUnits?: [{ plate }], setUnitStatus?: { unitId, status } }
//   → 200 { model } | 400 · 401 · 404 · 409 { error: 'duplicate_plate', plate }
// DELETE /api/admin/vehicles/3   { retireUnits?: boolean }
//   → 200 { ok: true, model } | 400 · 401 · 404 ·
//     409 { error: 'has_future_bookings', bookings: [{ id, code, period, plate }] }
//
// ----------------------------------------------------------------------------
// ERRORES COMUNES
// ----------------------------------------------------------------------------
// - DELETE físico "para limpiar el catálogo": rompe la FK de bookings
//   históricos (DECISIONES #1). Borrado lógico, siempre.
// - UPDATE pasando el objeto completo del body sin filtrar: los undefined pisan
//   columnas (o rompen NOT NULL); pasa a sql(objeto) solo lo presente.
// - Desactivar sin verificar rentas futuras: clientes con reservación y sin
//   auto — el peor bug de negocio posible (DECISIONES #2).
// - Confundir active=false (modelo, sale del catálogo público) con
//   status='retired' (unidad física, sale del inventario): son niveles
//   distintos del modelo de datos (ARCHITECTURE §3).
// ============================================================================
