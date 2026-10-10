// ============================================================================
// API: /api/admin/bookings/[id] — PATCH transiciones del pipeline (spec §4.3)
// ============================================================================
// NOTA DE SCAFFOLDING: el archivo se llama `_[id].ts` (guion bajo) para que
// el router de Astro lo ignore mientras es guía — sin exports, Astro exigiría
// getStaticPaths y el build fallaría. Al implementarlo, renómbralo a
// `[id].ts` (y descomenta el `prerender = false` del paso 1).
// ============================================================================
// PROPÓSITO
// Mover una reservación por la máquina de estados:
// quoted → confirmed → active → completed | cancelled.
// Es el endpoint detrás de los botones del ReservationsBoard.
//
// ----------------------------------------------------------------------------
// DECISIONES
// ----------------------------------------------------------------------------
// * La máquina de estados vive en el SERVIDOR como datos explícitos (un mapa
//   status → transiciones permitidas). La isla muestra botones, pero quien
//   PERMITE la transición es el servidor — mismo principio que ARCHITECTURE
//   §2.9: el cliente propone, el servidor dispone.
// * Cancelar NO requiere "liberar" nada a mano: la constraint no_overlap y las
//   queries de disponibilidad filtran por status ('confirmed','active'); al
//   pasar a 'cancelled' la unidad queda libre automáticamente. Es la elegancia
//   del diseño: el inventario es una proyección del estado, no un contador que
//   sincronizar. Explícitalo en el código con un comentario y resiste la
//   tentación de agregar UPDATEs extra.
// * Sin DELETE en este endpoint: el historial no se borra; se cancela.
//
// ----------------------------------------------------------------------------
// PASOS
// ----------------------------------------------------------------------------
// 0. PASO 0 de todo /api/admin/* (§2.3): const admin = await
//    requireAdminApi(context.cookies); if (!admin) → 401
//    { error: 'unauthorized' }.
// 1. export const prerender = false (COMENTADO hasta instalar el adapter, §6).
// 2. Imports (comentados): type APIContext de 'astro'; sql desde
//    '../../../../lib/db'; bookingPatchSchema desde '../../../../lib/validation'.
// 3. A nivel módulo, el mapa (escríbelo como objeto literal para que se lea de
//    un vistazo):
//      const ALLOWED_TRANSITIONS = {
//        quoted:    ['confirmed', 'cancelled'],
//        confirmed: ['active', 'cancelled'],
//        active:    ['completed'],
//        completed: [],
//        cancelled: [],
//      }
//    Léelo en voz alta: "de confirmada puedo entregar (active) o cancelar; de
//    activa solo completar; los estados terminales no se mueven".
// 4. export async function PATCH(context: APIContext):
//    a. const id = parseInt(context.params.id ?? '', 10) → si Number.isNaN(id),
//       400 { error: 'invalid_id' }. Los params de ruta llegan SIEMPRE como
//       string; valida antes de usarlos en la query.
//    b. request.json() en try/catch → 400 invalid_json; bookingPatchSchema
//       .safeParse(body) → 400 { error: 'validation', issues } (§2.12). Shape:
//       { status, notes? }.
//    c. SELECT * FROM bookings WHERE id = ${id} → si no hay fila, 404
//       { error: 'not_found' }.
//    d. const from = booking.status; const to = parsed.data.status;
//       if (!ALLOWED_TRANSITIONS[from].includes(to)) → 409
//       { error: 'invalid_transition', from, to }. El front usa from/to para
//       mostrar "no puedes pasar de X a Y" con la respuesta del servidor, sin
//       adivinar el motivo.
//    e. UPDATE bookings SET status = ${to}, notes = COALESCE(${notes}, notes)
//       WHERE id = ${id} RETURNING * → 200 { booking: updated }. El COALESCE
//       conserva las notas viejas si el PATCH no trae nuevas.
//    f. TODO (fase 2): al pasar a 'active' aquí se adjuntaría el checklist de
//       entrega (fotos del auto, nivel de gasolina, firma del cliente); el MVP
//       solo cambia el estado.
// 5. export function ALL(): 405 con header Allow: PATCH.
//
// ----------------------------------------------------------------------------
// CONTRATO
// ----------------------------------------------------------------------------
// PATCH /api/admin/bookings/42   { status: 'active', notes? }
//   → 200 { booking }
// Errores: 400 invalid_id / invalid_json / validation · 401 unauthorized ·
//   404 { error: 'not_found' } ·
//   409 { error: 'invalid_transition', from, to } · 405
//
// ----------------------------------------------------------------------------
// ERRORES COMUNES
// ----------------------------------------------------------------------------
// - Confiar en que la isla solo manda transiciones válidas: los botones se
//   pueden forzar con un fetch desde la consola; valida SIEMPRE en servidor.
// - "Liberar la unidad" con UPDATEs extra al cancelar: no hay nada que liberar,
//   el filtro de status lo hace (DECISIONES #2). Código extra = bugs extra.
// - Permitir completed → cancelled "para corregir errores": rompe reportes y
//   trazabilidad; si hubo un error, nota en notes y ajuste contable manual.
// - parseInt sin validar NaN: la query con NaN devuelve 0 filas y reportarías
//   un 404 mentiroso en vez del 400 correcto.
// ============================================================================
