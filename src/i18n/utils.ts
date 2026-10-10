// ============================================================================
// I18N: utils — helpers de idioma y rutas (ARCHITECTURE §2.6)
// ============================================================================
// Propósito: resolver el idioma desde la URL, exponer t(key) con fallback, y
// traducir rutas ES↔EN para el switcher del Header y los hreflang del layout.
//
// ----------------------------------------------------------------------------
// DECISIONES
// ----------------------------------------------------------------------------
// * Fallback a ES cuando falta una clave: mejor mostrar el texto en español
//   que romper la página o pintar "undefined". ES es el idioma del negocio;
//   un texto en ES para un visitante EN es un defecto menor, no un error.
// * Mapa EXPLÍCITO de rutas ES↔EN, no regex ni convención "prefija /en":
//   las rutas públicas tienen NOMBRES DISTINTOS por idioma (/flota vs
//   /en/fleet), así que no hay regla mecánica que las derive. Son 7 pares:
//   un objeto literal es autodocumentado, se revisa en diff, y falla ruidoso
//   (si una ruta no está en el mapa, lo notas de inmediato) en vez de
//   silenciosamente mal.
// * Funciones PURAS, sin imports de Astro: las usan frontmatter .astro, el
//   layout (hreflang) e islas React (BookingFlow recibe lang y llama t()).
//   Misma regla que whatsapp.ts: cero runtime arrastrado.
//
// ----------------------------------------------------------------------------
// PASOS
// ----------------------------------------------------------------------------
// 1. Tipo base:
//      export type Lang = 'es' | 'en'
//    Todas las páginas, layouts e islas tipan su prop/parámetro con Lang;
//    nunca con string suelto.
//
// 2. getLangFromUrl:
//      export function getLangFromUrl(url: URL): Lang
//    Lógica: return url.pathname.startsWith('/en') ? 'en' : 'es'.
//    Cubre /en, /en/, /en/fleet…; todo lo demás es ES por defecto (ES no
//    lleva prefijo, ARCHITECTURE §1). Las rutas /admin y /api caerán en 'es'
//    y está bien: el admin es ES-only.
//
// 3. useTranslations (patrón de Astro docs, adaptado con fallback):
//      export function useTranslations(lang: Lang) {
//        return function t(key: string): string { ... }
//      }
//    Implementación del lookup por puntos: key.split('.') y recorre ui[lang]
//    bajando por cada segmento; si en cualquier nivel no existe la clave,
//    repite el recorrido sobre ui.es; si tampoco está, devuelve la propia
//    key (verla en pantalla delata el faltante en desarrollo sin romper).
//    Por qué devolver una FUNCIÓN y no el objeto: t('nav.home') es más
//    corto en templates y permite el fallback centralizado.
//    Importa { ui } desde './ui'.
//
// 4. Mapa de rutas (constante NO exportada, detalle interno):
//      const routes = {
//        '/': '/en/',
//        '/flota': '/en/fleet',
//        '/reservar': '/en/book',
//        '/ubicaciones': '/en/locations',
//        '/faq': '/en/faq',
//        '/contacto': '/en/contact',
//      }
//    MANTENIMIENTO: al agregar una página pública, agrega su par aquí en el
//    mismo commit. Las rutas dinámicas (/flota/[slug]) se traducen por
//    prefijo: /flota/X ↔ /en/fleet/X conserva el slug (mismo slug en ambos
//    idiomas — los slugs son datos de BD, no se traducen).
//
// 5. getAlternateUrl — para hreflang y el switcher de idioma del Header:
//      export function getAlternateUrl(pathname: string): string
//    (a) Si pathname empieza con '/en': busca el par inverso (en→es) —
//        compara contra los valores del mapa; /en/fleet → /flota.
//    (b) Si no: busca el par directo (es→en); /flota → /en/fleet.
//    (c) Rutas dinámicas: si pathname empieza con '/flota/', reemplaza el
//        prefijo por '/en/fleet/' (y viceversa) conservando el slug.
//    (d) Si no hay par (no debería pasar con páginas públicas), devuelve
//        pathname sin cambiar y deja un console.warn — falla ruidoso, no
//        silencioso.
//    El layout la usa para <link rel="alternate" hreflang>; el Header para
//    el link ES|EN preservando la página actual (mejor UX que mandar a home).
//
// 6. getLocalizedPath — para los LINKS del Header/Footer:
//      export function getLocalizedPath(path: string, lang: Lang): string
//    Recibe una ruta CANÓNICA ES ('/flota') y el idioma destino: si lang es
//    'es', devuelve path tal cual; si es 'en', traduce con el mapa. Así el
//    Header escribe sus links una sola vez ({getLocalizedPath('/flota', lang)})
//    en vez de if/else por idioma en cada enlace.
//
// ----------------------------------------------------------------------------
// CONTRATO
// ----------------------------------------------------------------------------
// Expone: Lang, getLangFromUrl, useTranslations, getAlternateUrl,
// getLocalizedPath. Consume: ui de './ui'. Callers: BaseLayout (hreflang,
// lang del <html>), Header/Footer (links y switcher), todas las páginas
// (t()), islas React (BookingFlow/QuoteWidget reciben lang y usan
// useTranslations — es portable porque estas funciones no tocan Astro).
//
// ----------------------------------------------------------------------------
// ERRORES COMUNES
// ----------------------------------------------------------------------------
// - Derivar la ruta EN con `'/en' + pathname` → produce /en/flota, que NO
//   existe (las rutas EN tienen nombres propios). Siempre por el mapa.
// - Agregar una página y no actualizar el mapa → hreflang roto y switcher
//   que lleva a 404. El console.warn del paso 5(d) existe para cachar esto.
// - Sin fallback a ES en t(): una clave faltante pinta undefined en
//   producción. Fallback siempre; la key como último recurso.
// - Traducir los slugs de /flota/[slug]: son datos de BD compartidos por
//   ambos idiomas; solo se traduce el prefijo de la ruta.
// ============================================================================
