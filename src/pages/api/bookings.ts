// ============================================================================
// API: POST /api/bookings — crea reservación (EL endpoint crítico del MVP)
// ============================================================================
// PROPÓSITO
// Convertir una cotización en reservación real: amarrar UNA unidad física
// dentro de una transacción, recalcular el precio en servidor e insertar el
// booking. Si hay carrera o manipulación, la BD decide (ARCHITECTURE §2.9,
// spec §2).
//
// ----------------------------------------------------------------------------
// DECISIONES
// ----------------------------------------------------------------------------
// * NUNCA confiar en totales del cliente: cualquiera puede editar el JSON en
//   devtools. El servidor recalcula con computeQuote y los mismos inputs; el
//   total que traiga el body se ignora por completo (ARCHITECTURE §2.9).
// * Dos líneas de defensa, una sola respuesta al cliente: pickFreeUnit con
//   FOR UPDATE es OPTIMISTA (serializa la carrera por placa); la constraint
//   no_overlap es la ÚLTIMA línea — si aun así hay solape, Postgres lanza
//   SQLSTATE 23P01 y lo traducimos al mismo 409 (001_init.sql paso 4).
// * El código RPZ-XXXXXX se genera con crypto.getRandomValues sobre un
//   alfabeto sin ambiguos (sin 0/O/1/I/L): se dicta por teléfono. Chocar con
//   UNIQUE es casi imposible (32^6 ≈ 10^9 combinaciones) pero el retry
//   documenta el patrón "generar → insertar → reintentar si 23505".
// * extras se guardan como SNAPSHOT jsonb (name + price_cents + per del
//   catálogo EN ESTE MOMENTO): el catálogo puede cambiar mañana; la reserva
//   de hoy no (001_init.sql paso 3).
//
// ----------------------------------------------------------------------------
// PASOS
// ----------------------------------------------------------------------------
// 1. export const prerender = false (COMENTADO hasta instalar el adapter —
//    ARCHITECTURE §6).
// 2. Imports (comentados): type APIContext de 'astro'; sql de '../../lib/db';
//    pickFreeUnit de '../../lib/availability'; computeQuote de
//    '../../lib/pricing'; bookingInputSchema de '../../lib/validation';
//    buildWhatsAppUrl y bookingConfirmationMessage de '../../lib/whatsapp'.
//    Mismo helper json(data, status) que en quote.ts.
// 3. export async function POST(context: APIContext):
//    a. request.json() en try/catch → 400 { error: 'invalid_json' }.
//    b. bookingInputSchema.safeParse(body) → 400 { error: 'validation',
//       issues } si falla (§2.12). Extrae: modelSlug, start, end, pickupZone,
//       extras, customer { name, email, phone, flightNumber? }, depositType,
//       lang? ('es' default).
//    c. Carga el ctx de precios EXACTAMENTE como /api/quote (Promise.all de
//       seasons activas, extras activos, settings→objeto). Duplicar 10 líneas
//       aquí es preferible a acoplar los endpoints; si crece, extrae
//       loadPricingContext(sql) a pricing.ts. ANTES de la transacción valida
//       que cada extra pedido exista y esté activo en el catálogo → 400
//       { error: 'unknown_extra' } si no.
//    d. const buffer = Number(settings.turnaround_buffer_minutes).
//    e. TRANSACCIÓN: const result = await sql.begin(async sqlTx => { ... }).
//       Regla de oro de postgres.js: COMMIT de lo que devuelves, ROLLBACK de
//       lo que lanzas. Dentro (TODO con sqlTx, JAMÁS con el sql global):
//       1. unitId = await pickFreeUnit(sqlTx, modelSlug, start, end, buffer).
//          Si es null: return { unavailable: true } — sentinel, no excepción:
//          como aún no escribiste nada, el COMMIT vacío equivale al rollback
//          y evitas usar excepciones como flujo de control.
//       2. quote = computeQuote(model, start, end, pickupZone, extras, ctx) —
//          recalculado en servidor (DECISIONES #1). Es puro: no cuenta contra
//          la BD ni alarga la transacción con roundtrips.
//       3. code = generateBookingCode(): 'RPZ-' + 6 chars del alfabeto
//          'ABCDEFGHJKMNPQRSTUVWXYZ23456789' con crypto.getRandomValues
//          (Web Crypto: corre igual en Node 22 y Deno, §2.11 mismo criterio).
//       4. INSERT INTO bookings (code, kind, vehicle_id, customer_name,
//          customer_email, customer_phone, flight_number, period, pickup_zone,
//          extras, total_cents, deposit_type, status) VALUES (${code},
//          'rental', ${unitId}, ..., tstzrange(${start}, ${end}, '[)'),
//          ${JSON.stringify(snapshotExtras)}, ${quote.totalCents},
//          ${depositType}, 'confirmed') RETURNING id, code, period, total_cents
//          — snapshotExtras: [{ name, price_cents, per, qty }] copiados del
//          extrasCatalog del paso c, NO del body.
//       5. Si el INSERT lanza 23505 por code duplicado: regenera y reintenta
//          (loop de máx 3 — probabilidad ~0; lo importante es el patrón).
//       6. return { booking: row, quote }.
//    f. Fuera: if (result.unavailable) → 409 { error: 'unavailable' } (el
//       wizard recarga el paso de autos, ARCHITECTURE §4).
//    g. catch (err): if (err.code === '23P01') → el MISMO 409
//       { error: 'unavailable' } — la constraint es quien decide en la carrera
//       final (spec §2). Otro error: console.error(err) con el body sanitizado
//       y 500 { error: 'internal' }; nunca err.message crudo al cliente.
//    h. Éxito: message = bookingConfirmationMessage(result.booking, lang);
//       whatsappUrl = buildWhatsAppUrl(settings.whatsapp_staff_number, message);
//       201 { booking: { id, code, period, totalCents, depositCents },
//       whatsappUrl } — depositCents: el anticipo según depositType y las
//       reglas de settings (0 si es 'on_pickup'); ver pricing.ts.
//    i. TODO (fase 1, spec §5): alerta a staff — deep link wa.me hacia
//       settings.whatsapp_staff_number incluido en el email transaccional al
//       cliente; el envío por WhatsApp Business API es fase 2.
//
// ----------------------------------------------------------------------------
// CONTRATO
// ----------------------------------------------------------------------------
// POST /api/bookings
//   { modelSlug, start, end, pickupZone, extras: [{ id, qty }],
//     customer: { name, email, phone, flightNumber? },
//     depositType: 'deposit'|'on_pickup', lang?: 'es'|'en' }
// 201 { booking: { id, code, period, totalCents, depositCents }, whatsappUrl }
// Errores: 400 invalid_json / validation / unknown_extra ·
//          409 { error: 'unavailable' } · 405 · 500 { error: 'internal' }
//
// ----------------------------------------------------------------------------
// ERRORES COMUNES
// ----------------------------------------------------------------------------
// - Hacer queries con el sql global DENTRO de sql.begin: quedan FUERA de la
//   transacción (sin FOR UPDATE ni atomicidad). Todo lo de adentro va con sqlTx.
// - No expandir el buffer igual que availability.ts (mismo bufferMinutes, misma
//   expansión en ambos extremos): si difieren, /api/quote muestra libre lo que
//   /api/bookings rechaza.
// - Devolver 500 genérico sin console.error: en serverless no hay disco; el log
//   es tu única evidencia.
// - Confiar el total del body (DECISIONES #1).
// - Insertar con status 'quoted' pensando "confirmar después": los quoted NO
//   bloquean (WHERE parcial de la constraint); la renta web nace 'confirmed'.
// ============================================================================
