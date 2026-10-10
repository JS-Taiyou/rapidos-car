// ============================================================================
// I18N: ui — diccionario bilingüe ES/EN (ARCHITECTURE §2.6)
// ============================================================================
// Propósito: TODOS los textos de UI del sitio, en ambos idiomas, en un solo
// objeto. Las páginas y componentes nunca hardcodean strings: llaman
// t('home.hero.title') con useTranslations(lang) de './utils'.
//
// ----------------------------------------------------------------------------
// DECISIONES
// ----------------------------------------------------------------------------
// * Un objeto TS con `as const`, no dos JSON sueltos: `as const` da
//   autocompletado literal de las claves y, sobre todo, ERROR DE COMPILACIÓN
//   si falta una llave en un idioma (TS compara la forma de ui.es contra
//   ui.en — ver paso 3). Un JSON suelto falla en runtime o nunca.
// * Objeto anidado por sección (nav.*, home.*, booking.*) con lookup por
//   puntos en utils.ts: plano "home.hero.title" como string-clave también
//   funcionaría, pero anidar te deja ver la cobertura por sección de un
//   vistazo y borrar secciones enteras sin grep.
// * Textos escritos A MANO en ambos idiomas (spec §1: traducción humana, no
//   automática). Este archivo es donde se nota: tono mexicano cálido en ES,
//   EN directo y simple, sin anglicismos raros ni Spanglish.
// * El contenido LARGO (párrafos de FAQ, políticas, descripciones de
//   ubicaciones) NO va aquí: vive en el template de cada página (el espejo
//   EN es otro archivo .astro). ui.ts es solo para etiquetas, títulos, CTAs
//   y mensajes cortos — lo que se repite entre componentes.
//
// ----------------------------------------------------------------------------
// PASOS
// ----------------------------------------------------------------------------
// 1. Declarar la forma con las llaves EXACTAS que se listan abajo. Cada clave
//    se describe aquí; tú escribes el texto final. Convención de redacción:
//    ≤60 chars en títulos H1/hero (SEO y wrap en mobile), verbos en
//    imperativo para CTAs ("Reserva ahora" / "Book now").
//
// 2. MAPA COMPLETO DE CLAVES (ambos idiomas, mismas llaves):
//
//    nav.* — navegación del Header (7 entradas, espejo de las rutas §1):
//      nav.home: 'Inicio' / 'Home'
//      nav.fleet / nav.locations / nav.faq / nav.contact: etiqueta corta de
//        cada sección; nav.book: el CTA destacado ('Reservar' / 'Book').
//
//    home.hero.title: promesa de valor con Mérida y beneficio concreto
//      (ej. "Tu auto en Mérida, sin sorpresas"), ≤60 chars.
//    home.hero.subtitle: seguro incluido + entrega en aeropuerto/hotel,
//      ≤120 chars.
//    home.trust.years: años en el negocio (número editable en el texto).
//    home.trust.fleet: flota reciente / bien mantenida.
//    home.trust.insurance: seguro de cobertura amplia incluido (diferenciador
//      clave vs. arrendadoras grandes, spec §3.1).
//    home.trust.whatsapp: atención 24/7 por WhatsApp.
//    home.fleetPreview.title / home.fleetPreview.cta: título de sección y
//      link "ver toda la flota".
//    home.reviews.title: título de reseñas (el contenido es estático en la
//      página; aquí solo el encabezado).
//
//    quote.* — el widget del hero y el paso 1 del wizard comparten etiquetas:
//      quote.pickupZone: label del select de zona de entrega.
//      quote.pickupDate / quote.returnDate: labels de los campos de fecha.
//      quote.submit: botón ('Cotizar' / 'Get a quote').
//
//    fleet.* — /flota y CarCard:
//      fleet.title: H1 de la página.
//      fleet.from: el "desde" de la tarifa ('Desde' / 'From').
//      fleet.perDay: '/día' / '/day' (sufijo del precio).
//      fleet.specs.seats / fleet.specs.luggage / fleet.specs.transmission:
//        labels de specs; transmission usa valores 'automático'/'estándar'
//        según el dato, el label aquí es solo el nombre del campo.
//      fleet.cta: botón de la card ('Ver detalles' / 'Details' → /flota/[slug]).
//
//    booking.steps.* — barra de progreso del wizard (6 pasos, mismos que
//      BookingFlow): range ('Fechas'), car ('Auto'), extras ('Extras'),
//      customer ('Tus datos'), payment ('Pago'), done ('Listo'). Cortas:
//      se ven en mobile.
//    booking.conflict: mensaje del 409 ('Ese auto acaba de reservarse, te
//      mostramos otras opciones' / equivalente EN). Lo usa el toast de
//      BookingFlow al recibir CONFLICT.
//    booking.error: error genérico de red/servidor con invitación a reintentar.
//    booking.whatsappCta: botón final ('Confirmar por WhatsApp').
//    booking.codeLabel: etiqueta del código RPZ-XXXXXX ('Tu código de
//      reservación' / 'Your booking code').
//
//    faq.title: H1. NOTA: las preguntas/respuestas NO van aquí — son
//      contenido largo de las páginas /faq y /en/faq (ver DECISIONES).
//
//    contact.title, contact.phone, contact.whatsapp, contact.hours: etiquetas
//      de la página de contacto (los valores reales — número, horario — son
//      datos del negocio y viven en la página, no en el diccionario).
//
//    footer.rights: '© 2025 Rapidoz Rental. Todos los derechos
//      reservados.' / EN equivalente (año: usa new Date().getFullYear() en
//      el componente, no lo hardcodees).
//    footer.madeIn: 'Hecho en Mérida, Yucatán' / 'Made in Mérida, Yucatán'.
//
// 3. Escribir el objeto:
//      export const ui = {
//        es: { nav: { home: 'Inicio', ... }, home: { hero: { ... }, ... }, ... },
//        en: { /* mismas llaves exactas */ },
//      } as const
//    Truco para que TS garantice paridad: declara primero `es`, luego anota
//    `en: typeof ui.es`... no — ui no existe aún; la forma práctica es
//    definir `const es = { ... } as const` y luego `const en: {...}` con el
//    tipo Record espejo, o simplemente dejar que TS compare al asignar
//    `en: typeof es`. Elige la variante que te dé error de compilación si
//    falta una clave; ese es el requisito, no la sintaxis exacta.
//
// ----------------------------------------------------------------------------
// CONTRATO
// ----------------------------------------------------------------------------
// Expone: `ui` (árbol ES/EN completo). Consume: nada. Lo usa
// useTranslations() de './utils', que es el único punto de acceso — los
// componentes no importan ui directamente (así el fallback a ES vive en un
// solo lugar).
//
// ----------------------------------------------------------------------------
// ERRORES COMUNES
// ----------------------------------------------------------------------------
// - Agregar una clave solo en es/ → en utils.ts el fallback la resuelve, pero
//   es deuda silenciosa; con `as const` + el tipado espejo, TS te grita.
// - Meter aquí párrafos de FAQ o políticas → el diccionario se vuelve
//   inmanejable; contenido largo va en las páginas.
// - Interpolación tipo template ('Hola {name}') sin convención → si algún
//   texto necesita datos, usa funciones en utils.ts, no claves con huecos.
// - Traducir los valores de enum (transmission) aquí: el label es de UI; el
//   VALOR ('automatic') viaja sin traducir entre API y BD.
// ============================================================================
