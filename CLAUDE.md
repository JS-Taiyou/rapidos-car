## Stack

- **Astro + React (islas)**, TypeScript estricto. Sin SPA.
- **Runtime: Node 22+ LTS** (engines `>=22.12.0`; desarrollo verificado en 22 y 26) — NO hay Deno en el proyecto (runtime ni Deno Deploy).
- **SSR/API:** adapter `@astrojs/node` (modo `standalone`); endpoints en `src/pages/api/`. Sin framework HTTP extra (Express/Fastify/Nest descartados, ver docs/ARCHITECTURE.md §2.14).
- **Datos:** PostgreSQL en **Supabase** via `postgres` (postgres.js), sin ORM; migraciones en `db/migrations/` con `npm run db:migrate` / `npm run db:seed` (Node + tsx).
- **Despliegue:** contenedor Docker (Fargate/Railway/Render/Fly.io) o adapters serverless de Netlify/Vercel — ver docs/ARCHITECTURE.md §8.

La fuente de verdad de la arquitectura es `docs/ARCHITECTURE.md`; si una guía y ese documento difieren, el documento manda.

## Development

When starting the dev server, use background mode:

```
astro dev --background
```

Manage the background server with `astro dev stop`, `astro dev status`, and `astro dev logs`.

## Documentation

Full documentation: https://docs.astro.build

Consult these guides before working on related tasks:

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)
- [Adding or managing content](https://docs.astro.build/en/guides/content-collections/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
- [Supporting multiple languages](https://docs.astro.build/en/guides/internationalization/)
