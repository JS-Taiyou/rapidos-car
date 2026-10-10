// ============================================================================
// LIB: availability — motor de disponibilidad por unidad (spec §3.3)
// ============================================================================
// Propósito: dado un rango [start, end) y una zona, decir qué MODELOS tienen
// unidades libres y cuántas. Es la mitad del "technical showcase" (spec §9);
// la otra mitad es pricing.ts. SQL explícito, sin ORM (ARCHITECTURE §2.4).
//
// ----------------------------------------------------------------------------
// DECISIONES
// ----------------------------------------------------------------------------
// * La disponibilidad se consulta por MODELO pero se decide por UNIDAD: el
//   cliente ve "quedan 2 Versa"; la reservación amarra una placa concreta en
//   la transacción (eso vive en /api/bookings, no aquí).
// * El buffer de rotación (turnaround_buffer_minutes de settings) se aplica
//   EXPANDIENDO el rango consultado, no restando disponibilidad después: si
//   pides 12:00→12:00 y el buffer es 2 h, la unidad debe estar libre de
//   10:00 a 14:00. Así el solape lo calcula Postgres con `&&`, no tu código.
// * Una sola query para "unidades libres por modelo": N+1 queries es la
//   trampa clásica aquí (spec §2: cada query cuenta en el free tier).
// * Esta función es CONSULTA (para /api/quote); la GARANTÍA es la constraint
//   de exclusión en la BD. No confundir "parece libre" con "está apartado":
//   entre ambos hay una carrera que solo Postgres resuelve (ARCHITECTURE §2.9).
//
// ----------------------------------------------------------------------------
// PASOS
// ----------------------------------------------------------------------------
// 1. Importar el cliente `sql` desde './db' (el singleton postgres.js) y el
//    tipo de retorno desde './validation' (o decláralo aquí y expórtalo):
//      interface ModelAvailability {
//        slug: string; name: string; category: string
//        transmission: string; seats: number; luggage: number
//        dailyRateCents: number; photos: string[]
//        unitsAvailable: number
//      }
//
// 2. Declarar `getTurnaroundBufferMinutes(sql)`: SELECT value FROM settings
//    WHERE key='turnaround_buffer_minutes', parseInt del jsonb.
//    Por qué leerla en cada llamada y no cachear en módulo: el admin puede
//    cambiarla (fase 2) y un proceso serverless puede vivir minutos; una
//    query extra de una tabla de 5 renglones es despreciable vs. servir
//    disponibilidad con un buffer viejo.
//
// 3. Declarar la función exportada:
//      export async function findAvailableModels(start: Date, end: Date):
//        Promise<ModelAvailability[]>
//    Query (escríbela con sql`...` de postgres.js; los parámetros se pasan
//    como ${start}, ${end}, ${bufferMinutes} y se escapan solos):
//      SELECT m.slug, m.name, m.category, m.transmission, m.seats,
//             m.luggage, m.daily_rate_cents, m.photos,
//             COUNT(v.id) AS units_available
//      FROM vehicle_models m
//      JOIN vehicles v
//        ON v.model_id = m.id AND v.status = 'active'
//      WHERE m.active = true
//        AND NOT EXISTS (
//          SELECT 1 FROM bookings b
//          WHERE b.vehicle_id = v.id
//            AND b.status IN ('confirmed','active')
//            AND b.period && tstzrange(
--                  ${start}::timestamptz - (${bufferMinutes} || ' minutes')::interval,
--                  ${end}::timestamptz   + (${bufferMinutes} || ' minutes')::interval,
--                  '[)')
//        )
//      GROUP BY m.id
//      ORDER BY m.daily_rate_cents ASC
//    Lectura de la query (para que la entiendas antes de escribirla):
//    "modelos activos con al menos una unidad activa para la que NO EXISTE
//    una renta/bloqueo vigente que solape el rango pedido, expandido por el
//    buffer en ambos extremos". El operador && es solape de rangos; el
--    '[)' significa intervalo cerrado-abierto: devolver a las 12:00 y
//    entregar a las 12:00 del mismo instante NO choca — decisión deliberada,
//    de lo contrario rentas back-to-back serían imposibles y el buffer ya
//    cubre la limpieza.
//    Nota: el buffer expande AMBOS lados. Si el negocio quiere buffer solo
//    post-devolución, quita la expansión del inicio y documéntalo aquí.
//
// 4. Filtrar `units_available > 0` ya viene gratis del NOT EXISTS+COUNT, pero
//    castea el COUNT a number en JS (postgres.js devuelve bigint como string
//    en algunos drivers — verifica con un log la primera vez).
//
// 5. Función auxiliar exportada para /api/bookings:
//      export async function pickFreeUnit(sql, modelSlug, start, end,
//        bufferMinutes): Promise<number | null>
//    Misma lógica de NOT EXISTS pero `SELECT v.id ... LIMIT 1 FOR UPDATE` —
//    se llama DENTRO de la transacción de creación; el FOR UPDATE bloquea la
//    fila de la unidad para que dos requests no agarren la misma placa a la
//    vez (segunda línea de defensa; la constraint EXCLUDE es la última).
//    Por qué recibe `sql` como parámetro: dentro de una transacción debes
//    usar el sql transaccional que te pasa postgres.js, no el singleton.
//
// ----------------------------------------------------------------------------
// CONTRATO
// ----------------------------------------------------------------------------
// Consume: db.ts (singleton sql), settings.turnaround_buffer_minutes.
// Expone: findAvailableModels(start, end), pickFreeUnit(sqlTx, slug, start,
// end, buffer) y el tipo ModelAvailability. Lo usan /api/quote y
// /api/bookings. Nada de React aquí: este archivo corre solo en servidor.
//
// ERRORES COMUNES
// - Comparar start/end como strings: castea a timestamptz en SQL y manda
//   Date nativo desde JS; nunca concatenes fechas en el texto SQL.
// - Usar la constraint como plan A de disponibilidad en la cotización: para
//   LISTAR necesitas la query de arriba; la constraint solo protege el
//   INSERT final.
// - Olvidar v.status='active': una unidad en taller (sin bloqueo cargado)
//   seguiría "disponible".
// ============================================================================
