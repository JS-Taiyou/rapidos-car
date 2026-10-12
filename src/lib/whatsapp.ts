// Deep links wa.me prellenados (MVP de notificaciones, spec §5). Funciones
// PURAS sin fetch ni imports de Astro/db: sirven idéntico en frontmatter
// .astro, endpoints y CTAs estáticos. WhatsApp Business API es fase 2; aquí
// nadie envía nada: el usuario abre el link y manda el mensaje.

export function buildWhatsAppUrl(message: string, number?: string): string {
  // El default es el número público del negocio (PUBLIC_ porque también lo
  // usan páginas estáticas). wa.me exige solo dígitos con código de país.
  const num = (number ?? import.meta.env.PUBLIC_WHATSAPP_NUMBER ?? '').replace(/\D/g, '');
  // encodeURIComponent es OBLIGATORIO: saltos de línea y acentos rompen la URL.
  return `https://wa.me/${num}?text=${encodeURIComponent(message)}`;
}

export interface WhatsAppBookingSummary {
  code: string;
  modelName: string;
  start: Date;
  end: Date;
  pickupZone: string;
  totalCents: number;
  depositCents: number;
}

// Plantillas de negocio bilingües escritas A MANO (spec §1), junto al builder
// para que un cambio de formato del código RPZ- no rompa dos archivos.
export function bookingConfirmationMessage(
  booking: WhatsAppBookingSummary,
  lang: 'es' | 'en',
  businessName = 'Rapidoz Rental',
): string {
  const dt = new Intl.DateTimeFormat(lang === 'es' ? 'es-MX' : 'en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'America/Merida',
  });
  // La división por 100 es el ÚNICO lugar donde centavos vuelven a pesos:
  // en la frontera de presentación, jamás en el cálculo (§2.13).
  const money = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });
  const total = money.format(booking.totalCents / 100);
  const deposit = money.format(booking.depositCents / 100);

  if (lang === 'en') {
    return [
      `Hi ${businessName}! This is my booking confirmation.`,
      `Booking code: ${booking.code}`,
      `Car: ${booking.modelName}`,
      `Pickup: ${dt.format(booking.start)} (${booking.pickupZone})`,
      `Return: ${dt.format(booking.end)}`,
      `Total: ${total}`,
      booking.depositCents > 0 ? `Deposit to confirm: ${deposit}` : 'Payment: at pickup',
    ].join('\n');
  }
  return [
    `¡Hola ${businessName}! Les comparto mi confirmación de reservación.`,
    `Código de reservación: ${booking.code}`,
    `Auto: ${booking.modelName}`,
    `Entrega: ${dt.format(booking.start)} (${booking.pickupZone})`,
    `Devolución: ${dt.format(booking.end)}`,
    `Total: ${total}`,
    booking.depositCents > 0 ? `Anticipo para confirmar: ${deposit}` : 'Pago: en mostrador',
  ].join('\n');
}
