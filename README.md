# Rapidos Car 🚗

Sistema **white label** de renta de vehículos: sitio público bilingüe (ES/EN),
motor de cotización y reservas en tiempo real, panel administrativo con
alertas en vivo y CRM ligero de clientes. Construido para ser rentado por
cualquier negocio de renta de autos con solo cambiar su perfil de tenant.

## Características

- **Sitio público bilingüe** (Astro static-first, islas React solo donde hay
  interacción real): catálogo con filtros y carruseles, wizard de reservas
  de 6 pasos, FAQ, ubicaciones y contacto — todo con SEO (hreflang,
  JSON-LD, canonical).
- **Motor de disponibilidad por unidad** con buffer de rotación y
  *constraint de exclusión* en PostgreSQL (`btree_gist` + `tstzrange`):
  imposible persistir dos rentas solapadas de la misma unidad, sin importar
  carreras entre requests.
- **Motor de precios por reglas**: temporada por día, descuentos por renta
  larga, extras por día/renta, cargo por zona e IVA — todo en centavos
  enteros, con desglose y procedencia (`engine`/`manual`/`adjust`, motivo y
  autor) persistidos en jsonb.
- **Leads web**: cuando no hay disponibilidad, la solicitud se guarda como
  reservación `quoted` (sin apartar inventario) para follow-up del staff,
  con el pedido original congelado (`requested` jsonb) y diff visual.
- **Panel admin**: dashboard del día, pipeline de reservaciones
  (lista/calendario), captura manual con ajustes de precio, CRUD de flota
  con subida de fotos (sharp → WebP), reportes de negocio, CRM de clientes
  con unificación por CURP.
- **Alertas en vivo** (SSE, sin polling): beep + globitos + badge de leads
  sin atender en todas las pestañas del staff conectadas.

## Stack

Astro 7 (islas React) · Node 24 LTS (`@astrojs/node` standalone; compatible
desde 22.12, desarrollado y verificado en 24 y 26 — el contenedor usa
`node:24-slim`) · PostgreSQL
(postgres.js, sin ORM; migraciones SQL numeradas) · Tailwind v4 · shadcn/ui
· zod · sharp. Ver [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) para el
detalle y el por qué de cada decisión.

## Puesta en marcha

```bash
npm install
cp .env.example .env          # DATABASE_URL (Postgres local o Supabase)
npm run db:migrate            # aplica db/migrations/*.sql
npm run db:seed               # flota de ejemplo, extras, temporadas, admin
npm run db:seed:demo          # opcional: datos demo para explorar el panel
npm run dev                   # http://localhost:4321
```

Admin: `/admin/login` — `admin@rapidoz.local` / `cambia-esto-ahora`
(rota la contraseña en el primer uso).

### Base de datos: local o Supabase (sin fricción)

El acceso es SQL estándar sobre postgres.js — el mismo esquema corre igual
en un Postgres local o en Supabase (la única extensión usada es `btree_gist`,
disponible en Supabase). Para usar Supabase:

1. Crea un proyecto en [supabase.com](https://supabase.com) (free tier ok).
2. Copia la connection string **directa**: Settings → Database →
   Connection string → *Direct connection* (puerto 5432) y ponla en
   `DATABASE_URL` (con la contraseña real del proyecto).
3. `npm run db:migrate && npm run db:seed` — listo: el SSL se exige
   automáticamente para hosts de Supabase; un postgres local sigue plano.

Migraciones, seed y la app usan la misma URL directa mientras despliegues
UN contenedor. Si algún día escalas réplicas, cambia al pooler (puerto 6543,
añade `&pgbouncer=true` a la URL) sólo para el runtime; las migraciones
siempre van por la conexión directa.

### Modo embebido: Postgres en un archivo (tenant pequeño)

¿Una sola rentadora sin base de datos externa? El proyecto puede correr con
**PGlite** — un Postgres real embebido en el proceso, persistido en un
archivo (mismas migraciones, misma constraint anti-doble-reserva):

```bash
DATABASE_URL=pglite://./data/rapidoz   # en .env
npm run db:migrate && npm run db:seed
npm run dev
```

Backup = copiar el directorio `data/`. Limitaciones honestas: una consulta
a la vez (pool de 1), y NO sirve si corres varias réplicas del contenedor
— para eso, Postgres o Supabase. Es ideal para probar el proyecto de cero
en un minuto.

### Entrar con Google (staff, opcional)

Las cuentas se crean en `/admin/usuarios` con su rol (email + contraseña).
Si además quieres "Entrar con Google": crea un OAuth Client ID en
[Google Cloud Console](https://console.cloud.google.com/apis/credentials)
(tipo Web application) con redirect URI
`https://TU-DOMINIO/api/auth/google/callback` (y `http://localhost:4321/...`
para desarrollo), y define `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.
El botón aparece solo cuando ambas variables existen. La allowlist es
estricta: sólo entra una cuenta de Google cuyo email ya esté registrado y
activo en el panel — el login social no crea cuentas.

## Rebranding (white label)

Todo lo que identifica al negocio vive en **un solo archivo**:
[`src/lib/business.ts`](src/lib/business.ts) — nombre, teléfono, WhatsApp,
dirección, horario, mapa, prefijo del código de reservación y créditos del
autor. Edítalo, recompila y listo: footer, header, login, títulos, WhatsApp
y JSON-LD usan esa fuente. El seed de la BD y los textos del panel son
neutros al tenant.

## Despliegue

Un solo proceso Node (estáticos + SSR + API, incluido el SSE del staff) —
cualquier host de proceso persistente sirve; sólo los serverless
(Netlify/Vercel functions) quedan descartados por el SSE. `Dockerfile`
multi-stage listo; `deploy/` trae el docker-compose con Caddy (TLS
automático) para VPS.

### Checklist de producción

1. **Dominio** apuntando (A/AAAA) a la IP del servidor.
2. **BD**: Supabase (direct connection) o modo embebido `pglite://` — el
   compose migra (y siembra la primera vez) antes de arrancar.
3. **Variables**: `DATABASE_URL`, `PUBLIC_SITE_URL=https://TU-DOMINIO`,
   `PUBLIC_WHATSAPP_NUMBER`, y opcional `GOOGLE_CLIENT_ID/SECRET`.
4. **Volumen** `/app/uploads` (las fotos viven en disco, no en la BD).
5. **UptimeRobot** (gratis) apuntando a `/` y monitoreo del certificado.
6. **Backups**: Supabase tiene snapshots; en modo embebido, copia `data/`
   (cron + rsync a R2/S3 en el plan free de Cloudflare).

### Opciones de hosting (desde ~US$4/mes)

| Host | Precio aprox. | Por qué / por qué no |
|---|---|---|
| **Hetzner Cloud** (Ashburn) | €4–6/mes (CX22/CAX11) | La mejor relación hardware/precio; DC en Ashburn = buena latencia NA. A veces pide verificación extra a cuentas nuevas de LATAM. |
| **Railway** | ~US$5/mes | Cero ops: conecta el repo, detecta el Dockerfile, dominio y TLS incluidos. El más rápido para salir hoy. |
| **Render** | US$7/mes + disco | Blueprint desde el repo, disco persistente barato, ops mínimas. |
| **Fly.io** | ~US$4–6/mes | Deploy por CLI multi-región; requiere tarjeta. |
| **OVH VPS** | ~US$4/mes | Barato con DC en Canadá; panel más tosco. |
| **Oracle Cloud Free** | gratis (ARM 4 vCPU/24 GB) | Gratis de verdad, pero registro/experiencia irregular; para empezar sin gastar. |
| **AWS Lightsail/EC2** | US$5–7/mes | Si el objetivo del proyecto también es presumir AWS en el CV. |

Delante del host, **Cloudflare free** (DNS + CDN + TLS edge) reduce la
latencia percibida desde México y protege el origen.

### VPS sin Docker (bare-metal)

Node 24 standalone en `/usr/local` (el tarball se extrae ahí y queda en el
PATH de todos, systemd incluido), Caddy desde el paquete oficial, y el
proceso atendido por systemd:

```bash
git clone https://github.com/JS-Taiyou/rapidos-car.git /opt/rapidos-car
cd /opt/rapidos-car && cp .env.example .env && nano .env
npm ci && npm run build
cp deploy/rapidos.service /etc/systemd/system/
cp deploy/Caddyfile.host /etc/caddy/Caddyfile   # pon TU-DOMINIO
systemctl daemon-reload && systemctl enable --now rapidos
journalctl -u rapidos -f                        # logs (migra y arranca solo)
```

Actualizar una versión es `git pull && npm ci && npm run build && systemctl
restart rapidos`.

### VPS en un comando

```bash
curl -fsSL https://get.docker.com | sh
git clone TU-FORK && cd TU-FORK
cp .env.example .env && nano .env        # DATABASE_URL y demás
export DOMINIO=tu-dominio.com
docker compose -f deploy/docker-compose.yml up -d --build
```

Caddy gestiona el certificado y lo renueva; las alertas SSE y el PWA del
patio funcionan por ser un proceso persistente. Ver §8 de la arquitectura.

---

## Licencia

[Apache License 2.0](LICENSE) — usa, modifica y distribuye (tus cambios
pueden quedarse privados); incluye concesión de patentes y cláusula de
terminación por litigio de patentes.

Copyright 2026 Jorge Solís

---

Hecho con 💚 por [Jorge Solís](https://github.com/JS-Taiyou).
