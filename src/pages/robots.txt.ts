// /robots.txt — generado en runtime para poder anunciar el sitemap con el
// origin REAL del request (aún no hay dominio fijo; funciona donde esté
// desplegado). El panel y las APIs no se indexan.
import type { APIRoute } from 'astro';

export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
  const siteUrl = import.meta.env.PUBLIC_SITE_URL ?? url.origin;
  const body = `User-agent: *
Allow: /
Disallow: /admin
Disallow: /api
Disallow: /uploads/handover

Sitemap: ${siteUrl}/sitemap.xml
`;
  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
