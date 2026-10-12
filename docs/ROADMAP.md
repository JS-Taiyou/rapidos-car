# Roadmap de fases — operaciones, PWA y quick wins

> **Estado (oct 2026): TODAS las fases implementadas y verificadas** —
> segmentos (006), auditoría (007+visor), handover (/admin/entregas),
> replan (preview+PUT), PWA (manifest/sw.js/cola), tarifas (008+/admin/tarifas)
> y quick wins (sitemap/robots, reviews Google, XLS). Las secciones abajo
> conservan el diseño original de la planeación.

Plan de implementación acordado (octubre 2026). Cada fase declara objetivo,
modelo de datos, endpoints, UI, casos bordes y criterios de aceptación. La
fuente de verdad de arquitectura sigue siendo `docs/ARCHITECTURE.md`; este
documento manda sobre el *orden y alcance* de estas features.

**Orden de implementación y por qué:**

| # | Fase | Tamaño | Depende de |
|---|------|--------|------------|
| 1 | Segmentos (rentas multi-vehículo) | XL | — |
| 2 | Log de auditoría | M | 1 (para auditar segmentos desde el día 1) |
| 3 | Handover: checklist entrega/devolución con fotos | L | 1, 2 |
| 4 | Extensiones y cambios de vehículo (asistente) | L | 1, 3 |
| 5 | PWA offline para el staff | L | 3 (agenda/entregas estables) |
| 6 | UI de temporadas y extras | M | — (independiente) |
| 7 | Quick wins: sitemap/robots, reviews Google, export XLS | S c/u | — (independientes) |

La fase 1 va primero porque **todo lo operativo (handover, extensiones,
reportes de ingreso por segmento) cuelga del modelo de segmentos**; hacer el
checklist antes implicaría migrarlo después.

---

## Fase 1 — Segmentos: la renta como línea de tiempo de vehículos

### Problema

`bookings` es plana: una unidad, un período, un precio. No puede representar
"8 días = 2 días compacto + 3 días pickup + 2 días sedán", ni una extensión
con cambio de unidad, ni el cierre anticipado de un tramo.

### Diseño

`bookings` pasa a ser la **cabecera de la renta**: identidad (código,
cliente, canal), estado agregado, notas, `requested`, `total_cents`
(denormalizado = suma de segmentos). La asignación de unidad/período/precio
baja a `booking_segments`, donde cada fila es un tramo con un modelo:

```sql
-- 006_booking_segments.sql (esqueleto; el archivo final lleva comentarios)
CREATE TABLE booking_segments (
  id           bigserial PRIMARY KEY,
  booking_id   bigint NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  idx          integer NOT NULL CHECK (idx > 0),      -- orden legible 1..n
  model_id     bigint NOT NULL REFERENCES vehicle_models(id),
  vehicle_id   bigint REFERENCES vehicles(id),        -- unidad concreta
  period       tstzrange NOT NULL,
  status       text NOT NULL DEFAULT 'reserved'
               CHECK (status IN ('reserved','active','completed','cancelled')),
  pricing      jsonb NOT NULL DEFAULT '{}'::jsonb,    -- mismo shape que hoy
  extras       jsonb NOT NULL DEFAULT '[]',
  pickup_zone  text NOT NULL,
  return_zone  text,
  -- Handover (se llena en el patio, Fase 3):
  odometer_out integer,
  fuel_out     smallint CHECK (fuel_out BETWEEN 0 AND 8),  -- octavos de tanque
  odometer_in  integer,
  fuel_in      smallint CHECK (fuel_in BETWEEN 0 AND 8),
  handover_out jsonb,   -- {at, staffEmail, checklist, photos, notes, signature?}
  handover_in  jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (booking_id, idx)
);

-- La garantía anti-doble-reservación SE MUEVE aquí (la unidad vive en el
-- segmento). Cancelados/completados no bloquean, igual que antes.
ALTER TABLE booking_segments ADD CONSTRAINT no_overlap_segment EXCLUDE USING gist (
  vehicle_id WITH =, period WITH &&
) WHERE (vehicle_id IS NOT NULL AND status IN ('reserved','active'));

CREATE INDEX booking_segments_booking_idx ON booking_segments(booking_id);
CREATE INDEX booking_segments_vehicle_idx ON booking_segments(vehicle_id);
CREATE INDEX booking_segments_lower_period_idx ON booking_segments (lower(period));
CREATE INDEX booking_segments_status_idx ON booking_segments (status);
```

**Backfill** (todo booking existente → su segmento 1, copiando pricing/zonas;
los bloques `kind='block'` también son rentas de 1 segmento):

```sql
INSERT INTO booking_segments (booking_id, idx, model_id, vehicle_id, period,
                              status, pricing, extras, pickup_zone, return_zone)
SELECT b.id, 1, v.model_id, b.vehicle_id, b.period,
       CASE b.status WHEN 'quoted' THEN 'reserved' ELSE b.status END,
       b.pricing, b.extras, b.pickup_zone, b.return_zone
FROM bookings b JOIN vehicles v ON v.id = b.vehicle_id;

-- después: DROP CONSTRAINT no_overlap y DROP COLUMN vehicle_id, period,
-- extras, pickup_zone, return_zone en bookings. total_cents se queda.
```

### Reglas de negocio clave

- **Estado de la renta = derivado**: `active` si algún segmento está `active`;
  `completed` cuando todos los segmentos terminales están `completed`; los
  segmentos pueden cancelarse individualmente (libera la unidad) sin cancelar
  la renta. Se recalcula en app al mutar segmentos.
- **Motor de precios NO cambia**: cada segmento se cotiza con `computeQuote`
  con su modelo/período/zonas/extras. El prorrateo surge naturalmente: los
  días corridos se facturan con la tarifa del segmento que los cubre.
- **Descuento por renta larga sobre el total de días de la RENTA** (suma de
  los segmentos), no por tramo: el cliente que rentó 7 días en 2 modelos
  conserva el trato de 7 días. Aplicado como pct sobre cada segmento al
  (re)cotizar.
- **bookings.pricing** pasa a ser el **consolidado de lectura**: totales,
  depósito, y un array `segments: [{idx, model, period, totalCents, source}]`.
  El detalle vive en `booking_segments.pricing` (procedencia por tramo).
- **Ingresos en reportes por segmento**, atribuidos a `lower(period)` del
  tramo: una renta de octubre que cambia de auto en noviembre reconoce su
  tramo de noviembre en noviembre.
- Segmentos de una misma renta no se solapan entre sí (validado en la tx con
  lock; huecos entre tramos se permiten con advertencia en la UI).

### Barrido de código (lo que toca el refactor)

- `availability.ts`: `findAvailableModels` / `pickFreeUnit` / `isUnitFree`
  pasan a `NOT EXISTS (... booking_segments s JOIN bookings b ... WHERE
  b.status <> 'cancelled' AND s.status IN ('reserved','active'))`;
  `excludeBookingId` sigue filtrando por `b.id` (excluye la renta completa).
- `/api/bookings`: crea la renta + su segmento 1 en la misma tx. Lead 409
  (`quoted`) idéntico, con 1 segmento.
- `/api/admin/bookings` + `[id]`: lectura agrega segmentos (con placa por
  tramo); status/reprice/edit operan sobre el segmento correspondiente.
- `ReservationsBoard`: la reserva muestra su línea de tiempo de tramos
  (chips modelo · fechas · placa); edición y repricing por tramo.
- Reportes (conversión intacta; ingresos/ocupación/canal vía segmentos).
- `seed-demo`: sin cambios de fondo (rentas de 1 segmento).
- Backup de BD antes de migrar (ritual ya establecido).

### Criterios de aceptación

1. Migración idempotente; datos demo intactos (rentas con su segmento 1).
2. Carrera de disponibilidad sigue protegida: dos `POST /api/bookings`
   simultáneos por la última unidad → uno 409 (la constraint es el juez).
3. Funnel público, leads, CRM, reportes y alertas SSE funcionan igual que hoy.
4. `astro check` limpio; flota/catálogo público intactos.

---

## Fase 2 — Log de auditoría

Quién hizo qué, cuándo, con evidencia del antes/después. Transversal: se
integra aquí para que las fases 3 y 4 nazcan auditadas.

### Modelo

```sql
CREATE TABLE audit_log (
  id         bigserial PRIMARY KEY,
  at         timestamptz NOT NULL DEFAULT now(),
  user_id    bigint REFERENCES admin_users(id),  -- NULL si el usuario murió
  user_email text NOT NULL,                      -- denormalizado, sobrevive
  action     text NOT NULL,   -- login|logout|login_failed|create|update|delete|
                              -- status|reprice|replan|merge|handover|settings|...
  entity     text NOT NULL,   -- booking|segment|vehicle|model|customer|setting|...
  entity_id  bigint,
  summary    text NOT NULL,   -- "RPZ-0012: confirmed → active"
  diff       jsonb,           -- {campo: {before, after}} — nunca secrets
  ip         text,
  user_agent text
);
CREATE INDEX audit_log_at_idx ON audit_log (at DESC);
CREATE INDEX audit_log_entity_idx ON audit_log (entity, entity_id);
```

### Integración

- `src/lib/audit.ts`: `logAudit(sql, {req, user, action, entity, entityId,
  summary, before?, after?})` — dentro de la misma tx cuando la hay.
- Puntos de escritura: todos los endpoints admin mutantes (bookings,
  vehicles, models, customers + merge, settings, points, extras, seasons,
  photos) y auth (login ok/fallo, logout). En fases 3–4: cierre de handover
  y cada replan (con el diff de segmentos antes/después).
- Nunca registrar contraseñas ni hashes.

### Visor `/admin/auditoria`

Tabla con filtros (usuario, entidad, acción, rango de fechas, búsqueda por
código), paginación (50/página), y expansión del diff before/after lado a
lado. Sin purge (volumen bajo; retención >2 años como decisión posterior).

---

## Fase 3 — Handover: checklist de entrega/devolución con fotos (mobile-first)

### Filosofía de UX

El usuario del patio carga una tablet con una mano, bajo sol, quizá sin red
(Fase 5). Las pantallas de handover nacen mobile-first: botones ≥48 px,
checkboxes grandes, `inputmode="numeric"` para odómetro, diálogos a pantalla
completa en viewport angosto, barra de acción sticky, cero hover-only.
Después se hace un pass de estos mismos criterios sobre ReservationsBoard y
el resto del admin.

### Checklists configurables

`settings['handover_checklists']`:
```json
{ "out": [{"id":"fuel","label":"Tanque lleno","defaultChecked":true}, ...],
  "in":  [{"id":"damages","label":"Daños nuevos revisados","defaultChecked":false}, ...] }
```
Defaults razonables (tanque, kilometraje, rayones, llantas/refacción,
documentos, limpieza). Editables como lista en Ajustes (mismo patrón que
teléfonos).

### Pantallas

- **`/admin/entregas`** (nueva): la agenda del día — entregas y devoluciones
  por hora, tarjetas grandes, búsqueda por código/placa/nombre/cliente. Es la
  pantalla de inicio natural de la tablet del patio (y el atajo 1 del PWA).
  Nueva query "tramos de hoy": `booking_segments` con `lower(period)::date =
  hoy` (entregas) / `upper(period)::date = hoy` (devoluciones), solo status
  reservado/activo.
- **Flujo de entrega** (cierra `handover_out`): checklist marcable, odómetro
  inicial, combustible (selector visual de octavos E·1/8···F), notas, y
  **fotos de evidencia** con `<input type="file" accept="image/*"
  capture="environment">` (abre la cámara trasera directo en móvil) más
  dropzone para desktop. Mínimo 1 foto para cerrar (configurable). Al cerrar:
  `segment.status='active'`, renta → `active`, broadcast SSE, auditoría.
- **Flujo de devolución** (cierra `handover_in`): odómetro final, combustible,
  checklist (daños observados), fotos, y **cargo por exceso** si aplica:
  kilometraje recorrido > límite del segmento → ajuste de pricing
  (`source:'adjust'`, reason obligatoria, igual que los ajustes de precio
  existentes). Al cerrar: `status='completed'`; si era el último tramo, la
  renta → `completed`; broadcast + auditoría.

### Fotos

- Reutilizar `/api/admin/photos` con `dest='handover'` → guarda en
  `uploads/handover/{code}/seg{idx}/{ts}.jpg` vía sharp (reorienta EXIF,
  resize 1600px, calidad web). Servidas por `/uploads/[...path]` con cache
  inmutable, igual que flota.
- Cada foto queda listada en `handover_*.photos` con timestamp y quién cargó.

### Punto de integración futuro

La firma del cliente en canvas y la generación del contrato PDF (de la
lluvia de ideas) enganchan aquí: el handover ya tendrá la estructura
`{at, staff, checklist, photos}` lista para colgarle firma y PDF.

### Criterios de aceptación

1. Entrega y devolución cerradas desde un teléfono real (cámara incluida).
2. El odómetro/combustible quedan por tramo y son visibles en el detalle de
   la reserva (y del cliente).
3. Cargo por kilometraje excede → aparece en el desglose con razón.
4. Los estados de renta/segmento transicionan correctamente con varios
   tramos (entrego SUV del tramo 2 sin tocar el tramo 3).

---

## Fase 4 — Extensiones y cambios de vehículo (el asistente)

El escenario completo del negocio: extender, acortar, cambiar de modelo
prorrateando, con colisiones resueltas ofreciendo alternativas, y más de un
cambio durante la misma renta.

### Asistente "Extender o cambiar" (en el detalle de la reserva)

1. **Nuevo plan**: el staff edita la línea de tiempo resultante — mover fin,
   insertar cambio de vehículo en fecha X, replan completo multi-tramo.
2. **Validación por tramo**: ¿hay unidad del modelo libre? (excluyendo esta
   renta). Si un tramo colisiona → **pantalla de alternativas**: modelos con
   unidad libre en ese tramo, con precio/día y **delta total vs contrato
   original** (más caro / más barato / igual), para elegir en el momento.
3. **Precio preferencial en el momento**: sobre el delta se puede aplicar
   descuento con `reason` obligatoria (la maquinaria de overrides ya existe:
   `applyPricingOverrides`).
4. **Resumen de impacto**: tabla de tramos resultantes (período, modelo,
   placa, precio c/u, total), delta cobrable, depósito recalculado.
5. **Confirmar** → una transacción: lock de la renta, re-validación completa
   (la constraint sigue siendo el juez), cerrar/crear/editar segmentos,
   recotizar cada tramo touched, recalcular totals, auditoría (diff de
   segmentos), broadcast SSE.

### Reglas

- **Extensión con la misma unidad**: si la placa sigue libre en los días
   nuevos, es un simple update del período del tramo (recotizado por días).
- **Cambio en curso**: el tramo actual se cierra en la fecha de cambio
   (requiere `handover_in` del tramo saliente — la unidad no se libera sin
   devolución registrada) y nace el tramo entrante.
- **Prorrateo natural**: cada tramo se factura con su tarifa por sus días;
   el descuento de renta larga se evalúa sobre el total de días de la renta.
- Tramos de la renta sin solaparse entre sí; huecos permitidos con aviso.
- Endpoint: `PUT /api/admin/bookings/[id]/segments` — recibe el **plan
  completo resultante** (idempotente, fácil de razonar) y el server decide
  creates/updates/deletes.

### Criterios de aceptación

1. Compacto 8 días → (2 compacto + 3 pickup + 2 sedán) con precios por
   tramo y total = suma, descuento largo respetado.
2. Extensión que colisiona → alternativas con delta y cierre con descuento
   preferencial razonado.
3. Cambio en curso exige devolución del tramo saliente.
4. La constraint de BD rechaza cualquier plan que pise una unidad tomada
   (prueba de carrera incluida).

---

## Fase 5 — PWA offline para el staff

### Alcance deliberado

Offline-first **solo para el trabajo del patio**: agenda del día, fichas de
entrega/devolución y captura de handovers sin red. El resto del admin y todo
el sitio público siguen siendo SSR normal. Login requiere red (la sesión se
valida en servidor); la *sesión ya abierta* + cache permiten trabajar.

### Piezas

- **`/manifest.webmanifest` como endpoint SSR** que lee el tenant (nombre,
   icono/color): la app instalable es white-label de verdad. Shortcuts:
   "Entregas de hoy" → `/admin/entregas`, "Nueva reserva". Iconos 192/512
   (+maskable) generados del icono/imagen del tenant al vuelo con sharp y
   cacheados.
- **Service worker a mano** (`public/sw.js`, sin dependencias):
  - Allowlist estricta de rutas interceptadas: assets estáticos, `/uploads/*`
    (fotos cache-first: lo que ya viste funciona sin red), `/admin/entregas`
    y `/api/admin/agenda` (NetworkFirst con fallback a la última copia), y
    fallback `/admin/offline` para el resto del admin. Nunca se cachean
    POST ni endpoints sensibles fuera de la allowlist.
  - **Cola offline**: un handover capturado sin red se guarda en IndexedDB
    (payload + fotos como blobs); sincronización automática al volver
    `online` (y botón manual "N pendientes"). Conflicto (otro staff cerró
    ese tramo mientras tanto) → aviso y el registro se conserva como draft.
  - Versionado + limpieza de caches viejos en `activate`.
- **Agenda endpoint**: `GET /api/admin/agenda?date=` — lo mínimo para
  renderizar entregas/devoluciones del día (ya lo consume Fase 3).
- **Ajustes mobile del admin** (pass general): targets ≥44px, diálogos
  full-screen en angosto, `inputmode` correcto, barras sticky.

### Criterios de aceptación

1. Instalable en Android/iOS (A2HS) con nombre e icono del tenant.
2. En avión: abrir la app → agenda del día visible → capturar una entrega
   con fotos → al reconectar, todo sube solo.
3. El sitio público no cambia de comportamiento (SW no lo toca).

---

## Fase 6 — UI de temporadas y extras (`/admin/tarifas`)

Dos pestañas, mismo lenguaje que Ajustes. El motor ya consume ambas tablas;
esto es la UI que falta + un ajuste al motor.

- **Temporadas**: tabla (nombre, período, multiplicador, prioridad) + forma
  de captura; **franja anual SVG** (12 meses, bloques coloreados por
  temporada) para ver el año de un vistazo. Migración: `seasons.priority
  int NOT NULL DEFAULT 0` — mayor gana — y `computeQuote` ordena por
  prioridad antes del `find()` (hoy la primera coincidencia del SELECT
  sin ORDER es la que gana, que es un bug latente). Solapes entre
  temporadas → advertencia suave, no bloqueo.
- **Extras**: tabla editable (nombre, precio, por día/renta, activo) sobre
  el CRUD de `/api/admin/extras` (completar PATCH/DELETE si falta).
- Endpoints nuevos `/api/admin/seasons` + `[id]` con zod (período válido,
  multiplicador 0.5–3.0).
- El contexto de precios se carga por request (sin cache) → sin
  invalidaciones extra.

---

## Fase 7 — Quick wins

### 7.1 `sitemap.xml` + `robots.txt` (endpoints SSR)

- `sitemap.xml.ts`: URLs públicas (home, flota, `flota/[slug]` activos,
  reservar, ubicaciones, faq, contacto) en ES y EN con `hreflang` +
  `x-default` ES; `lastmod` de flota desde `updated_at` de vehículos.
- `robots.txt.ts`: `Allow /`, `Disallow /admin` y `/api`, `Sitemap:
  {origin}/sitemap.xml` — el origin se resuelve del request (aún sin
  dominio, funciona donde esté).

### 7.2 Reviews de Google Business en la home

- **Sin API key** (no hay dominio que verificar todavía): captura manual en
  Ajustes → sección "Reputación": `tenant.google = { placeUrl, rating,
  reviewCount }` (rating 0–5 con un decimal, conteo, link al place de
  Maps).
- Home: bloque de confianza junto a los CTAs — ★★★★☆ **4.8** · 127 reseñas
  de Google → link. Oculto si no está configurado (white-label friendly).
- JSON-LD del LocalBusiness recibe `aggregateRating` cuando hay datos.
- Upgrade futuro con dominio: Places API con caché de 24h para refrescar
  rating/conteo solos (queda anotado, no se implementa).

### 7.3 Export XLS para el contador

- `GET /api/admin/export/rentas?from&to&status=` → **exceljs** (mejores
  estilos/fórmulas que sheetjs CE; peso justificado en runtime admin).
- Workbook:
  - Hoja **Rentas**: una fila por renta — código, cliente, teléfono, canal,
    estado, tramos resumidos ("Versa 12–14 · SUV 14–17"), período total,
    subtotal, IVA, total, depósito.
  - Hoja **Desglose**: una fila por segmento — fechas, modelo, placa, días,
    tarifa/día, subtotal, extras, entrega, IVA, total.
  - Totales con fórmula `SUM`, freeze panes, autoFilter, moneda
    `$#,##0.00`, fechas dd/mm/yyyy en América/Mérida, encabezado con el
    nombre del tenant.
- Descarga como `rentas_{tenant}_{desde}_{hasta}.xlsx` (Content-Type
  correcto). Auditoría registra la exportación.

---

## Decisiones tomadas (vetables)

1. **Descuento por renta larga** sobre el total de días de la renta (no por
   tramo) — el trato largo se conserva al cambiar de vehículo.
2. **Ingresos por segmento** atribuidos a la fecha de inicio del tramo.
3. **Reviews manuales ahora**, Places API cuando exista dominio.
4. **PWA con SW a mano**, offline solo para el flujo del patio.
5. **exceljs** para XLS.
6. Fotos de handover por el mismo pipeline sharp que flota.
7. `booking_segments` con constraint GiST propia; la de `bookings` se retira.
