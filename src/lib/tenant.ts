// Perfil del TENANT en runtime: identidad editable desde /admin/ajustes,
// almacenada en la tabla settings. Los valores de business.ts son los
// DEFAULTS (instalación fresca / campos nunca editados); lo que el admin
// captura vive en BD y manda. Cache en memoria con invalidación por
// versión (mismo patrón que fleet-cache): el render SSR lee memoria.
import { sql } from './db';
import { business, bookingCodePrefix } from './business';

export interface TenantLogo {
  type: 'icon' | 'image';
  /** Id de la galería src/lib/icons.ts (solo type=icon). */
  icon: string;
  /** Hex del preset de color (solo type=icon). */
  color: string;
  /** Ruta/URL de la imagen subida (solo type=image). */
  url?: string;
}

export interface Tenant {
  name: string;
  email: string | null;
  /** Teléfonos de contacto (puede haber varios). */
  phones: string[];
  addressDisplay: string | null;
  /** WhatsApp PÚBLICO (CTAs). Vacío/null ⇒ se ocultan los botones. */
  publicWhatsapp: string | null;
  /** WhatsApp que recibe confirmaciones de reservas. */
  staffWhatsapp: string;
  /** URL de Facebook Messenger (https://m.me/…). Vacío ⇒ botón oculto. */
  messengerUrl: string | null;
  logo: TenantLogo;
}

const TTL_MS = 15 * 60 * 1000;

let version = 0;
let snapshot: Tenant | null = null;
let snapshotVersion = -1;
let snapshotAt = 0;
let inflight: Promise<Tenant> | null = null;

export function invalidateTenantCache(): void {
  version++;
}

function defaults(): Tenant {
  return {
    name: business.name,
    email: business.email,
    phones: [business.phoneDisplay],
    addressDisplay: business.addressDisplay,
    publicWhatsapp: business.whatsapp,
    staffWhatsapp: '5219990000000',
    messengerUrl: null,
    logo: { type: 'icon', icon: 'bolt', color: '#0e7490' },
  };
}

export async function getTenant(): Promise<Tenant> {
  if (snapshot && snapshotVersion === version && Date.now() - snapshotAt < TTL_MS) {
    return snapshot;
  }
  if (!inflight) {
    inflight = (async () => {
      const rows = await sql`SELECT key, value FROM settings WHERE key LIKE 'tenant.%'`;
      const map = new Map(rows.map((r) => [r.key as string, r.value]));
      const d = defaults();
      const str = (k: string): string | null => {
        const v = map.get(`tenant.${k}`);
        return typeof v === 'string' ? v : null;
      };
      const tenant: Tenant = {
        name: str('name') ?? d.name,
        email: str('email') ?? d.email,
        phones: (map.get('tenant.phones') as string[] | undefined) ?? d.phones,
        addressDisplay: str('address') ?? d.addressDisplay,
        // Cadena vacía guardada = "ocultar explícitamente".
        publicWhatsapp: str('whatsapp') !== null ? str('whatsapp') || null : d.publicWhatsapp,
        staffWhatsapp: str('staff_whatsapp') ?? d.staffWhatsapp,
        messengerUrl: str('messenger') ?? d.messengerUrl,
        logo: (map.get('tenant.logo') as TenantLogo | undefined) ?? d.logo,
      };
      snapshot = tenant;
      snapshotVersion = version;
      snapshotAt = Date.now();
      return tenant;
    })();
  }
  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

export { bookingCodePrefix };
