// ============================================================================
// LIB: pricing — motor de precios (la otra mitad del showcase, spec §9)
// ============================================================================
// Propósito: dado un modelo disponible, un rango [start, end), una zona y los
// extras elegidos, producir el desglose COMPLETO del precio (PriceBreakdown).
// Lo usan /api/quote (mostrar) y /api/bookings (recalcular como verdad dentro
// de la transacción — ARCHITECTURE §2.9: el servidor decide, nunca el cliente).
//
// ----------------------------------------------------------------------------
// DECISIONES
// ----------------------------------------------------------------------------
// * FUNCIÓN PURA respecto a la BD: computeQuote NO hace queries. Recibe
//   seasons, extrasCatalog y settings YA CARGADOS por el caller vía `ctx`.
//   Por qué: /api/quote cotiza TODOS los modelos a la vez; si cada llamada a
//   computeQuote consultara la BD serían N+1 queries, y el free tier cuenta
//   cada operación (spec §2). El endpoint carga las 3 tablas UNA vez y las
//   inyecta. Además, pura = testeable con `vitest` sin levantar Postgres.
// * Dinero en CENTAVOS enteros siempre (ARCHITECTURE §2.13): nada de floats
//   en el desglose. Los multiplicadores numeric de temporada se aplican y se
//   redondean POR DÍA con Math.round; el IVA y el depósito se calculan sobre
//   enteros y se redondean SOLO AL FINAL con Math.round. Redondear a la mitad
//   del cálculo acumula errores de centavos entre el preview y el total.
// * Precio POR DÍA con suma diaria, no multiplicador único para toda la
//   renta: una renta que cruza de temporada baja a alta debe pagar cada día
//   según la temporada que lo contiene. Es lo justo para el cliente y para
//   el negocio (spec §4 detalle de precios), y el desglose days[] lo hace
//   transparente en la UI ("este día cuesta más por temporada alta").
// * SNAPSHOT de extras: el desglose usa el nombre y precio del catálogo EN
//   ESTE MOMENTO, y eso es lo que se persiste en bookings.extras (jsonb).
//   Si mañana sube el precio de la silla de bebé, las reservaciones viejas
//   NO cambian de total (ver 001_init.sql paso 3).
//
// ----------------------------------------------------------------------------
// PASOS
// ----------------------------------------------------------------------------
// 1. Importar tipos: ModelAvailability desde './availability'; declara aquí
//    (o impórtalos de './validation' si ahí viven) los tipos de contexto:
//      interface Season { name: string; period: [string, string]; multiplier: number }
//      interface Extra { id: number; name: string; priceCents: number; per: 'day' | 'rental' }
//      interface Settings { ivaRate: number; deliveryZones: Array<{ zone: string; feeCents: number }>;
//                           longRentalDiscounts: Array<{ minDays: number; pct: number }> }
//    (El endpoint parsea los jsonb de settings a esta forma tipada ANTES de
//    llamar a computeQuote; este archivo no lee jsonb crudo.)
//
// 2. Declarar el tipo de salida y exportarlo:
//      interface PriceBreakdown {
//        days: Array<{ date: string; seasonName: string | null; multiplier: number; cents: number }>
//        daysCount: number
//        subtotalCents: number
//        discountPct: number
//        extrasCents: number
//        deliveryFeeCents: number
//        taxCents: number
//        totalCents: number
//        depositCents: number
//      }
//
// 3. Declarar la firma exacta de la función exportada:
//      export function computeQuote(
//        model: ModelAvailability,
//        start: Date,
//        end: Date,
//        pickupZone: string,
//        selectedExtras: Array<{ id: number; qty: number }>,
//        ctx: { seasons: Season[]; extrasCatalog: Extra[]; settings: Settings }
//      ): PriceBreakdown
//    Sin async: no toca BD ni red; pura y síncrona.
//
// 4. Días: (a) daysCount = Math.ceil((end.getTime() - start.getTime()) /
//    86_400_000) — bloques de 24 h con ceil (26 h = 2 días, estándar de
//    renta); (b) para i = 0..daysCount-1, dayDate = start + i*24h normalizado
//    a fecha calendario YYYY-MM-DD en America/Merida (Intl.DateTimeFormat
//    'en-CA' con timeZone: 'America/Merida' te da el formato ISO barato).
//
// 5. Precio por día: para cada día busca en ctx.seasons cuál contiene esa
//    fecha (en SQL sería `period @> fecha`; aquí, como los rangos ya vienen
//    cargados, compara strings YYYY-MM-DD contra [from, to) del daterange —
//    o haz la comparación con Date; elige y documenta). cents del día =
//    Math.round(model.dailyRateCents * multiplier), con multiplier = 1 si
//    ninguna temporada cubre ese día (seasonName = null). Acumula
//    subtotalCents = suma de los cents diarios.
//
// 6. Descuento por renta larga: recorre ctx.settings.longRentalDiscounts
//    (semilla: ≥7 días −10%, ≥30 −20%) y toma el de mayor minDays que cumpla
//    daysCount >= minDays. discountPct = ese pct; subtotalCents =
//    Math.round(subtotalCents * (1 - pct/100)). Se aplica SOLO al subtotal
//    de días, no a extras ni entrega (el descuento es por días de renta).
//
// 7. Extras: para cada {id, qty} de selectedExtras, busca el extra en
//    ctx.extrasCatalog (ignora ids que no existan o estén inactivos — el
//    endpoint valida antes, pero defensa en profundidad). Si per === 'day':
//    cents = priceCents * qty * daysCount; si per === 'rental': cents =
//    priceCents * qty. extrasCents = suma. Guarda también el arreglo de
//    snapshot [{name, priceCents, per, qty}] — /api/bookings lo persiste
//    en bookings.extras tal cual.
//
// 8. Entrega: deliveryFeeCents = feeCents de ctx.settings.deliveryZones cuyo
//    zone === pickupZone; 0 si la zona no existe (el airport es gratis en la
//    semilla). La validación de que la zona existe es de zod/endpoint.
//
// 9. IVA: taxCents = Math.round((subtotalCents + extrasCents +
//    deliveryFeeCents) * ctx.settings.ivaRate). IVA AL FINAL sobre la base
//    completa, no por componente (así cuadra con la facturación mexicana).
//
// 10. Totales: totalCents = subtotalCents + extrasCents + deliveryFeeCents +
//     taxCents. depositCents = Math.round(totalCents * 0.20) — anticipo del
//     20% cuando depositType = 'deposit' (spec §3.3). Devuelve el
//     PriceBreakdown completo.
//
// ----------------------------------------------------------------------------
// CONTRATO
// ----------------------------------------------------------------------------
// Expone: computeQuote(...) y los tipos PriceBreakdown, Season, Extra,
// Settings. Consume: tipos de availability.ts; NADA de db.ts (pura).
// Callers: /api/quote (por cada modelo disponible) y /api/bookings
// (recalculo autoritativo dentro de la transacción; lo que responde el
// cliente es este total, no el que mandó el wizard).
//
// ----------------------------------------------------------------------------
// ERRORES COMUNES
// ----------------------------------------------------------------------------
// - Hacer queries aquí "para simplificar el endpoint" → mata la pureza y
//   crea N+1; el caller carga ctx una sola vez.
// - Floats intermedios (0.16 * total sin redondear) → descuadres de centavos
//   entre cotización y cobro; Math.round en cada paso monetario, solo ahí.
// - Multiplicador único de temporada para toda la renta → cobras de más o de
//   menos en rentas que cruzan temporada; la suma diaria es la regla.
// - Comparar fechas con toISOString() (UTC) → un día a las 18:00 en Mérida
//   cae en otro día calendario; normaliza con timeZone 'America/Merida'.
// - Aplicar el descuento de renta larga sobre extras/entrega → la regla es
//   solo sobre el subtotal de días.
// ============================================================================
