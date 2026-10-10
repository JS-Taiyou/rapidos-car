// ============================================================================
// API: POST /api/quote — cotización pública de disponibilidad + precio
// ============================================================================
// PROPÓSITO
// Dado un rango de fechas y una zona de entrega, devolver qué MODELOS tienen
// unidades libres y cuánto costaría cada uno (ARCHITECTURE §4). Es la primera
// llamada del QuoteWidget y del paso de autos del BookingFlow.
//
// ----------------------------------------------------------------------------
// DECISIONES
// ----------------------------------------------------------------------------
// * Es endpoint de CONSULTA: no aparta nada. Entre "parece libre" y "está
//   apartado" hay una carrera que solo se resuelve en /api/bookings con la
//   transacción y la constraint no_overlap (ARCHITECTURE §2.9). No intentes
//   "reservar por un rato" aquí.
// * Las 3 queries de contexto de precios (seasons, extras, settings) van en UN
//   Promise.all: son independientes entre sí. Cada query cuenta en el free
//   tier de la BD, pero la latencia también cuenta — 3 en paralelo tardan lo
//   que la más lenta, no la suma de las tres.
// * computeQuote es PURO (no toca la BD): recibe el ctx ya cargado. Si pricing
//   hiciera queries por modelo caerías en N+1 (un roundtrip por Versa, por
//   Kicks...) — la misma trampa que availability.ts evita con una sola query.
// * Sin caché HTTP (ni Cache-Control): cada request trae fechas distintas y
//   cachear sería overhead puro. El free tier de la BD agradece que esta sea
//   la ÚNICA consulta "de exploración" del sitio; el resto es mucho más barato.
//
// ----------------------------------------------------------------------------
// PASOS
// ----------------------------------------------------------------------------
// 1. Primera línea (COMENTADA hasta instalar el adapter — ARCHITECTURE §6: sin
//    adapter el build falla; en astro dev las rutas SSR funcionan sin él):
//      export const prerender = false
//
// 2. Imports (comentados): type APIContext de 'astro'; sql desde '../../lib/db';
//    findAvailableModels desde '../../lib/availability'; computeQuote y el tipo
//    PriceBreakdown desde '../../lib/pricing'; quoteSchema desde
//    '../../lib/validation'.
//
// 3. Helper local json(data, status): devuelve new Response(JSON.stringify(data),
//    { status, headers: { 'Content-Type': 'application/json' } }). TODAS las
//    respuestas llevan status explícito; nunca el 200 implícito.
//
// 4. export async function POST({ request }: APIContext):
//    a. const body = await request.json() dentro de try/catch → si no es JSON
//       válido, 400 { error: 'invalid_json' }.
//    b. const parsed = quoteSchema.safeParse(body) → si !parsed.success, 400
//       { error: 'validation', issues: parsed.error.issues }. Zod SIEMPRE antes
//       de tocar la BD (ARCHITECTURE §2.12). Shape: { start, end, pickupZone,
//       extras? } — extras es opcional por si el wizard permite preseleccionar;
//       si no viene, computeQuote recibe [].
//    c. Convierte start/end a Date nativos (nunca compares strings, ver
//       availability.ts — ERRORES COMUNES).
//    d. const [seasons, extrasCatalog, settingsRows] = await Promise.all([
//         sql`SELECT id, name, period, multiplier FROM seasons
//             WHERE period && daterange(${start}::date, ${end}::date, '[]')`,
//         sql`SELECT id, name, price_cents, per FROM extras WHERE active = true`,
//         sql`SELECT key, value FROM settings`,
//       ])
//       Convierte settingsRows a un objeto { [key]: value } en JS (son ~5
//       renglones; objeto plano es más cómodo que buscar por key cada vez).
//    e. const models = await findAvailableModels(startDate, endDate).
//    f. const results = models
//         .filter(m => m.unitsAvailable > 0)
//         .map(m => ({ slug: m.slug, name: m.name, category: m.category,
//           transmission: m.transmission, seats: m.seats, luggage: m.luggage,
//           dailyRateCents: m.dailyRateCents, photos: m.photos,
//           unitsAvailable: m.unitsAvailable,
//           price: computeQuote(m, startDate, endDate, pickupZone,
//             parsed.data.extras ?? [], { seasons, extrasCatalog, settings }) }))
//       — sin await dentro del map: computeQuote no toca la BD (DECISIONES #3).
//    g. Ordena results por price.totalCents ascendente y responde 200
//       { results } con json(). Orden explícito aunque findAvailableModels ya
//       ordene por tarifa: el total incluye extras y entrega y puede reordenar.
//
// 5. export function ALL(): devuelve 405 con header Allow: POST. Astro enruta
//    por nombre de función exportada; sin ALL, un GET caería en 404 genérico y
//    el cliente no sabría que el endpoint existe pero con otro método.
//
// ----------------------------------------------------------------------------
// CONTRATO
// ----------------------------------------------------------------------------
// Request:  POST /api/quote  (Content-Type: application/json)
//   { "start": "2026-03-10T12:00:00-06:00", "end": "2026-03-14T12:00:00-06:00",
//     "pickupZone": "airport", "extras": ["silla-bebe"] }
// Response 200: { "results": QuoteResult[] } ordenado por price.totalCents ASC,
//   donde QuoteResult = { slug, name, category, transmission, seats, luggage,
//   dailyRateCents, photos, unitsAvailable, price: PriceBreakdown } y
//   PriceBreakdown = { days[], subtotal, extras, deliveryFee, taxes,
//   totalCents } (nombres exactos de ARCHITECTURE §4).
// Errores: 400 invalid_json / validation · 405 método no soportado.
//
// ----------------------------------------------------------------------------
// ERRORES COMUNES
// ----------------------------------------------------------------------------
// - await de una query DENTRO del map por modelo → N+1; el ctx se carga una vez.
// - Confundir cotización con apartado: la unidad se amarra en /api/bookings.
// - Responder sin Content-Type application/json (fetch().json() falla).
// - Cachear la respuesta: fechas siempre distintas = caché inútil y precios
//   potencialmente viejos.
// ============================================================================
