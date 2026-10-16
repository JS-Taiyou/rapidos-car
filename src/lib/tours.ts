// Onboarding con driver.js (carga PEREZOSA: el tour no pesa ni un byte en
// páginas donde no se usa — se importa al hacer clic). Dos audiencias:
// - Staff: startStaffTour(pathname, role) — recorre la pantalla actual; el
//   patio tiene su propio guion y no ve pasos de operation.
// - Cliente: startBookingTour(lang) — explica el funnel de /reservar en
//   4 pasos anclados a elementos estables (el wizard cambia de DOM por
//   paso, así que el tour es conceptual, no interactivo).
import '../styles/driver.css';

interface TourStep {
  element?: string;
  title: string;
  body: string;
}

async function drive(steps: TourStep[]): Promise<void> {
  const { driver } = await import('driver.js');
  const d = driver({
    showProgress: true,
    progressText: '{{current}} de {{total}}',
    doneBtnText: 'Listo',
    nextBtnText: 'Siguiente',
    prevBtnText: 'Anterior',
    allowClose: true,
    overlayClickBehavior: 'nextStep',
    steps: steps.map((s) => ({
      // Sin ancla (o ancla que no existe en pantalla): popover centrado.
      element: (s.element && document.querySelector(s.element)) || undefined,
      popover: { title: s.title, description: s.body },
    })),
  });
  d.drive();
}

// ---------------------------------------------------------------------------
// STAFF — guiones por pantalla (español; el panel es mono-idioma).
// ---------------------------------------------------------------------------
const STAFF_TOURS: Record<string, TourStep[]> = {
  '/admin': [
    { title: 'Tu día de un vistazo', body: 'Entregas y devoluciones de hoy por tramo, y cuántas unidades están en renta ahora mismo.' },
    { element: '[data-tour=dash-pickups]', title: 'Entregas de hoy', body: 'Cada tramo que empieza hoy: cliente, modelo, placa, zona y número de vuelo si lo hay.' },
    { element: '[data-tour=dash-returns]', title: 'Devoluciones de hoy', body: 'Las unidades que hoy regresan. La captura se hace desde Entregas, con checklist y fotos.' },
    { element: '[data-tour=dash-service]', title: 'Mantenimiento pendiente', body: 'Cuando aparezca esta franja, hay unidades que superaron su intervalo de kilometraje: mándalas a taller y registra el servicio en Flota.' },
  ],
  '/admin/entregas': [
    { element: '[data-tour=entregas-fecha]', title: 'La agenda del patio', body: 'Navega día por día. Muestra las entregas y devoluciones de la fecha, por tramo: una renta puede cambiar de vehículo a mitad.' },
    { element: '[data-tour=entregas-contadores]', title: 'Pendientes', body: 'Lo que falta por capturar hoy. Sin conexión funciona igual: la agenda queda en la tablet y lo que captures se sube solo al reconectar.' },
    { element: '[data-tour=entregas-tarjeta]', title: 'La tarjeta lo trae todo', body: 'Hora, cliente, modelo y placa. El botón de teléfono llama directo; el botón grande abre la captura.' },
    { title: 'La captura, sin papel', body: 'Checklist, odómetro, combustible y FOTOS de evidencia (mínimo una). Al confirmar la entrega, el tramo pasa a activo; al confirmar la devolución, se cierra — y si la unidad cruzó su intervalo de servicio, te avisamos aquí mismo.' },
  ],
  '/admin/reservaciones': [
    { element: '[data-tour=res-toolbar]', title: 'Filtrar y cambiar de vista', body: 'Rango de fechas y estado; lista o calendario. El gloito ámbar del menú te lleva a los leads web sin confirmar.' },
    { element: '[data-tour=res-capturar]', title: 'Capturar reservación', body: 'Rentas de teléfono o walk-in — y bloqueos de taller. La unidad la asigna el servidor; los extras y ajustes de precio viajan con motivo.' },
    { element: '[data-tour=res-tabla]', title: 'Acciones por renta', body: 'Editar ajusta el tramo vigente; Extender/Cambiar trocea la renta en varios vehículos con prorrateo y alternativas si algo choca; Precio aplica descuentos con razón obligatoria. El calendario pinta cada tramo sobre la fila de su placa.' },
  ],
  '/admin/flota': [
    { element: '[data-tour=flota-filtros]', title: 'Encuentra el modelo', body: 'Filtra por categoría y transmisión; los modelos deshabilitados también aparecen (buscarlos no debe costar pasos).' },
    { element: '[data-tour=flota-tabla]', title: 'Modelos, placas y estado', body: 'Cada modelo despliega sus unidades (Activa / Taller / Retirada) y, si una superó su kilometraje de servicio, la franja 🔧 con el botón para registrar el servicio. La columna Habilitado apaga un modelo del catálogo — con confirmación si tiene varias placas.' },
  ],
  '/admin/tarifas': [
    { element: '[data-tour=tarifas-tabs]', title: 'Temporadas y extras', body: 'Las reglas del motor de precios. Los cambios aplican a las cotizaciones nuevas; las rentas existentes conservan su snapshot.' },
    { element: '[data-tour=tarifas-franja]', title: 'El año de un vistazo', body: 'Las franjas muestran cada temporada sobre los 12 meses: los solapes se ven y se desempatan por prioridad (la mayor gana).' },
  ],
  '/admin/ajustes': [
    { title: 'La identidad del negocio', body: 'Nombre, contacto, mensajería y logo cambian el sitio público AL INSTANTE (sin rebuild): así se adapta el white-label.' },
    { element: '[data-tour=ajustes-mantenimiento]', title: 'Mantenimiento por kilometraje', body: 'Actívalo y define cada cuántos kilómetros avisar. Se evalúa al cerrar cada devolución con el odómetro del handover.' },
    { element: '[data-tour=ajustes-checklists]', title: 'Checklists del patio', body: 'Lo que el staff revisa al entregar y recoger; la casilla lo deja pre-marcado en la captura.' },
  ],
  '/admin/reportes': [
    { element: '[data-tour=rep-rango]', title: 'El periodo manda', body: 'Todo el reporte se calcula para el rango visible. Cambia las fechas y aplica: los ingresos se atribuyen por TRAMO y su fecha de inicio.' },
    { element: '[data-tour=rep-resumen]', title: 'El embudo web', body: 'Solicitudes, conversiones y leads pendientes: cada lead capturado sin disponibilidad cuenta como demanda latente.' },
    { element: '[data-tour=rep-modelos]', title: 'Ingresos y demanda por modelo', body: 'El oro del negocio: qué modelos facturan y cuáles solo generan pedidos (etiqueta SOLO DEMANDA) — candidatos a ampliar flota o ajustar precio.' },
    { element: '[data-tour=rep-ocupacion]', title: 'Ocupación por unidad', body: 'Días ocupados sobre el rango. Las barras ámbar (80%+) son unidades candidatas a replicar en el inventario.' },
    { element: '[data-tour=rep-rango]', title: 'Para el contador', body: 'El botón XLS descarga el periodo en dos hojas (rentas y desglose por tramo) con fórmulas de suma; la exportación queda auditada.' },
  ],
  '/admin/clientes': [
    { element: '[data-tour=cli-buscar]', title: 'Un solo buscador', body: 'Nombre, CURP, email o teléfono — el CRM resuelve la identidad: la CURP es la llave fuerte y el email/teléfono auto-vinculan reservas entrantes.' },
    { title: 'El expediente', body: 'De cada cliente: historial de rentas con precios, contactos retirados (nunca se descartan), notas y la bandera no-show. La CURP se captura con la identificación al firmar.' },
    { title: 'Unificación sin duplicados', body: 'Si capturas una CURP que ya existe, los expedientes se fusionan: las reservas y el historial viajan al sobreviviente, y queda auditado.' },
  ],
  '/admin/puntos': [
    { element: '[data-tour=puntos-lista]', title: 'Los puntos de entrega/recogida', body: 'Lo que ve el cliente en el cotizador. La tarifa se cobra por punto (y dos veces si recoges en otro punto: es un traslado del staff); vacía = gratuito.' },
    { element: '[data-tour=puntos-forma]', title: 'Ubícalo en el mapa', body: 'Clic o arrastre del pin: la ubicación exacta alimenta el mapa público de /ubicaciones y el cálculo del staff.' },
  ],
  '/admin/usuarios': [
    { element: '[data-tour=usr-tabla]', title: 'Cuentas y roles', body: 'Administrador (todo), Recepción (operación completa) y Patio (entregas y handovers). El rol filtra el menú y blinda páginas y APIs.' },
    { title: 'Desactivar, nunca borrar', body: 'Una cuenta desactivada cierra sus sesiones al instante, pero el historial de auditoría la conserva. También desde aquí se reestablecen contraseñas.' },
    { title: 'Protección dura', body: 'El panel nunca se queda sin administradores activos: el último no puede ser degradado ni desactivado.' },
  ],
  '/admin/auditoria': [
    { element: '[data-tour=aud-filtros]', title: 'Quién hizo qué, cuándo', body: 'Filtra por usuario, entidad, acción y fechas — o busca una reservación por su código.' },
    { element: '[data-tour=aud-tabla]', title: 'El diff dice la verdad', body: 'Cada cambio muestra el antes → después (lo tachado en rojo es lo que era). Precios, estados, roles, merges, handovers y exportaciones: todo queda aquí.' },
  ],
};

const STAFF_FALLBACK: TourStep[] = [
  { title: '¿Qué hay por aquí?', body: 'Todo el panel comparte la misma columna: Dashboard para el día, Entregas para el patio, Reservaciones para el pipeline, Flota y Tarifas para el inventario y precios, Reportes y Clientes para el negocio.' },
];

export async function startStaffTour(pathname: string, role: 'admin' | 'desk' | 'yard'): Promise<void> {
  const key = pathname.replace(/\/+$/, '') || '/admin';
  let steps = STAFF_TOURS[key] ?? STAFF_FALLBACK;
  if (role === 'yard') {
    // El patio no ve las demás pantallas: su tour es siempre el de entregas.
    steps = STAFF_TOURS['/admin/entregas'];
  }
  await drive([
    { title: `Tour rápido${role === 'yard' ? ' (patio)' : ''}`, body: '30 segundos para dominar esta pantalla. Sácalo cuando quieras con el botón ? del menú.' },
    ...steps,
  ]);
}

// ---------------------------------------------------------------------------
// CLIENTE — el funnel de /reservar explicado (bilingüe: la página lo es).
// ---------------------------------------------------------------------------
export async function startBookingTour(lang: 'es' | 'en'): Promise<void> {
  const es: TourStep[] = [
    { element: '[data-tour=book-widget]', title: '1. Cuándo y dónde', body: 'Elige fecha y hora de entrega y devolución, y los puntos (pueden ser distintos). El precio ya incluye temporadas y traslados.' },
    { element: '[data-tour=book-wizard]', title: '2. Elige tu auto', body: 'Sólo verás modelos con unidad disponible, cada uno con su TOTAL final: sin sorpresas al confirmar.' },
    { title: '3. Extras y datos', body: 'Silla de bebé, conductor adicional… y tus datos con número de vuelo si llegas al aeropuerto.' },
    { title: '4. Confirma por WhatsApp', body: 'Al terminar recibes tu código de reservación y un mensaje listo para enviar: la reserva queda protegida contra dobles reservas desde ese momento.' },
  ];
  const en: TourStep[] = [
    { element: '[data-tour=book-widget]', title: '1. When & where', body: 'Pick your pickup/return dates and points (they can differ). The price already includes seasons and delivery fees.' },
    { element: '[data-tour=book-wizard]', title: '2. Pick your car', body: 'Only models with an available unit are listed, each with its final TOTAL — no surprises at pickup.' },
    { title: '3. Extras & details', body: 'Child seat, additional driver… plus your details and flight number if you land at the airport.' },
    { title: '4. Confirm on WhatsApp', body: 'You get a reservation code and a ready-to-send message: your booking is protected against double-booking from that moment.' },
  ];
  await drive(lang === 'en' ? en : es);
}
