# ============================================================================
# Dockerfile — artefacto de despliegue (ARCHITECTURE §8)
# ----------------------------------------------------------------------------
# Un solo proceso Node sirve estáticos + SSR + API /api/* (§2.14). Build
# multi-stage: la etapa `deps`/install nunca llega a producción; la imagen
# final lleva solo dist/ + node_modules de producción.
#
# Uso:
#   docker build -t rapidos .
#   docker run -d --restart unless-stopped -p 4321:4321 \
#     --env-file .env rapidos
#
# La plataforma puede inyectar HOST/PORT (Railway/Render/Fly lo hacen; el
# adapter standalone los respeta). Las migraciones NUNCA corren al arranque
# de la réplica: son paso de release aparte (`npm run db:migrate`).
# ============================================================================

# --- Etapa 1: dependencias + build -----------------------------------------
FROM node:22-slim AS build
WORKDIR /app

# npm ci primero (capa cacheable: sólo se reinstala si el lock cambió)
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# db.ts valida DATABASE_URL al importarse, y Astro ejecuta el código de
# módulo de las páginas durante el build — sin esta variable dummy el build
# truena. postgres.js conecta LAZY: el string existe pero jamás se conecta.
ENV DATABASE_URL=postgres://build:build@localhost:5432/build
RUN npm run build

# Podar a dependencias de producción (sharp queda: redimensiona fotos en
# runtime — es dependencia, no devDependency, a propósito)
RUN npm prune --omit=dev

# --- Etapa 2: imagen de producción ------------------------------------------
FROM node:22-slim
WORKDIR /app

ENV NODE_ENV=production
# El standalone de @astrojs/node escucha HOST/PORT; 0.0.0.0 es obligatorio
# dentro del contenedor para que el puerto sea alcanzable desde fuera.
ENV HOST=0.0.0.0
ENV PORT=4321

# Usuario sin root: si la plataforma no impone uno propio.
USER node

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
# Scripts de BD para el paso de release (docker run … npm run db:migrate)
COPY --chown=node:node package.json db ./db/
COPY --chown=node:node scripts ./scripts/
# Directorio de subidas (se monta como volumen para sobrevivir reinicios)
RUN mkdir -p /app/uploads && chown node:node /app/uploads
VOLUME /app/uploads

EXPOSE 4321
CMD ["node", "dist/server/entry.mjs"]
