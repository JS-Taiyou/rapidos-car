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

Astro 7 (islas React) · Node 22+ LTS (`@astrojs/node` standalone; desarrollado
y verificado en 22 y 26 — el contenedor usa `node:22-slim`) · PostgreSQL
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

## Rebranding (white label)

Todo lo que identifica al negocio vive en **un solo archivo**:
[`src/lib/business.ts`](src/lib/business.ts) — nombre, teléfono, WhatsApp,
dirección, horario, mapa, prefijo del código de reservación y créditos del
autor. Edítalo, recompila y listo: footer, header, login, títulos, WhatsApp
y JSON-LD usan esa fuente. El seed de la BD y los textos del panel son
neutros al tenant.

## Despliegue

Un solo proceso Node (estáticos + SSR + API). `Dockerfile` multi-stage
listo para cualquier host de contenedores (Railway, Render, Fly.io) o VPS
(Hetzner & co.). Las migraciones corren como paso de release, nunca al
arrancar la réplica. Ver §8 de la arquitectura.

---

Hecho con 💚 por [Jorge Solís](https://github.com/JS-Taiyou).
