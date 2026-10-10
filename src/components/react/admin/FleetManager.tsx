// ============================================================================
// ISLA REACT: FleetManager — CRUD de flota (/admin/flota, spec §4.2)
// ============================================================================
// Propósito: administrar el catálogo en sus dos niveles (ARCHITECTURE §3):
// MODELOS (lo que se muestra y cotiza: nombre, categoría, tarifa, fotos,
// activo) y UNIDADES (las placas físicas con su status). Solo español, sin
// prop lang.
//
// ----------------------------------------------------------------------------
// DECISIONES
// ----------------------------------------------------------------------------
// * Mismo patrón de estado que ReservationsBoard: useState para los datos +
//   loadFleet() con re-fetch tras cada mutación, sin optimistic UI. El
//   catálogo es chico (pocos modelos, decenas de placas): una query después
//   de guardar cuesta menos que mantener estado derivado sincronizado.
// * DELETE siempre LÓGICO, nunca físico: bookings históricos referencian
//   vehicle_id / model_id — un borrado real rompe la FK o se lleva el
//   historial en cascada. Modelo → active=false (deja de cotizar); unidad →
//   status='retired'. El botón se ve como "Eliminar", pero
//   DELETE /api/admin/vehicles/[id] ya hace el borrado lógico en servidor.
// * Slug autogenerado del nombre con un slugify DE 3 LÍNEAS escrito a mano:
//   normalize('NFD') + replace(/\p{Diacritic}/gu, '') para quitar acentos,
//   lowercase, regex [^a-z0-9]+ → '-'. No instales una dependencia para
//   esto; es la pieza más simple del archivo.
// * Tarifa: el input trabaja en PESOS (como piensa el admin: "850") y se
//   convierte a centavos (×100 con Math.round) ANTES de enviar — la BD y
//   toda la API hablan en centavos (ARCHITECTURE §2.13). El error clásico
//   es mandar pesos y cobrar 100× menos; queda marcado también abajo.
// * Fotos: en MVP, un Textarea con una URL por línea (split('\n').map(trim)
//   .filter(Boolean)). La subida real a R2 con preview es fase 2
//   (ARCHITECTURE §7) — no metas un uploader aquí todavía.
// * Tarifas por temporada (seasons): NO se editan aquí. Se sembraron con el
//   seed y pricing.ts ya las aplica; su UI llega en fase 2 vía settings. Si
//   se muestran en esta pantalla, read-only informativo — nunca editable.
//
// ----------------------------------------------------------------------------
// PASOS
// ----------------------------------------------------------------------------
// 1. Imports: useState, useEffect de react. De shadcn/ui: Table, Badge,
//    Button, Dialog, Input, Label, Select, sonner. RHF + zodResolver con
//    vehicleUpsertSchema de src/lib/validation.ts para el Dialog de modelo.
//
// 2. Tipos locales: ModelRow { id, slug, name, category, transmission,
//    seats, luggage, dailyRateCents, photos, active, units: UnitRow[] } y
//    UnitRow { id, plate, status }. loadFleet(): GET /api/admin/vehicles —
//    el endpoint ya devuelve las unidades anidadas por modelo; no hagas
//    N+1 desde el cliente.
//
// 3. Sección MODELOS: <Table> con columnas nombre, categoría, tarifa/día
//    (dailyRateCents/100 → Intl.NumberFormat currency MXN), # unidades
//    (units.length), activo (switch/checkbox → PATCH
//    /api/admin/vehicles/[id] con { active: !active } + loadFleet), y botones
//    Editar / Eliminar. Eliminar abre <Dialog> de confirmación que explica
//    el borrado lógico ("dejará de cotizar; el historial se conserva") →
//    DELETE /api/admin/vehicles/[id] + loadFleet + toast.
//
// 4. DIALOG de modelo (alta y edición con el mismo componente: si recibe
//    model, defaultValues con él y submit = PATCH; si no, POST): useForm con
//    zodResolver(vehicleUpsertSchema). Campos: name (su onBlur rellena slug
//    con slugify SOLO si slug está vacío — si autogeneras en cada tecla
//    peleas con lo que el admin escribe), slug, category (Select),
//    transmission, seats, luggage (type number), dailyRate (pesos, number),
//    photos (Textarea, una URL por línea). En submit: transformar
//    dailyRate → dailyRateCents (×100) y photos texto → string[]; POST o
//    PATCH /api/admin/vehicles[/id]; 200/201 → toast, cerrar, loadFleet();
//    400 → mapear issues zod a campos con setError.
//
// 5. Sección UNIDADES: sub-tabla expandible por fila de modelo (botón ▸ que
//    toggla un useState<Set<number>> de ids expandidos — más simple que un
//    segundo panel sincronizado). Columnas: placa, status (Select inline
//    active|maintenance|retired → PATCH inmediato + loadFleet; 'maintenance'
//    es el aviso rápido "está en el taller" — los bloqueos CON fechas se
//    capturan en ReservationsBoard), y quitar (retired). Alta de unidad:
//    mini-form de un solo Input (placa) + botón → POST /api/admin/vehicles
//    con body de unidad { modelId, plate } (el endpoint discrimina modelo vs
//    unidad por el shape del body — documéntalo en la guía de ese endpoint).
//
// ----------------------------------------------------------------------------
// CONTRATO
// ----------------------------------------------------------------------------
// Sin props (isla admin raíz, client:load). Consume GET/POST
// /api/admin/vehicles y PATCH/DELETE /api/admin/vehicles/[id] (DELETE =
// borrado lógico: active=false en modelos, status='retired' en unidades).
// Requiere cookie rapidoz_session; 401 → window.location.href = '/admin/login'.
//
// ----------------------------------------------------------------------------
// ERRORES COMUNES
// ----------------------------------------------------------------------------
// - Mandar la tarifa en pesos sin ×100: todo lo monetario son centavos
//   (§2.13). Convierte en el submit; al editar, divide /100 al poblar
//   defaultValues — si no, cada edición infla o desinfla el precio 100×.
// - DELETE físico: rompe las FK con bookings y pierde el historial de rentas
//   de esa placa. Lógico, siempre.
// - slugify con dependencia externa: bastan 3 líneas (normalize, lowercase,
//   regex). Y solo autogenera el slug cuando está vacío.
// - Editar seasons aquí: no existe esa UI ni endpoint todavía; mostrarlas
//   editable implicaría schema + endpoint nuevos — fase 2.
// ============================================================================
