// ============================================================================
// LIB: whatsapp — deep links wa.me (MVP de notificaciones, spec §5)
// ============================================================================
// Propósito: armar URLs https://wa.me/... prellenadas con el resumen de la
// reservación. El deep link abre WhatsApp en el dispositivo del usuario con
// el mensaje listo para enviar — ES la notificación del MVP (el botón
// "Confirmar por WhatsApp" del paso 6 de BookingFlow). WhatsApp Business API
// (mensajes enviados por el servidor) es fase 2; aquí nadie envía nada.
//
// ----------------------------------------------------------------------------
// DECISIONES
// ----------------------------------------------------------------------------
// * Funciones PURAS, sin fetch ni imports de Astro ni de db: por eso sirven
//   idéntico en frontmatter .astro (SSR, ej. el CTA de la home), en endpoints
//   (/api/bookings arma la URL de confirmación) y hasta en islas si hiciera
//   falta. Un helper de strings no debe arrastrar runtime.
// * wa.me y no api.whatsapp.com: wa.me redirige a la app instalada o a
//   WhatsApp Web según el dispositivo; es el formato oficial documentado y
//   no requiere token ni número registrado en Business.
// * Mensajes bilingües escritos A MANO aquí (param lang), no en ui.ts:
//   son plantillas de negocio con datos interpolados, no textos de UI;
//   mantenerlos junto al builder evita que un cambio de formato del código
//   RPZ- rompa dos archivos.
// * Fechas SIEMPRE formateadas con timeZone 'America/Merida' (ARCHITECTURE
//   §2.13: CST fijo sin DST). El cliente que reserva desde otro huso debe
//   leer la hora local de Mérida, no la suya.
//
// ----------------------------------------------------------------------------
// PASOS
// ----------------------------------------------------------------------------
// 1. buildWhatsAppUrl:
//      export function buildWhatsAppUrl(message: string, number?: string): string
//    Pasos: (a) const num = number ?? import.meta.env.PUBLIC_WHATSAPP_NUMBER
//    — el default es el número del negocio; es PUBLIC_ porque también lo
//    muestran páginas estáticas (contacto, footer). (b) Sanitiza num: quita
//    todo lo que no sea dígito (replace(/\D/g, '')) — wa.me exige solo
//    dígitos con código de país, sin '+' ni espacios (semilla: 5219990000000
//    con el '1' de celular mexicano). (c) return `https://wa.me/${num}?text=
//    ${encodeURIComponent(message)}`. encodeURIComponent es OBLIGATORIO:
//    sin él, los saltos de línea y acentos del mensaje rompen la URL.
//
// 2. bookingConfirmationMessage:
//      export function bookingConfirmationMessage(
//        booking: { code: string; modelName: string; start: Date; end: Date;
//                   pickupZone: string; totalCents: number; depositCents: number },
//        lang: 'es' | 'en'
//      ): string
//    Plantilla multi-línea (template literal) que incluya: saludo, código
//    RPZ-XXXXXX en su propia línea (es lo que el cliente dicta por teléfono),
//    modelo, fechas de entrega/devolución formateadas, zona de entrega,
//    total y anticipo en MXN. Versión ES y versión EN en un if/else o
//    objeto { es: ..., en: ... } — dos plantillas explícitas, no traducción
//    automática (spec §1).
//
// 3. Formato de fechas dentro de la plantilla: new Intl.DateTimeFormat(
//    lang === 'es' ? 'es-MX' : 'en-US', { dateStyle: 'medium',
//    timeStyle: 'short', timeZone: 'America/Merida' }).format(booking.start).
//    Por qué Intl y no date-fns/moment: cero dependencias de fecha
//    (convención de todo el proyecto, ver BookingFlow guía errores comunes).
//
// 4. Formato de dinero: new Intl.NumberFormat('es-MX', { style: 'currency',
//    currency: 'MXN' }).format(totalCents / 100). La división por 100 es el
//    ÚNICO lugar donde centavos vuelven a pesos: en la frontera de
//    presentación, jamás en el cálculo (ARCHITECTURE §2.13).
//
// ----------------------------------------------------------------------------
// CONTRATO
// ----------------------------------------------------------------------------
// Expone: buildWhatsAppUrl(message, number?) y bookingConfirmationMessage(
// booking, lang). Consume: import.meta.env.PUBLIC_WHATSAPP_NUMBER.
// Callers: /api/bookings (responde whatsappUrl ya armada — ver BookingFlow,
// paso 6), CTAs estáticos de home/contacto/ubicaciones (frontmatter Astro).
//
// ----------------------------------------------------------------------------
// ERRORES COMUNES
// ----------------------------------------------------------------------------
// - Olvidar encodeURIComponent → mensajes con acentos/saltos rompen el link.
// - Dejar el '+' o espacios en el número → wa.me devuelve error; solo dígitos.
// - new Date().toLocaleString() sin timeZone → el servidor puede estar en
//   UTC y mostrar horas corridas; siempre 'America/Merida' explícito.
// - Intentar "enviar" el WhatsApp desde el servidor → eso es Business API
//   (fase 2, spec §7); el MVP solo construye el link y el USUARIO envía.
// ============================================================================
