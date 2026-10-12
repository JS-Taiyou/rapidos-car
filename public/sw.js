// sw.js — service worker del staff (ROADMAP Fase 5), escrito A MANO: cero
// dependencias, control total. Offline-first SOLO para el flujo del patio:
// la agenda del día y las fotos ya vistas funcionan sin red; el resto del
// sitio pasa directo a red (allowlist estricta — nunca se intercepta un POST
// ni un endpoint sensible fuera de la lista).
//
// La COLA de capturas offline (handovers sin red) vive en la app
// (src/lib/offline-queue.ts): el SW sólo garantiza el shell de lectura.

const VERSION = 'v1';
const SHELL_CACHE = `rapidos-shell-${VERSION}`;
const DATA_CACHE = `rapidos-data-${VERSION}`;
const ASSET_CACHE = `rapidos-assets-${VERSION}`;

// Páginas admin que deben abrirse sin red (shell del patio).
const SHELL_PAGES = ['/admin/entregas', '/admin/offline'];
// La agenda es EL dato offline: network-first con fallback a la última copia.
const AGENDA_PREFIX = '/api/admin/agenda';
// Fotos: cache-first — lo que ya viste está disponible offline.
const ASSET_PREFIXES = ['/uploads/fleet/', '/uploads/handover/', '/images/'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // addAll all-or-nothing con páginas SSR que requieren sesión: se
      // precachea sólo el fallback offline; el resto se llena al visitarse.
      await cache.add('/admin/offline').catch(() => undefined);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL_CACHE, DATA_CACHE, ASSET_CACHE]);
      for (const name of await caches.keys()) {
        if (!keep.has(name)) await caches.delete(name);
      }
      await self.clients.claim();
    })(),
  );
});

async function networkFirst(request, cacheName, fallbackUrl) {
  const cache = await caches.open(cacheName);
  try {
    const fresh = await fetch(request);
    if (fresh.ok) cache.put(request, fresh.clone());
    return fresh;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    if (fallbackUrl) {
      const shell = await caches.open(SHELL_CACHE);
      const fallback = await shell.match(fallbackUrl);
      if (fallback) return fallback;
    }
    return new Response('offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const fresh = await fetch(request);
  if (fresh.ok) cache.put(request, fresh.clone());
  return fresh;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return; // mutaciones: NUNCA se interceptan

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // mismo origen solamente

  // Datos del patio: agenda siempre fresca si hay red; sin red, la última.
  if (url.pathname === AGENDA_PREFIX || url.pathname.startsWith(`${AGENDA_PREFIX}?`)) {
    event.respondWith(networkFirst(request, DATA_CACHE));
    return;
  }
  // Shell del patio (HTML): network-first con fallback a la copia visitada y
  // de ahí a /admin/offline.
  if (url.pathname === '/admin/entregas' || url.pathname === '/admin' || url.pathname === '/admin/reservaciones') {
    event.respondWith(networkFirst(request, SHELL_CACHE, '/admin/offline'));
    return;
  }
  // Fotos de flota/evidencia: lo visto funciona offline.
  if (ASSET_PREFIXES.some((p) => url.pathname.startsWith(p))) {
    event.respondWith(cacheFirst(request, ASSET_CACHE));
    return;
  }
  // Assets del build (/_astro/*): cache-first (inmutables por hash).
  if (url.pathname.startsWith('/_astro/')) {
    event.respondWith(cacheFirst(request, ASSET_CACHE));
    return;
  }
  // TODO lo demás (sitio público, otras APIs, dev de Vite): red directa.
});

// Mensaje desde la app: "ya hay red, refresca la agenda por favor".
self.addEventListener('message', (event) => {
  if (event.data === 'refresh-agenda') {
    event.waitUntil(
      (async () => {
        const cache = await caches.open(DATA_CACHE);
        await cache.add(`${AGENDA_PREFIX}?date=${new Date().toISOString().slice(0, 10)}`).catch(() => undefined);
      })(),
    );
  }
});
