// /sitemap.xml — generado en runtime (SSR): el catálogo vive en BD y el
// host no se conoce hasta el request (sin dominio todavía). URLs públicas
// ES/EN con hreflang simétrico, igual que el canonical del BaseLayout.
import type { APIRoute } from 'astro';
import { sql } from '../lib/db';

export const prerender = false;

const STATIC_PATHS: Array<[es: string, en: string]> = [
  ['/', '/en'],
  ['/flota', '/en/fleet'],
  ['/reservar', '/en/book'],
  ['/ubicaciones', '/en/locations'],
  ['/faq', '/en/faq'],
  ['/contacto', '/en/contact'],
];

export const GET: APIRoute = async ({ url }) => {
  const siteUrl = import.meta.env.PUBLIC_SITE_URL ?? url.origin;
  const models = await sql`SELECT slug FROM vehicle_models WHERE active = true ORDER BY slug`;

  const entries: string[] = [];
  const entry = (esPath: string, enPath: string) => `  <url>
    <loc>${siteUrl}${esPath}</loc>
    <xhtml:link rel="alternate" hreflang="es" href="${siteUrl}${esPath}"/>
    <xhtml:link rel="alternate" hreflang="en" href="${siteUrl}${enPath}"/>
    <xhtml:link rel="alternate" hreflang="x-default" href="${siteUrl}${esPath}"/>
  </url>`;

  for (const [es, en] of STATIC_PATHS) entries.push(entry(es, en));
  for (const m of models) {
    const slug = m.slug as string;
    entries.push(entry(`/flota/${slug}`, `/en/fleet/${slug}`));
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${entries.join('\n')}
</urlset>`;

  return new Response(xml, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
};
