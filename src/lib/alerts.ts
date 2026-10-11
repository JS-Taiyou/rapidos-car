// Hub de alertas en vivo para el staff (SSE, sin polling).
//
// El proceso Node ya sabe exactamente cuándo entra una reservación (es él
// quien la inserta en /api/bookings): en vez de consultar por cambios, la
// empuja a todas las pestañas del panel conectadas a /api/admin/notifications
// (que exige cookie de staff). Válido porque el despliegue es UN proceso
// (§2.14); con N réplicas esto migraría a LISTEN/NOTIFY o Supabase Realtime.
//
// No usamos Supabase Realtime porque exige que la BD sea Supabase con su
// cliente JS; SSE funciona con cualquier Postgres (local incluido) y sin
// dependencias nuevas.

export interface NewBookingAlert {
  id: number;
  code: string;
  /** 'rental' = reservación confirmada · 'lead' = solicitud sin disponibilidad */
  kind: 'rental' | 'lead';
  modelName: string;
  customerName: string | null;
  start: string;
  end: string;
  totalCents: number;
}

export interface BookingStatusChange {
  id: number;
  code: string;
  from: string;
  to: string;
}

type Send = (event: string, data: unknown) => void;

const clients = new Set<Send>();

export function addAlertClient(send: Send): () => void {
  clients.add(send);
  return () => {
    clients.delete(send);
  };
}

function broadcast(event: string, data: unknown): void {
  for (const send of clients) {
    try {
      send(event, data);
    } catch {
      // stream roto: se limpia con el cancel() del endpoint
      clients.delete(send);
    }
  }
}

export function broadcastNewBooking(alert: NewBookingAlert): void {
  broadcast('new-booking', alert);
}

// Transición de estado (confirmó/canceló/completó alguien): alimenta el
// badge de "sin confirmar" de TODAS las pestañas del staff conectadas.
export function broadcastBookingStatus(change: BookingStatusChange): void {
  broadcast('booking-status', change);
}
