// Esquemas zod compartidos cliente/servidor (ARCHITECTURE §2.12): UN solo
// contrato por recurso; alimenta react-hook-form en las islas y safeParse en
// los endpoints. Archivo PURO: sin imports de Astro ni de db.
import { z } from 'zod';

// Genera códigos legibles 'RPZ-XXXXXX' con alfabeto sin ambiguos (sin
// 0/O/1/I/L): se dicta por teléfono. Vive aquí porque lo comparten
// /api/bookings y /api/admin/bookings; es crypto pura, cero dependencias.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function generateBookingCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  const chars = Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]);
  return `RPZ-${chars.join('')}`;
}

export const customerSchema = z.object({
  name: z.string().min(2, 'Escribe tu nombre completo'),
  email: z.string().email('Email no válido'),
  phone: z
    .string()
    .min(8, 'Teléfono demasiado corto')
    .regex(/^[\d\s+()-]+$/, 'Solo dígitos y caracteres telefónicos'),
  // IATA: 2 letras + 1-4 dígitos ('AM405'); opcional (fase 2: tracking).
  flightNumber: z
    .string()
    .regex(/^[A-Za-z]{2}\d{1,4}$/, 'Número de vuelo no válido (ej. AM405)')
    .optional(),
});

export const quoteSchema = z
  .object({
    start: z.coerce.date(),
    end: z.coerce.date(),
    pickupZone: z.string().min(1, 'Elige una zona de entrega'),
    // Opcional: el wizard puede preseleccionar extras al cotizar.
    extras: z
      .array(z.object({ id: z.number().int(), qty: z.number().int().min(1) }))
      .optional(),
  })
  .refine((d) => d.end > d.start, { message: 'La devolución debe ser posterior a la entrega' })
  .refine((d) => d.start.getTime() >= Date.now() + 3 * 60 * 60 * 1000, {
    message: 'Reserva con al menos 3 horas de anticipación',
  });

export const bookingInputSchema = z
  .object({
    modelSlug: z.string().min(1, 'Falta el auto'),
    start: z.coerce.date(),
    end: z.coerce.date(),
    pickupZone: z.string().min(1, 'Elige una zona de entrega'),
    // default([]): una renta sin extras no debe obligar a mandar el arreglo.
    extras: z.array(z.object({ id: z.number().int(), qty: z.number().int().min(1) })).default([]),
    customer: customerSchema,
    depositType: z.enum(['deposit', 'on_pickup']),
    lang: z.enum(['es', 'en']).default('es'),
  })
  .refine((d) => d.end > d.start, { message: 'La devolución debe ser posterior a la entrega' })
  .refine((d) => d.start.getTime() >= Date.now() + 3 * 60 * 60 * 1000, {
    message: 'Reserva con al menos 3 horas de anticipación',
  });

export const loginSchema = z.object({
  email: z.string().email('Email no válido'),
  password: z.string().min(8, 'Mínimo 8 caracteres'),
});

export const bookingPatchSchema = z.object({
  // 'quoted' NO se acepta: estado efímero interno, no transición de admin.
  status: z.enum(['confirmed', 'active', 'completed', 'cancelled']),
  notes: z.string().optional(),
});

export const vehicleUpsertSchema = z.object({
  // Va a la URL /flota/[slug].
  slug: z.string().min(1, 'Requerido').regex(/^[a-z0-9-]+$/, 'Solo minúsculas, dígitos y guiones'),
  name: z.string().min(2, 'Nombre demasiado corto'),
  category: z.string().min(1, 'Elige una categoría'),
  transmission: z.enum(['automatic', 'manual']),
  seats: z.number().int().min(1).max(15),
  luggage: z.number().int().min(0),
  // Centavos enteros (§2.13).
  dailyRateCents: z.number().int().min(0),
  photos: z.array(z.string()).default([]),
  active: z.boolean().optional(),
  // Alta de modelo crea sus unidades físicas en la misma llamada.
  units: z.array(z.object({ plate: z.string().min(4, 'Placa demasiado corta') })).min(1).optional(),
  // Operaciones de unidad del PATCH (los IDs vienen del FleetManager):
  addUnits: z.array(z.object({ plate: z.string().min(4, 'Placa demasiado corta') })).optional(),
  setUnitStatus: z
    .object({
      unitId: z.number().int(),
      status: z.enum(['active', 'maintenance', 'retired']),
    })
    .optional(),
});

// Captura manual y bloqueos de taller (§2.10). El admin asigna por UNIDAD
// (placa); el modelo solo entra como referencia de precio para kind='rental'.
export const manualBookingSchema = z
  .object({
    kind: z.enum(['rental', 'block']),
    vehicleId: z.number().int().optional(),
    modelSlug: z.string().optional(),
    start: z.coerce.date(),
    end: z.coerce.date(),
    pickupZone: z.string().min(1).default('office'),
    extras: z.array(z.object({ id: z.number().int(), qty: z.number().int().min(1) })).default([]),
    customer: customerSchema.optional(),
    depositType: z.enum(['deposit', 'on_pickup']).default('on_pickup'),
    totalCentsOverride: z.number().int().min(0).optional(),
    notes: z.string().optional(),
  })
  .refine((d) => d.end > d.start, { message: 'La devolución debe ser posterior a la entrega' })
  // Traduce a la frontera API el CHECK de la BD: los bloqueos NO llevan
  // cliente (y exigen unidad concreta); las rentas sí llevan cliente.
  .refine((d) => d.kind === 'block' || d.customer !== undefined, {
    message: 'Una renta necesita los datos del cliente',
  })
  .refine((d) => d.kind === 'rental' || d.vehicleId !== undefined, {
    message: 'Un bloqueo es de una placa concreta',
  })
  .refine((d) => d.kind === 'block' || d.modelSlug !== undefined, {
    message: 'Falta el modelo para calcular el precio',
  });

export type QuoteInput = z.infer<typeof quoteSchema>;
export type BookingInput = z.infer<typeof bookingInputSchema>;
export type CustomerInput = z.infer<typeof customerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type BookingPatch = z.infer<typeof bookingPatchSchema>;
export type VehicleUpsert = z.infer<typeof vehicleUpsertSchema>;
export type ManualBookingInput = z.infer<typeof manualBookingSchema>;
