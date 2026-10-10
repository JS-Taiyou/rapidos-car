// ============================================================================
// ISLA REACT: ReservationsBoard — pipeline de reservaciones (spec §4.3)
// ============================================================================
// Propósito: la pantalla de trabajo diario del admin (/admin/reservaciones):
// ver qué rentas hay (lista o calendario), moverlas por el pipeline
// quoted → confirmed → active → completed | cancelled, capturar
// reservaciones por teléfono/walk-in y bloquear unidades en taller.
// Solo español, sin prop lang.
//
// ----------------------------------------------------------------------------
// DECISIONES
// ----------------------------------------------------------------------------
// * Estado: useState para filtros { from, to, status }, useState para la
//   lista, y UN useEffect que fetchea GET /api/admin/bookings?from&to&status
//   cada vez que cambian los filtros, con AbortController en el cleanup —
//   la misma carrera que en BookingFlow: cambiar un filtro rápido no debe
//   dejar que una respuesta vieja pise a la nueva.
// * Re-fetch simple tras cada mutación (PATCH/POST), NO optimistic UI: el
//   volumen es bajo (decenas de rentas/mes) y la verdad del servidor es
//   barata. El pipeline tiene reglas de transición que el servidor valida;
//   un estado optimista tendría que reimplementarlas y luego reconciliar
//   cuando el servidor diga que no. Una query y listo.
// * Filtrado en el SERVIDOR con query params, no en cliente: la tabla
//   bookings crece para siempre; traer todo y filtrar en JS deja de
//   funcionar en cuanto hay historial (y desde el día uno manda datos de
//   más por la red).
// * Calendario A MANO con CSS grid (un mes: columnas = días, filas =
//   unidades, barras = divs con grid-column calculado del periodo):
//   FullCalendar pesa ~300 kB y cobra para uso comercial; aquí basta
//   lectura visual ("¿qué placa está ocupada qué días?"). Si algún día se
//   necesita drag-and-drop, migrar entonces — no antes.
// * Captura manual y bloqueos comparten formulario y endpoint (POST
//   /api/admin/bookings con kind 'rental' | 'block'): ARCHITECTURE §2.10 —
//   un bloqueo ES una reservación sin cliente; la constraint de exclusión
//   cubre ambos gratis y el calendario dibuja un solo modelo de datos.
//
// ----------------------------------------------------------------------------
// PASOS
// ----------------------------------------------------------------------------
// 1. Imports: useState, useEffect, useCallback de react. De shadcn/ui:
//    Table (Header/Body/Row/Head/Cell), Badge, Button, Dialog, Select,
//    Input, Label, sonner (toast). RHF + zodResolver SOLO dentro del Dialog
//    de captura manual, con manualBookingSchema de src/lib/validation.ts.
//
// 2. Tipo local AdminBooking { id, code, kind, status, customerName | null,
//    customerPhone | null, vehicleLabel, periodStart, periodEnd (ISO),
//    totalCents, pickupZone, note | null }. El endpoint ya devuelve el
//    periodo descompuesto (lower/upper) — no parses tstzrange en el cliente.
//
// 3. `loadBookings(signal?)`: construye URLSearchParams con los filtros no
//    vacíos, GET /api/admin/bookings, setBookings(json). El efecto:
//      useEffect(() => { const ac = new AbortController();
//        loadBookings(ac.signal); return () => ac.abort() }, [from, to, status])
//    Tras cada PATCH/POST exitoso: await loadBookings() (sin signal; es una
//    recarga manual disparada por el usuario, no por el efecto).
//
// 4. Barra de filtros: dos <Input type="date"> (from/to) + Select de status
//    (todos/quoted/confirmed/active/completed/cancelled) + toggle de vista
//    'list' | 'calendar' (un useState más).
//
// 5. Vista LISTA: <Table> con columnas: código (RPZ-…), cliente (nombre y
//    teléfono; si kind='block' muestra "BLOQUEO" + note — render
//    condicional, los blocks no tienen customer_*), unidad (placa/modelo),
//    periodo formateado con Intl.DateTimeFormat('es-MX', { timeZone:
//    'America/Merida', dateStyle: 'medium', timeStyle: 'short' }), total
//    (totalCents/100 con Intl currency MXN; los blocks van en guion), y
//    <Badge> con variant de color por status.
//
// 6. Acciones por fila derivadas del status (mapa status → botones):
//      quoted    → [Confirmar, Cancelar]
//      confirmed → [Iniciar renta, Cancelar]
//      active    → [Completar]
//      completed | cancelled → [] (terminal: sin botones)
//    Cada acción: PATCH /api/admin/bookings/[id] con { status: siguiente } y
//    luego loadBookings(). "Cancelar" pasa primero por un <Dialog> de
//    confirmación ("¿Cancelar RPZ-123456?"); las demás van directo. Si el
//    servidor responde 400/409 (transición inválida), toast con su mensaje.
//
// 7. Vista CALENDARIO: contenedor display:grid con grid-template-columns:
//    `160px repeat(díasDelMes, 1fr)`; primera columna = etiqueta de unidad
//    (placa), una fila por unidad activa, cabecera con los números de día.
//    Por cada booking que solape el mes, un <div> en la fila de su unidad
//    con gridColumn: `${diaInicio} / span ${dias}` — clampa diaInicio/dias
//    a los bordes del mes visible con Math.max/min (una renta que empieza el
//    mes anterior NO puede producir columnas negativas). Color por status,
//    rayado si kind='block', title con código y cliente para hover. Botones
//    ‹ › mueven un useState<Date> del mes visible, del que se derivan from/
//    to del fetch en esta vista.
//
// 8. CAPTURA MANUAL: <Dialog> abierto desde "Capturar reservación". Dentro,
//    radio kind: 'rental' | 'block'. UN solo useForm con
//    zodResolver(manualBookingSchema) — el schema ya hace el refine: rental
//    exige customer*, block los prohíbe y exige note. Campos rental: nombre,
//    teléfono, email opcional, modelo (Select), rango (dos datetime-local),
//    zona, depósito. Campos block: unidad (Select de placas), rango, nota.
//    Submit → POST /api/admin/bookings: 201 → toast "Guardada", cerrar,
//    loadBookings(); 409 → toast sonner "Solape con <código>" (mismo manejo
//    que el flujo público: quien sabe es el servidor); 400 → mapear issues
//    zod a los campos con setError.
//
// ----------------------------------------------------------------------------
// CONTRATO
// ----------------------------------------------------------------------------
// Sin props (isla admin raíz, client:load). Consume GET/POST
// /api/admin/bookings y PATCH /api/admin/bookings/[id] (transiciones válidas
// en ARCHITECTURE §4). Todo exige la cookie rapidoz_session: un 401 aquí
// significa sesión expirada → window.location.href = '/admin/login'.
//
// ----------------------------------------------------------------------------
// ERRORES COMUNES
// ----------------------------------------------------------------------------
// - Mutar y no re-fetchear: la fila queda con el status viejo (stale) y el
//   admin "confirma" dos veces. Toda mutación termina en loadBookings().
// - Renderizar booking.customerName sin checar kind='block': los bloqueos no
//   tienen cliente → "null" en pantalla o crash. Render condicional siempre.
// - Filtrar en cliente: la lista crece para siempre; los filtros son query
//   params del GET, punto.
// - Calcular el span de la barra sin clamplear al mes visible: columnas
//   negativas rompen el grid entero.
// ============================================================================
