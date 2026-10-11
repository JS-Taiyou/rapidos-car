// Espejo estático de settings.delivery_zones (semilla). Las home y las
// páginas de reserva son ESTÁTICAS (spec §3.1 / ARCHITECTURE §2.2) y no
// pueden consultar la BD en build; QuoteWidget y BookingFlow reciben las
// zonas por props desde aquí. Si cambias las zonas en settings, actualiza
// este literal en el mismo commit (o activa SSR en las páginas).
export const DELIVERY_ZONES: Array<{ zone: string; feeCents: number }> = [
  { zone: 'airport_mid', feeCents: 0 },
  { zone: 'centro', feeCents: 15000 },
  { zone: 'norte', feeCents: 20000 },
  { zone: 'hotel_zone', feeCents: 25000 },
];
