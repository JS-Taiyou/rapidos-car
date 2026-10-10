// ============================================================================
// LIB: validation — esquemas zod compartidos cliente/servidor (ARCHITECTURE §2.12)
// ============================================================================
// Propósito: UN solo contrato por recurso. Los mismos schemas alimentan
// (a) react-hook-form en las islas vía zodResolver (errores en vivo) y
// (b) schema.safeParse(body) en los endpoints ANTES de tocar la BD. Mensajes
// coherentes en cliente y servidor; el schema es documentación ejecutable.
//
// ----------------------------------------------------------------------------
// DECISIONES
// ----------------------------------------------------------------------------
// * zod y no validación a mano: el resolver oficial @hookform/resolvers lo
//   enchufa a RHF sin código extra, y z.infer deriva los tipos TS de los
//   propios schemas — imposible que tipo y validador se desincronicen.
// * z.coerce.date() para fechas: JSON no tiene Date; lo que llega del cliente
//   es string ISO 8601. z.coerce.date() lo convierte y valida en un paso —
//   si usaras z.date() puro, todo body JSON fallaría siempre.
// * Mensajes de error en español (el admin y la mayoría de clientes son ES);
//   la isla EN mapea el código del issue si quiere variar el texto.
// * Este archivo es PURO (sin imports de Astro ni db): lo importan endpoints
//   (servidor) e islas (cliente); igual que whatsapp.ts, no debe arrastrar
//   runtime. Aquí NO se importa db.ts — nunca.
//
// ----------------------------------------------------------------------------
// PASOS
// ----------------------------------------------------------------------------
// 1. Importar:  import { z } from 'zod'   (npm i zod, ARCHITECTURE §6 paso 1).
//
// 2. customerSchema — datos del cliente (paso 4 de BookingFlow):
//      export const customerSchema = z.object({
//        name: z.string().min(2),
//        email: z.string().email(),
//        phone: z.string().min(8).regex(/^[\d\s+()-]+$/) — solo dígitos y
//               caracteres telefónicos; min 8 porque hay locales cortos.
//        flightNumber: z.string().regex(/^[A-Z]{2}\d{1,4}$/i).optional()
//               — IATA: 2 letras + 1-4 dígitos ('AM405'); opcional, fase 2
//               lo usa para tracking (spec §5.1).
//      })
//
// 3. quoteSchema — body de POST /api/quote:
//      export const quoteSchema = z.object({
//        start: z.coerce.date(),
//        end: z.coerce.date(),
//        pickupZone: z.string().min(1),
//      }).refine(d => d.end > d.start, { message: '...' })
//        .refine(d => d.start >= new Date(Date.now() + 3*60*60*1000), {...})
//    Segundo refine = lead time del negocio: no se renta con menos de 3 h de
//    anticipación (misma regla que RangeStep en BookingFlow; el servidor la
//    revalida porque nunca confía en el cliente, §2.9).
//
// 4. bookingInputSchema — body de POST /api/bookings:
//      export const bookingInputSchema = z.object({
//        modelSlug: z.string().min(1),
//        start: z.coerce.date(),
//        end: z.coerce.date(),
//        pickupZone: z.string().min(1),
//        extras: z.array(z.object({ id: z.number().int(), qty: z.number().int().min(1) })).default([]),
//        customer: customerSchema,
//        depositType: z.enum(['deposit', 'on_pickup']),
//      }) + los MISMOS dos .refine de quoteSchema (end > start, start ≥ ahora+3h).
//    Por qué extras con default([]): una renta sin extras no debe obligar al
//    cliente a mandar el arreglo vacío explícito.
//
// 5. loginSchema — body de POST /api/auth:
//      export const loginSchema = z.object({
//        email: z.string().email(),
//        password: z.string().min(8),
//      })
//
// 6. bookingPatchSchema — body de PATCH /api/admin/bookings/[id]:
//      export const bookingPatchSchema = z.object({
//        status: z.enum(['confirmed', 'active', 'completed', 'cancelled']),
//      })
//    Transiciones del pipeline (quoted→confirmed→active→completed|cancelled).
//    'quoted' NO se acepta por PATCH: es un estado efímero interno, no una
//    transición que el admin dispare a mano.
//
// 7. vehicleUpsertSchema — body de POST /api/admin/vehicles:
//      export const vehicleUpsertSchema = z.object({
//        slug: z.string().min(1).regex(/^[a-z0-9-]+$/) — va a la URL /flota/[slug].
//        name: z.string().min(2),
//        category: z.string().min(1),
//        transmission: z.enum(['automatic', 'manual']),
//        seats: z.number().int().min(1).max(15),
//        luggage: z.number().int().min(0),
//        dailyRateCents: z.number().int().min(0) — centavos enteros (§2.13).
//        photos: z.array(z.string()).default([]),
//        units: z.array(z.object({ plate: z.string().min(4) })).min(1)
//               — altas de modelo crean sus unidades físicas en la misma
//               llamada (catálogo en dos niveles, ARCHITECTURE §3).
//      })
//
// 8. manualBookingSchema — body de POST /api/admin/bookings (captura manual y
//    bloqueos de taller, §2.10):
//      export const manualBookingSchema = z.object({
//        vehicleId: z.number().int() — el admin elige la PLACA directa, no el
//                 modelo (diferencia clave vs bookingInputSchema: el cliente
//                 cotiza por modelo, el staff asigna por unidad).
//        start: z.coerce.date(),
//        end: z.coerce.date(),
//        pickupZone: z.string().min(1).default('office'),
//        kind: z.enum(['rental', 'block']),
//        customer: customerSchema.optional(),
//        notes: z.string().optional(),
//      }).refine(d => d.kind === 'block' || d.customer !== undefined)
//    El refine traduce el CHECK de la BD (001_init.sql paso 4: kind='block'
//    OR customer_name IS NOT NULL) a la frontera API: los bloqueos NO llevan
//    cliente; las rentas sí. Fallar aquí ahorra un 500 de Postgres.
//
// 9. Tipos inferidos — expórtalos para que islas y endpoints compartan forma:
//      export type QuoteInput = z.infer<typeof quoteSchema>
//      export type BookingInput = z.infer<typeof bookingInputSchema>
//      export type CustomerInput = z.infer<typeof customerSchema>
//      export type LoginInput = z.infer<typeof loginSchema>
//      export type BookingPatch = z.infer<typeof bookingPatchSchema>
//      export type VehicleUpsert = z.infer<typeof vehicleUpsertSchema>
//      export type ManualBookingInput = z.infer<typeof manualBookingSchema>
//    BookingFlow importa CustomerInput y QuoteResult (este último se define
//    en /api/quote como ModelAvailability + PriceBreakdown).
//
// ----------------------------------------------------------------------------
// CONTRATO
// ----------------------------------------------------------------------------
// Expone: los 7 schemas + tipos inferidos. Consume: zod solamente.
// Callers: endpoints /api/* (safeParse → 400 con el primer issue.message si
// falla) e islas React (useForm({ resolver: zodResolver(customerSchema) })).
//
// ----------------------------------------------------------------------------
// ERRORES COMUNES
// ----------------------------------------------------------------------------
// - z.date() en vez de z.coerce.date() → todo body JSON falla (JSON no tiene
//   Date). Coerce SIEMPRE en la frontera HTTP.
// - Duplicar los refines de fechas con lógica distinta en el wizard → una
//   sola regla de negocio, un solo lugar: aquí. El cliente solo anticipa UX.
// - Validar y luego no usar el resultado de safeParse (usar el body crudo)
//   → el parse devuelve datos NUEVOS ya coercionados (Dates reales); usa
//   result.data, nunca req.json() crudo después de validar.
// - meter status 'quoted' o transiciones inversas en bookingPatchSchema →
//   el pipeline tiene dirección; el enum es la lista cerrada deliberada.
// ============================================================================
