// Helpers de idioma y rutas (ARCHITECTURE §2.6). Funciones PURAS sin imports
// de Astro: las usan frontmatter .astro, el layout (hreflang), el Header
// (switcher) e islas React (reciben lang y llaman t()).
import { ui } from './ui';

export type Lang = 'es' | 'en';

// ES por defecto sin prefijo; /admin y /api caen en 'es' y está bien (el
// admin es ES-only).
export function getLangFromUrl(url: URL): Lang {
  return url.pathname.startsWith('/en') ? 'en' : 'es';
}

// t(key) con fallback a ES y, como último recurso, la propia key (delata el
// faltante en desarrollo sin romper la página).
export function useTranslations(lang: Lang) {
  return function t(key: string): string {
    const lookup = (dict: unknown): string | undefined => {
      let node: unknown = dict;
      for (const segment of key.split('.')) {
        if (node && typeof node === 'object' && segment in (node as Record<string, unknown>)) {
          node = (node as Record<string, unknown>)[segment];
        } else {
          return undefined;
        }
      }
      return typeof node === 'string' ? node : undefined;
    };
    return lookup(ui[lang]) ?? lookup(ui.es) ?? key;
  };
}

// Mapa EXPLÍCITO de rutas ES↔EN: las rutas públicas tienen NOMBRES distintos
// por idioma (/flota vs /en/fleet), no hay regla mecánica que las derive.
// MANTENIMIENTO: al agregar una página pública, agrega su par aquí.
const routes: Record<string, string> = {
  '/': '/en/',
  '/flota': '/en/fleet',
  '/reservar': '/en/book',
  '/ubicaciones': '/en/locations',
  '/faq': '/en/faq',
  '/contacto': '/en/contact',
};

// Para hreflang del layout y el switcher ES|EN del Header: preserva la
// página actual (incluidos /flota/[slug] ↔ /en/fleet/[slug], mismo slug —
// los slugs son datos de BD, no se traducen).
// Los paths llegan normalizados SIN slash final (el build estático genera
// '/faq/' por el formato directorio — normalizePath lo recorta antes de
// buscar en el mapa).
function normalizePath(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith('/')) return pathname.slice(0, -1);
  return pathname;
}

export function getAlternateUrl(pathname: string): string {
  const path = normalizePath(pathname);
  if (path.startsWith('/en')) {
    if (path.startsWith('/en/fleet/')) return `/flota/${path.slice('/en/fleet/'.length)}`;
    const pair = Object.entries(routes).find(([, en]) => normalizePath(en) === path);
    if (pair) return pair[0];
  } else {
    if (path.startsWith('/flota/')) return `/en/fleet/${path.slice('/flota/'.length)}`;
    if (path in routes) return routes[path];
  }
  console.warn(`getAlternateUrl: sin par para ${pathname}`);
  return pathname;
}

// Links del Header/Footer: recibe la ruta CANÓNICA ES y traduce si el
// idioma destino es EN.
export function getLocalizedPath(path: string, lang: Lang): string {
  if (lang === 'es') return path;
  if (path.startsWith('/flota/')) return `/en/fleet/${path.slice('/flota/'.length)}`;
  return routes[path] ?? path;
}
