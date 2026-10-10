// ============================================================================
// ISLA REACT: QuoteWidget — cotizador del hero (spec §3.1)
// ============================================================================
// Propósito: el formulario de 3 campos que abre el funnel desde la home:
// zona de entrega + fecha/hora de salida + fecha/hora de regreso. NO cotiza
// nada: valida lo mínimo y navega a /reservar (o /en/book) con los valores
// en query params, donde BookingFlow hace el trabajo real.
//
// ----------------------------------------------------------------------------
// DECISIONES
// ----------------------------------------------------------------------------
// * `useState` por campo (pickupZone, start, end) + un estado de error — NO
//   useReducer: son 3 campos independientes, sin transiciones válidas ni
//   datos que dependan unos de otros. Contrasta con BookingFlow, donde el
//   funnel sí es máquina de estados (ARCHITECTURE §2.8): aquí un reducer de
//   tres acciones SET_* que solo copian valores sería ceremonia sin nada
//   testeable. El error se fija al validar en el submit; no hay derivados
//   que recalcular, así que tampoco hace falta useMemo fuera del `min`.
// * Las zonas llegan por PROP `zones` (la página las lee de settings en el
//   servidor), no se fetchean desde la isla: la home es estática/SSR y las
//   zonas no cambian por interacción del usuario — un fetch aquí sería un
//   round-trip y un estado de carga para datos que ya estaban en el HTML.
// * `<Input type="datetime-local">` NATIVO y no el Calendar/Popover de
//   shadcn: el picker bonito vive en BookingFlow; este widget es lo primero
//   que se pinta (hero) y el presupuesto es LCP < 2 s en 4G (spec §6). El
//   input nativo cuesta 0 bytes de JS extra y en móvil abre el picker del
//   sistema operativo.
// * Validación SOLO al submit (end > start, start ≥ ahora + 3 h de lead
//   time): error inline traducido bajo el formulario, NUNCA toast — el
//   formulario está a la vista; un toast de sonner sería redundante.
// * Navegar a la página dedicada en vez de montar el wizard inline en el
//   hero: BookingFlow es pesado (Calendar, pasos, fetch de quote) para la
//   primera pantalla. Además la URL con params (?start=…&end=…&zone=…) es
//   compartible: el cliente la manda por WhatsApp y abre pre-llenada —
//   feature gratis (misma razón que en BookingFlow).
//
// ----------------------------------------------------------------------------
// PASOS
// ----------------------------------------------------------------------------
// 1. Imports de React: `useState`, `useMemo`. De shadcn/ui: Button, Input,
//    Label, Select (Trigger/Content/Item/Value). Textos vía
//    useTranslations(lang) de src/i18n/utils.ts: `const t = useTranslations(lang)`.
//
// 2. Props: `{ lang: 'es' | 'en'; zones: Array<{ zone: string; feeCents:
//    number }> }`. Las claves de zona ('mid', 'centro', 'norte'…) se muestran
//    traducidas desde el diccionario (t(`zones.${z.zone}`)), nunca texto
//    hardcodeado; junto al nombre muestra el cargo "+$X MXN" (transparencia
//    antes que sorpresa en el total).
//
// 3. Estado:
//      const [pickupZone, setPickupZone] = useState('')
//      const [start, setStart] = useState('')
//      const [end, setEnd] = useState('')
//      const [error, setError] = useState<string | null>(null)
//    Los valores son STRINGS tal como los da datetime-local
//    ('YYYY-MM-DDTHH:mm'); no conviertas a Date hasta validar.
//
// 4. `minDateTime` con useMemo: new Date() + 3 h, formateado a
//    'YYYY-MM-DDTHH:mm' con padStart en cada componente (datetime-local
//    exige ese formato exacto; toISOString() NO sirve porque devuelve UTC).
//    Se asigna al atributo `min` de ambos inputs para que el navegador
//    bloquee fechas pasadas antes de cualquier JS.
//
// 5. Handler `handleSubmit(e)`: preventDefault y validaciones en orden:
//      a. los 3 campos llenos (el botón ya está disabled, pero revalida);
//      b. end > start (comparar los strings funciona: son lexicográficamente
//         ordenables al tener ancho fijo);
//      c. start ≥ minDateTime.
//    Si falla: setError con la CLAVE de traducción ('quote.error.endBeforeStart',
//    'quote.error.tooSoon') y return. Si pasa: setError(null) y navegar.
//
// 6. Navegación: construir URLSearchParams con { start, end, zone } y
//      window.location.href = `${lang === 'en' ? '/en/book' : '/reservar'}?${params}`
//    Navegación dura, no router: la home y /reservar son páginas MPA
//    distintas (ARCHITECTURE §2.1) — no hay SPA router que preservar.
//
// 7. Markup: <form> con tres bloques Label + control, mensaje de error en
//    <p role="alert"> bajo el formulario, y Button submit con
//    `disabled={!pickupZone || !start || !end}`. Un <small> aclara "hora
//    local de Mérida" junto a los inputs de fecha (ver errores comunes).
//
// ----------------------------------------------------------------------------
// CONTRATO
// ----------------------------------------------------------------------------
// Props: { lang: 'es' | 'en'; zones: { zone: string; feeCents: number }[] }
// — las pasa la página desde settings (servidor). No consume API: solo
// produce una navegación a /reservar|/en/book con ?start&end&zone, que
// BookingFlow leerá al montar. Montar con `client:load` en la home.
//
// ----------------------------------------------------------------------------
// ERRORES COMUNES
// ----------------------------------------------------------------------------
// - TIMEZONE: datetime-local captura la hora LOCAL DEL NAVEGADOR, sin zona.
//   El negocio opera en America/Merida (CST fijo, sin DST — ARCHITECTURE
//   §2.13). Para el MVP se asume que quien cotiza está pensando en hora de
//   Mérida y el SERVIDOR interpreta el string como America/Merida al
//   convertir a timestamptz (documéntalo también en /api/quote); la UI no
//   corrige nada. Si fase 2 pide precisión para turistas en otras zonas, la
//   conversión se hace en servidor, no aquí.
// - Olvidar el atributo `min`: sin él el usuario elige ayer y el error llega
//   tarde, después del clic.
// - Submit habilitado con campos vacíos: deshabilítalo Y revalida en el
//   handler — el disabled es UX, no validación.
// - Formatear feeCents con toFixed(2) directo sobre centavos: divide entre
//   100 antes, mejor con Intl.NumberFormat('es-MX', { style: 'currency',
//   currency: 'MXN' }).
// ============================================================================
