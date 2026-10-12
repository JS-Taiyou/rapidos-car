// /manifest.webmanifest — la app instalable del staff es white-label: nombre
// e iconos salen del TENANT en runtime. Shortcuts al flujo del patio
// (ROADMAP Fase 5). El icono PNG lo genera /admin/app-icon/[size] con sharp
// desde el icono/imagen configurado en Ajustes.
import type { APIRoute } from 'astro';
import { getTenant } from '../lib/tenant';

export const prerender = false;

export const GET: APIRoute = async () => {
  const tenant = await getTenant();
  const manifest = {
    name: `${tenant.name} — Panel`,
    short_name: tenant.name,
    description: 'Panel interno: entregas, devoluciones y reservaciones.',
    start_url: '/admin/entregas',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#f8fafc',
    theme_color: tenant.logo.type === 'icon' ? tenant.logo.color : '#0e7490',
    icons: [
      { src: '/admin/app-icon/192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/admin/app-icon/512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/admin/app-icon/512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      {
        name: 'Entregas de hoy',
        short_name: 'Entregas',
        url: '/admin/entregas',
        description: 'Agenda de entregas y devoluciones del día',
      },
      {
        name: 'Nueva reserva',
        short_name: 'Reservar',
        url: '/admin/reservaciones',
      },
    ],
  };
  return new Response(JSON.stringify(manifest), {
    headers: { 'Content-Type': 'application/manifest+json; charset=utf-8' },
  });
};
