// ============================================================================
// ISLA REACT: BookingFlow — el motor de reservación (spec §3.3, corazón del MVP)
// ============================================================================
// Propósito: wizard de 6 pasos montado en /reservar (y /en/book):
//   1. Fechas y zona de entrega   2. Auto disponible con precio TOTAL
//   3. Extras                     4. Datos del cliente (+ no. de vuelo)
//   5. Depósito o pago en mostrador  6. Confirmación con código + WhatsApp
//
// Se monta con `client:load` y lee los query params que QuoteWidget puso en la
// URL (?start=…&end=…&zone=…) para pre-llenar el paso 1.
//
// ----------------------------------------------------------------------------
// DECISIONES DE ESTADO (la parte que más importa justificar)
// ----------------------------------------------------------------------------
// * `useReducer` como máquina de estados, NO useState sueltos:
//   el funnel tiene transiciones válidas (no puedes ir a "extras" sin auto),
//   datos que dependen de pasos previos (el total depende de auto+extras) y
//   reintentos (un 409 te regresa al paso 2). Un reducer puro
//   `bookingReducer(state, action)` expresa eso como datos y es testeable sin
//   renderizar — junto con el motor de solapes SQL, es la pieza de portafolio
//   (spec §9). Con 6 useState sueltos terminarías con useEffect encadenados
//   para "recalcular totales": fuente clásica de renders de más y bugs de
//   estado inconsistente.
// * SIN store global (Zustand/Redux): el estado vive dentro de esta isla; la
//   fuente de verdad de precio/disponibilidad es el SERVIDOR (ARCHITECTURE
//   §2.9). Un store global solo duplicaría lo que la API ya sabe.
// * `useContext` + `BookingDispatchContext` para pasar el dispatch a los
//   sub-pasos: evita prop-drilling de 5 niveles sin librerías extra. Context
//   aquí es seguro porque el árbol es pequeño y los pasos no re-renderizan
//   hermanos (cada paso es pantalla completa).
// * react-hook-form SOLO en el paso 4 (datos del cliente): ahí sí hay 5+
//   campos con validación zod; los pasos 1-3 son selects/botones que el
//   reducer valida por construcción. No uses RHF para todo: un date-range no
//   es un input de texto.
//
// ----------------------------------------------------------------------------
// PASOS DE IMPLEMENTACIÓN
// ----------------------------------------------------------------------------
// 1. Imports de React: `useReducer`, `useContext`, `createContext`,
//    `useEffect` (solo 2: leer query params al montar y llamar /api/quote
//    cuando cambia el rango), `useMemo` para derivados. De shadcn/ui:
//    Button, Calendar, Popover, Select, Input, Label, Card, Badge, sonner
//    (toasts de error). De 'react-hook-form' + '@hookform/resolvers/zod'
//    solo en el componente del paso 4.
//
// 2. Declarar los tipos (compártelos con la API en src/lib/validation.ts —
//    ahí están los esquemas zod; aquí importas los tipos inferidos):
//      type Step = 'range' | 'car' | 'extras' | 'customer' | 'payment' | 'done'
//      interface BookingState {
//        step: Step
//        range: { start: Date; end: Date } | null
//        pickupZone: string
//        quote: QuoteResult[] | null        // respuesta cruda de /api/quote
//        selectedModel: QuoteResult | null
//        selectedExtras: Extra[]
//        customer: CustomerInput | null
//        depositType: 'deposit' | 'on_pickup' | null
//        confirmation: { code: string; whatsappUrl: string } | null
//        status: 'idle' | 'quoting' | 'submitting' | 'error'
//        error: string | null
//      }
//
// 3. Declarar las acciones como union discriminada (el "menú" de todo lo que
//    puede pasar — si una transición no está aquí, no existe):
//      type Action =
//        | { type: 'SET_RANGE'; start: Date; end: Date; zone: string }
//        | { type: 'QUOTE_LOADED'; quote: QuoteResult[] }
//        | { type: 'QUOTE_FAILED'; message: string }
//        | { type: 'SELECT_MODEL'; model: QuoteResult }
//        | { type: 'TOGGLE_EXTRA'; extra: Extra }
//        | { type: 'SET_CUSTOMER'; customer: CustomerInput }
//        | { type: 'SET_DEPOSIT'; depositType: 'deposit' | 'on_pickup' }
//        | { type: 'SUBMITTED'; code: string; whatsappUrl: string }
//        | { type: 'CONFLICT' }              // 409: alguien ganó la unidad
//        | { type: 'BACK' }
//    Por qué union discriminada y no strings sueltos: el switch del reducer
//    queda exhaustivo y TS te obliga a manejar cada caso.
//
// 4. Escribir `bookingReducer(state, action): BookingState` como función
//    PURA (sin fetch, sin Date.now() — esos van en los handlers). Reglas:
//      - SET_RANGE → step 'range', quote=null (rango nuevo = cotización
//        vieja inválida), status 'quoting'. El useEffect reacciona.
//      - QUOTE_LOADED con ≥1 modelo → step 'car'; con 0 → quedarse en
//        'range' con error "sin disponibilidad".
//      - CONFLICT → step 'car', selectedModel=null, status 'quoting'
//        (fuerza re-cotización: la unidad ya no está).
//      - BACK → retrocede un paso sin borrar datos (UX: nunca castigar).
//    Por qué pura: puedes probar cada transición con un test unitario sin
//    montar nada. La impureza vive en los componentes, no aquí.
//
// 5. Efecto de cotización: `useEffect` que observa [state.range,
//    state.pickupZone] y, si hay rango válido, hace POST /api/quote y
//    despacha QUOTE_LOADED/QUOTE_FAILED. Incluye AbortController en el
//    cleanup — el usuario puede cambiar fechas rápido y la respuesta vieja
//    NO debe pisar la nueva (carrera clásica de useEffect+fetch).
//
// 6. Sub-componentes por paso (pueden vivir en este archivo o en
//    ./steps/*.tsx cuando crezcan — empieza aquí, separa al pasar de ~300
//    líneas por componente):
//      <RangeStep>   — Calendar de shadcn en modo rango (react-day-picker
//                      debajo) + Select de zona. Reglas: end > start, start
//                      ≥ ahora + 3 h (lead time del negocio), rango ≤ 60
//                      días. Valida ANTES de despachar SET_RANGE.
//      <CarStep>     — lista de QuoteResult con Card por modelo: foto,
//                      specs (asientos/maleta/transmisión), desglose de
//                      precio y TOTAL grande. Botón selecciona →
//                      SELECT_MODEL. Skeleton mientras status==='quoting'.
//      <ExtrasStep>  — checkbox por extra activo; muestra precio
//                      por-día o por-renta según `per`. Total estimado en
//                      vivo (useMemo que suma, NO estado nuevo).
//      <CustomerStep>— ÚNICO paso con react-hook-form + zodResolver usando
//                      el schema `customerSchema` de validation.ts. Campos:
//                      nombre, email, teléfono, no. de vuelo (opcional).
//      <PaymentStep> — radio: 'deposit' (explica monto) vs 'on_pickup'.
//                      MVP sin cobro real: solo registra la elección (spec
//                      §8: pagos son fase 2).
//      <DoneStep>    — código RPZ-XXXXXX grande, botón "Confirmar por
//                      WhatsApp" (anchor a confirmation.whatsappUrl,
//                      target _blank) e instrucciones. Este deep link ES la
//                      notificación del MVP (spec §5).
//
// 7. Envío: al confirmar el paso 5, handler `submitBooking()` (en este
//    componente, NO en el reducer) hace POST /api/bookings con el estado
//    completo. Maneja tres salidas: 201 → SUBMITTED; 409 → CONFLICT + toast
//    "ese auto acaba de reservarse, te mostramos opciones"; 400 → error de
//    validación, toast con el primer mensaje zod.
//    Por qué re-enviar todo y no un "quoteId": sin pagos no hay nada que
//    amarrar una cotización; el servidor recalcula y decide (§2.9). Simple
//    y sin estado extra en BD.
//
// 8. Barra de progreso: componente pequeño que mapea Step → 1..6 con
//    Badge de shadcn. Puramente derivado del estado (no lo metas al
//    reducer).
//
// ----------------------------------------------------------------------------
// CONTRATO
// ----------------------------------------------------------------------------
// Props: { lang: 'es' | 'en' } — los textos vienen de useTranslations(lang);
// la página /reservar le pasa 'es', /en/book le pasa 'en'.
// Consume: POST /api/quote, POST /api/bookings (contratos en esos archivos y
// en ARCHITECTURE §4), schemas de src/lib/validation.ts, buildWhatsAppUrl de
// src/lib/whatsapp.ts (la URL de confirmación ya viene armada del servidor).
//
// ----------------------------------------------------------------------------
// ERRORES COMUNES
// ----------------------------------------------------------------------------
// - Calcular totales en el cliente y mandarlos como verdad → el servidor
//   recalcula SIEMPRE; el cliente solo muestra estimaciones.
// - Guardar la cotización en localStorage "por si acaso" → datos obsoletos;
//   el query param en la URL es el estado compartible (puedes mandar el link
//   por WhatsApp y abre pre-llenado: feature gratis).
// - Un useEffect por cada derivado → usa useMemo o el reducer; efectos solo
//   para sincronizar con el exterior (fetch, URL).
// - date-fns/moment para los rangos: usa Date nativo + Intl.DateTimeFormat
//   con timeZone 'America/Merida' para mostrar; cero dependencias de fecha
//   (las sumas de días del precio las hace el servidor con SQL).
// ============================================================================
