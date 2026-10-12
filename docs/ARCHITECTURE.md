# Rapidos Car — Arquitectura y diseño (sistema white label de renta de autos)

Documento maestro del proyecto. Aquí viven las decisiones de arquitectura y su
justificación; cada archivo del repo contiene una **guía paso a paso** (solo
comentarios) para que implementes el código tú mismo. Si una guía y este
documento difieren, este documento manda.

> Regla del proyecto: **los archivos guía no contienen código ejecutable**,
> solo comentarios con instrucciones numeradas, nombres exactos de
> funciones/variables y el *por qué* de cada decisión.

---

## 1. Mapa del sitio (MVP, spec §3, §4 y §8)

Público (bilingüe, ES por defecto sin prefijo, EN bajo `/en/`):

| Ruta ES           | Ruta EN              | Render    | Contenido |
|-------------------|----------------------|-----------|-----------|
| `/`               | `/en/`               | Estática  | Hero + widget de cotización (isla React), señales de confianza, preview de flota, reseñas |
| `/flota`          | `/en/fleet`          | SSR       | Catálogo de modelos con tarifa "desde" |
| `/flota/[slug]`   | `/en/fleet/[slug]`   | SSR       | Detalle de modelo: fotos, specs, tarifa, CTA a reservar |
| `/reservar`       | `/en/book`           | Estática + isla | Motor de reservación (wizard React) |
| `/ubicaciones`    | `/en/locations`      | Estática  | Aeropuerto MID, zonas de entrega a hotel |
| `/faq`            | `/en/faq`            | Estática  | Requisitos, depósitos, seguros (`<details>` sin JS) |
| `/contacto`       | `/en/contact`        | Estática  | WhatsApp, teléfono, mapa |

Admin (SSR, cookie de sesión, español solamente — es herramienta interna):

| Ruta                      | Contenido |
|---------------------------|-----------|
| `/admin/login`            | Formulario (isla React) |
| `/admin`                  | Dashboard: entregas/devoluciones de hoy, ocupación |
| `/admin/reservaciones`    | Pipeline de estados, vista lista/calendario, captura manual y bloqueos |
| `/admin/flota`            | CRUD de modelos/unidades, tarifas, fotos |

API (endpoints Astro en `src/pages/api/`, SSR sobre Node — §2.14):

| Endpoint                        | Métodos | Descripción |
|---------------------------------|---------|-------------|
| `/api/quote`                    | POST    | Disponibilidad + precio total para un rango de fechas |
| `/api/bookings`                 | POST    | Crea reservación (transacción + constraint de exclusión) |
| `/api/auth`                     | POST/DELETE | Login / logout de admin |
| `/api/admin/bookings`           | GET/POST | Listar con filtros; captura manual y bloqueos (`kind: 'block'`) |
| `/api/admin/bookings/[id]`      | PATCH   | Transiciones del pipeline de estados |
| `/api/admin/vehicles`           | GET/POST | CRUD de modelos y unidades |
| `/api/admin/vehicles/[id]`      | PATCH/DELETE | Edición/borrado lógico |

---

## 2. Decisiones de arquitectura (y por qué)

### 2.1 MPA con islas, no SPA
Astro genera HTML por página; React solo existe en 5 islas: `QuoteWidget`,
`BookingFlow`, `LoginForm`, `ReservationsBoard`, `FleetManager`.
**Por qué:** el spec exige LCP < 2s en 4G y SEO (schema.org, hreflang). Una SPA
metería JS de enrutado y estado global a páginas que son 95% contenido. Las
islas cargan JS solo donde hay interacción real.

### 2.2 Estático por defecto, SSR quirúrgico
Home, FAQ, ubicaciones y contacto son 100% estáticas (su contenido cambia
menos que el build). Flota, detalle de auto, admin y API llevan
`export const prerender = false`.
**Por qué:** las páginas de flota leen tarifas/unidades de la BD; el admin es
siempre fresco. El resto se sirve como HTML inmutable, gratis y rápido.
**Consecuencia de tooling:** al activar rutas SSR hay que instalar el adapter
`@astrojs/node` en modo `standalone` (§2.14) — ver §6. Sin adapter el
`astro build` falla; en `astro dev` las rutas SSR funcionan sin él, así que el
orden importa: instala el adapter *antes* de descomentar el primer
`prerender = false`.

### 2.3 Guardia de admin por página, sin middleware
No hay `src/middleware.ts`: cada página `/admin/*` llama en su frontmatter a
`requireAdmin(Astro)` (definido en `src/lib/auth.ts`), que redirige a
`/admin/login` si no hay sesión. Los endpoints `/api/admin/*` llaman a la misma
función y devuelven 401.
**Por qué:** son 4 páginas; una llamada explícita de una línea es más legible
que la magia de middleware para quien está aprendiendo el codebase. Si el
panel crece, migrar a middleware es trivial (mover la llamada).

### 2.4 Sin ORM: `postgres.js` + SQL a mano
Capa de datos en `src/lib/db.ts` con el paquete `postgres` (postgres.js);
migraciones SQL numeradas en `db/migrations/` aplicadas con un script Node
(§2.5).
**Por qué:** (a) el spec ya advierte que la constraint de exclusión
anti-doble-reservación requiere SQL crudo de todas formas; (b) la lógica
estrella del proyecto (solapes de rangos, precios por reglas) *es* SQL y es la
pieza de portafolio (spec §9) — conviene que se lea sin capas de abstracción;
(c) `postgres` es un paquete npm puro que corre nativo en Node 22 (app, API y
scripts usan el MISMO driver, un solo SQL y una sola forma de parametrizar en
todo el proyecto). Drizzle/Kysely son alternativas válidas si luego quieres
tipos generados.

### 2.5 Scripts de BD con Node + `tsx`, todo bajo npm
Un solo runtime: **Node 22** para dev server, API, SSR y scripts. Los scripts
de BD (`scripts/migrate.ts`, `scripts/seed.ts`) corren con
`npm run db:migrate` / `npm run db:seed` (scripts de `package.json` que
invocan `node --env-file=.env --import tsx scripts/…`).
**Por qué:** Deno quedó fuera del stack (§2.14); mantener un segundo runtime
solo para dos scripts era complejidad sin beneficio. `tsx` ejecuta TypeScript
directo en Node sin paso de build, y `--env-file=.env` (nativo desde Node
20.6) inyecta las mismas variables que la app — cero dependencias extra de
configuración.

### 2.6 i18n manual con árbol `/en/`, sin routing i18n de Astro
Cada página ES tiene su espejo EN como archivo separado; los textos viven en
`src/i18n/ui.ts` (diccionario por locale) y se resuelven con
`useTranslations(lang)` de `src/i18n/utils.ts`. El layout recibe `lang` y las
URLs alternas para `<link rel="alternate" hreflang>`.
**Por qué:** son 2 locales con contenido escrito a mano (spec §1: traducción
humana, no automática). Rutas explícitas = URLs limpias y controladas
(`/flota` vs `/en/fleet`), páginas estáticas sin complicación, y cero config.
El routing i18n de Astro brilla con ≥3 locales o contenido en colecciones.

### 2.7 shadcn/ui + Tailwind v4 para las islas
Tailwind v4 vía `@tailwindcss/vite` (un import en `src/styles/global.css`);
componentes shadcn/ui copiados en `src/components/ui/` (button, input, label,
select, calendar, popover, dialog, table, badge, card, sonner) + react-hook-form
con resolver zod para el paso de datos del cliente.
**Por qué:** shadcn no es una dependencia runtime — copia componentes
accesibles (Radix) a tu repo, estilizados con Tailwind: encaja con la filosofía
islas y da calidad de admin-panel sin diseñar desde cero. Los componentes
`.astro` públicos NO usan shadcn: son HTML + clases Tailwind (cero JS).
El FAQ usa `<details>/<summary>` nativo: acordeón accesible sin JavaScript.

### 2.8 Estado del wizard con `useReducer`, sin store global
`BookingFlow` modela el funnel (fechas → auto → extras → datos → pago →
confirmación) como máquina de estados con `useReducer` + `useContext` solo
hacia sus sub-pasos. `QuoteWidget` usa `useState` simples.
**Por qué:** un reducer puro con acciones (`SET_RANGE`, `SELECT_MODEL`,
`TOGGLE_EXTRA`, `QUOTE_LOADED`, `SUBMITTED`…) es testeable sin DOM, evita
efectos encadenados para "recalcular totales", y convierte las transiciones
válidas en datos — es la otra pieza de portafolio. No hace falta
Zustand/Redux: el estado vive dentro de una sola isla y la fuente de verdad
es el servidor (§2.9).

### 2.9 El servidor recalcula todo (nunca confiar en el cliente)
`/api/quote` es solo consulta; el precio y la disponibilidad reales se
recalculan dentro de la transacción de `POST /api/bookings`, y la constraint
de exclusión de Postgres es la última línea de defensa (409 si hay solape).
**Por qué:** precios calculados en el cliente son manipulables; además dos
usuarios pueden cotizar el mismo auto a la vez. La BD decide (spec §2).

### 2.10 Bloqueos de unidad como reservaciones `kind='block'`
Los periodos fuera de servicio (taller, mantenimiento) son filas en
`bookings` con `kind='block'` y sin cliente.
**Por qué:** la constraint de exclusión los cubre gratis (un bloqueo impide
solapes igual que una renta), el calendario del admin muestra un solo modelo,
y no hay que sincronizar dos tablas.

### 2.11 Sesiones en BD + PBKDF2 con Web Crypto
Login con cookie httpOnly cuyo valor es un token aleatorio; en la tabla
`sessions` se guarda el *hash* del token y su expiración. Passwords con PBKDF2
(vía Web Crypto API, presente en Node 22 como `globalThis.crypto`) en formato
`pbkdf2:iteraciones:sal:hash` hex.
**Por qué:** cero dependencias cripto, y las sesiones en BD son revocables
(logout real, expulsión). JWT stateless sería innecesario para un solo admin.

### 2.12 Zod en la frontera API
Esquemas zod en `src/lib/validation.ts` compartidos entre islas (react-hook-form)
y endpoints (`safeParse` antes de tocar la BD).
**Por qué:** un solo contrato por recurso; mensajes de error coherentes en
cliente y servidor; el schema sirve de documentación ejecutable.

### 2.13 Dinero en centavos, fechas en `timestamptz`
Todas las tarifas son enteros en centavos (`*_cents`); todos los rangos son
`tstzrange`. La zona horaria del negocio es `America/Merida` (CST fijo, sin
DST — spec §5.1).
**Por qué:** floats = errores de redondeo en precios; `timestamptz` +
`tstzrange` habilita la constraint de exclusión y los operadores de solape
(`&&`) que son el corazón del motor de disponibilidad.

### 2.14 Astro para todo: un solo servidor Node, sin framework extra
El runtime es **Node 22** (Deno quedó fuera del stack) y el servidor de
producción es el que genera el adapter **`@astrojs/node` en modo
`standalone`**: `npm run build` produce `dist/server/entry.mjs`, un servidor
Node autocontenido que sirve estáticos, páginas SSR y los endpoints
`/api/*` (archivos de `src/pages/api/`) en UN solo proceso.
**Por qué NO Fastify/Express/Nest:** se evaluó meter un framework HTTP
dedicado para la API y se descartó — son 7 endpoints y un admin: (a) Astro ya
da routing por archivos, cookies, zod en la frontera y API+SSR en el mismo
proceso con cero acoplamiento extra; (b) un framework paralelo duplica la
capa HTTP (dos sistemas de routing, dos manejos de cookies, el SSR montado
como middleware con escape hatches) y empeora el DX (en dev, `astro dev`
sirve sitio y API juntos con hot reload; con framework aparte tocaría
build+start para iterar); (c) el throughput extra es irrelevante al volumen
del negocio. La lógica de negocio vive en `src/lib/*` y es agnóstica del
framework: si la API algún día crece (app móvil, consumidores externos),
migrar a Fastify es reescribir los handlers delgados de `src/pages/api/`, no
la lógica — la puerta queda documentada y abierta.
**Consecuencia:** un solo proceso = el singleton de `src/lib/db.ts` es único
y compartido entre SSR y API, las islas llaman `/api/*` al mismo origen (cero
CORS), y el despliegue es UNA unidad (§8).

### 2.15 Supabase como host de PostgreSQL
La capa de datos es PostgreSQL hospedado en **Supabase**: `DATABASE_URL` apunta
al proyecto Supabase ( Settings → Database → Connection string ).
**Por qué:** Postgres administrado con el feature set completo que el diseño
necesita (`btree_gist`, `tstzrange`, `EXCLUDE`), free tier suficiente para el
MVP y consola SQL cómoda para operar.
**Reglas de conexión:** (a) el servidor Node de larga duración (§2.14) usa la
**conexión directa** (puerto 5432) con pool chico (`max: 5`, ver `src/lib/db.ts`);
(b) los scripts de migración/seed usan SIEMPRE la conexión directa — el pooler
en modo transacción no garantiza que BEGIN/COMMIT caigan en la misma sesión;
(c) si algún día se despliega serverless (§8), ahí sí: pooler de Supabase
(puerto 6543, modo transaction) para no agotar conexiones con cold starts.

---

## 3. Modelo de datos (detalle en `db/migrations/001_init.sql`)

Catálogo en dos niveles: **modelo** (lo que se muestra y cotiza) y **unidad**
(el coche físico que se asigna). La cotización es por modelo ("quedan 2
Versa"); la reservación toma una unidad concreta dentro de la transacción.

- `vehicle_models` — catálogo público: `slug`, `name`, `category`,
  `transmission`, `seats`, `luggage`, `daily_rate_cents`, `photos` (text[]),
  `active`.
- `vehicles` — unidades físicas: `model_id` FK, `plate`, `status`
  (`active|maintenance|retired`).
- `bookings` — `code` único legible (`RPZ-XXXXXX`), `kind` (`rental|block`),
  `vehicle_id` FK, `customer_*` (nombre, email, teléfono, vuelo), `period
  tstzrange`, `pickup_zone`, `extras jsonb` (snapshot de lo cotizado),
  `total_cents`, `deposit_type` (`deposit|on_pickup`), `status`
  (`quoted → confirmed → active → completed | cancelled`), flags de
  recordatorios (fase 2).
  **Constraint estrella:** `EXCLUDE USING gist (vehicle_id WITH =, period
  WITH &&) WHERE (status IN ('confirmed','active'))` — requiere `btree_gist`.
  Imposible persistir dos rentas solapadas de la misma unidad, sin importar
  bugs de aplicación o carreras entre requests.
- `seasons` — reglas de temporada: `name`, `period daterange`,
  `multiplier numeric` (1.30 = +30%).
- `extras` — catálogo de extras: `name`, `price_cents`,
  `per` (`day|rental`), `active`.
- `settings` — clave/valor: `turnaround_buffer_minutes`, zonas y tarifas de
  entrega (`delivery_zones` jsonb), `iva_rate`, plantillas WhatsApp.
- `admin_users` — un renglón: `email`, `password_hash`.
- `sessions` — `token_hash` único, `expires_at`.

**Por qué modelo+unidad y no solo "cantidad":** el buffer de rotación y los
bloqueos de taller son por coche físico (spec §3.3: "per-unit inventory");
con un contador no podrías expresar "el Kicks de placas X está en el taller
del 10 al 12".

---

## 4. Motor de disponibilidad y precios (API pública)

`POST /api/quote` → body `{ start, end, pickupZone }` (ISO 8601).
Respuesta: lista de modelos con `unitsAvailable`, desglose de precio por
modelo (`days[]`, `subtotal`, `extras`, `deliveryFee`, `taxes`, `totalCents`).

`POST /api/bookings` → body validado por zod: `{ modelSlug, start, end,
pickupZone, extras[], customer{name,email,phone,flightNumber?},
depositType }`. Flujo en transacción:

1. Recalcular precio en servidor (`pricing.ts`).
2. Elegir unidad libre: modelos activos cuya unidad no tenga `bookings`
   solapadas con el rango **expandido por el buffer de rotación**
   (`period && tstzrange(start - buffer, end + buffer)`), con
   `SELECT ... FOR UPDATE` para serializar la carrera.
3. Insertar `booking` (status `confirmed`, código `RPZ-…`). Si la constraint
   de exclusión lanza `23P01`, devolver 409 "ya no hay disponibilidad" — el
   wizard entonces recarga el paso de autos.
4. Responder con la reservación + URL de WhatsApp (`wa.me`) prellenada con el
   resumen (MVP de notificaciones, spec §5) y disparar correo/alerta a staff.

Detalles de precios (`src/lib/pricing.ts`): días = bloques de 24 h con
ceil; cada día aplica el multiplicador de la temporada que lo contenga
(suma por día, no multiplicador único — justo en rentas que cruzan
temporadas); descuento por renta larga (≥7 días −10%, ≥30 −20%, en
`settings`); extras por día o por renta; cargo por zona de entrega; IVA al
final sobre (subtotal + extras + entrega).

---

## 5. Convenciones de las guías

- Todo archivo guía es **100% comentarios**: `//` en `.ts/.tsx`,
  `<!-- -->` en la parte template de `.astro`, `//` en su frontmatter, `--`
  en `.sql`, `#` en `.env.example` y en archivos YAML/Dockerfile si aparecen.
- Formato de cada guía: **Propósito** → **Decisiones** (por qué así) →
  **Pasos** numerados con nombres exactos (imports, funciones, tipos) →
  **Contrato** (qué expone o consume) → **Errores comunes**.
- Identificadores en inglés, prosa y textos de UI en español (el negocio es
  mexicano; las rutas públicas ES son `/flota`, `/reservar`, etc.).
- Al implementar un archivo, borra los comentarios-guía conforme avanzas y
  descomenta las rutas/imports que mencione.
- **Rutas dinámicas con guion bajo:** los archivos guía de rutas dinámicas se
  llaman `_[id].ts` / `_[slug].astro`. El router de Astro ignora archivos y
  carpetas con prefijo `_`, así el build compila sin exports; al implementar
  uno, renómbralo quitando el `_` (cada uno lo indica en su encabezado).
- **Sin `src/middleware.ts`:** Astro exige que ese archivo exporte
  `onRequest`, así que no existe como guía. La guardia de admin vive en
  `requireAdmin`/`requireAdminApi` (`src/lib/auth.ts`), llamada explícita por
  página/endpoint (§2.3).

---

## 6. Puesta en marcha (cuando empieces a programar)

```bash
# 1. Tailwind v4 + adapter Node + utilidades
npm i -D @tailwindcss/vite tsx vitest
npm i @astrojs/node postgres zod react-hook-form @hookform/resolvers

# 2. astro.config.mjs: agregar adapter node({ mode: 'standalone' }),
#    vite.plugins: [tailwindcss()],
#    y site: 'https://<dominio-temporal>' (necesario para canonical/hreflang)

# 3. shadcn (genera src/components/ui y src/lib/utils.ts)
npx shadcn@latest init
npx shadcn@latest add button input label select calendar popover dialog table badge card sonner

# 4. Variables de entorno: copia .env.example a .env
#    DATABASE_URL = connection string DIRECTA de Supabase (puerto 5432)

# 5. Base de datos (Node + tsx; los scripts ya están en package.json)
npm run db:migrate   # aplica db/migrations/*.sql
npm run db:seed      # flota de ejemplo, extras, temporadas, admin

# 6. Desarrollo
npm run dev            # astro dev: sitio + SSR + API, todo en :4321
                       # (o: astro dev --background, ver AGENTS.md)
```

Orden sugerido de implementación (cada paso deja algo usable):

1. `db/migrations/001_init.sql` + `scripts/migrate.ts` + `scripts/seed.ts`
   → BD real con datos (en Supabase o Postgres local).
2. `src/lib/db.ts`, `availability.ts`, `pricing.ts`, `validation.ts` → el
   motor, probable con `vitest` o logs en `/api/quote`.
3. `BaseLayout` + `Header`/`Footer` + home ES → se ve el sitio.
4. `QuoteWidget` → `/reservar` → `BookingFlow` + `/api/quote` +
   `/api/bookings` → **el funnel completo** (corazón del MVP).
5. Páginas de flota SSR + `CarCard`.
6. Auth (`auth.ts`, `api/auth`, `LoginForm`) + admin (dashboard,
   `ReservationsBoard`, `FleetManager` + endpoints `/api/admin/*`).
7. Espejos EN, FAQ, ubicaciones, contacto, JSON-LD/hreflang.

## 7. Fuera de scope en esta iteración (fase 2 del spec)

Pagos (Mercado Pago/Stripe), recordatorios 24 h (`node-cron` dentro del
proceso Node del servidor + UPDATE…RETURNING, o un endpoint protegido
disparado por un scheduler externo como EventBridge), tracking de vuelos, CRM
completo, reportes, WhatsApp Business API, backups `pg_dump` → R2. El schema
ya deja los campos (`pickup_reminder_sent`, `return_reminder_sent`,
`flight_number`) para no migrar después.

---

## 8. Despliegue (Node, sin Deno Deploy)

El artefacto desplegable es **un proceso Node** (§2.14): `npm run build`
genera `dist/` (estáticos en `dist/client/`, servidor en
`dist/server/entry.mjs` gracias al modo `standalone` de `@astrojs/node`) y el
arranque es `node dist/server/entry.mjs` — estáticos, SSR y API en un solo
proceso.

**Opción recomendada — contenedor Docker en un host de procesos largos:**

- AWS Fargate (ECS), Railway, Render o Fly.io. Un `Dockerfile` basado en
  `node:22-slim`: `npm ci` → `npm run build` → `node dist/server/entry.mjs`.
  Variables: `DATABASE_URL` y las `PUBLIC_*` (ver `.env.example`); el adapter
  respeta `HOST`/`PORT` si la plataforma los inyecta.
- `DATABASE_URL` apunta a la conexión DIRECTA de Supabase (puerto 5432);
  el pool `max: 5` de `src/lib/db.ts` está dimensionado para esto.
- Migraciones: como paso de release (job one-shot del mismo contenedor:
  `npm run db:migrate`), nunca al arranque de cada réplica.

**Alternativa serverless — Netlify o Vercel:** ambos tienen adapter oficial
de Astro (`@astrojs/netlify` / `@astrojs/vercel`): las páginas estáticas van
a CDN y las rutas SSR + endpoints `/api/*` se convierten en funciones. Exige:
pooler de Supabase (puerto 6543, modo transaction) por los cold starts, y
sacar los recordatorios (fase 2) a un scheduler externo → endpoint protegido.
Camino viable sin tocar código de aplicación — solo cambia el adapter.

**No recomendadas:** AWS Lambda directo (el standalone de `@astrojs/node` es
un servidor HTTP de larga duración; meterlo en Lambda requiere wrappers
frágiles — si se quiere funciones, usar Vercel/Netlify que ya resolvieron
eso) y Cloudflare Workers (no es un runtime Node completo: postgres.js
necesita sockets TCP nativos y el ecosistema del adapter asume APIs que
Workers no tiene). Si algún día cambian estas condiciones, la decisión queda
documentada aquí para no re-debatirla desde cero.
