// CRM ligero de clientes (spec §4.4): find-or-link de reservas por CURP
// (fuerte) > email > teléfono (débiles), historial de contacto en jsonb y
// unificación por CURP. Sin cuentas: el cliente jamás se registra; la
// identidad la construyen sus reservas y el CURP que el staff captura al
// firmar con identificación oficial.
import type { Sql } from './db';

export type ContactEvent = {
  kind: 'email' | 'phone';
  value: string;
  retiredAt: string;
}

export interface CustomerRow {
  id: number;
  curp: string | null;
  full_name: string;
  email: string | null;
  phone: string | null;
  contact_history: ContactEvent[];
  notes: string | null;
  no_show: boolean;
}

// Dato de contacto entrante: si difiere del vigente, el vigente se RETIRA
// al historial (visible para siempre en el expediente) y el nuevo toma su
// lugar. Nunca se descarta información previa.
async function applyContact(
  sql: Sql,
  customerId: number,
  kind: 'email' | 'phone',
  incoming: string | null,
): Promise<void> {
  if (!incoming) return;
  // El nombre de columna NO se puede parametrizar (${kind} devolvería el
  // literal 'email'/'phone' como valor): rama explícita — kind sólo es
  // 'email'|'phone' desde nuestro propio código.
  const rows =
    kind === 'email'
      ? await sql`SELECT email AS current, contact_history FROM customers WHERE id = ${customerId}`
      : await sql`SELECT phone AS current, contact_history FROM customers WHERE id = ${customerId}`;
  const row = rows[0];
  if (!row || row.current === incoming) return;

  const history = (row.contact_history ?? []) as ContactEvent[];
  if (row.current && !history.some((h) => h.kind === kind && h.value === row.current)) {
    history.push({ kind, value: row.current, retiredAt: new Date().toISOString() });
  }
  await sql`
    UPDATE customers
    SET ${sql({ [kind]: incoming })}, contact_history = ${sql.json(history)}::jsonb, updated_at = now()
    WHERE id = ${customerId}
  `;
}

export interface LinkResult {
  customer: CustomerRow;
  matchedBy: 'curp' | 'email' | 'phone' | 'new';
  /** Match por CURP: el nombre registrado MANDA sobre el entrante. */
  preferRegisteredName: boolean;
}

// Resuelve el cliente de una reserva entrante. Orden de confianza:
// CURP exacto (nombre registrado gana) > email > teléfono > alta nueva.
export async function findOrCreateCustomer(
  sql: Sql,
  data: { curp?: string | null; name: string; email?: string | null; phone?: string | null },
): Promise<LinkResult> {
  const byCurp = data.curp
    ? await sql`SELECT * FROM customers WHERE curp = ${data.curp} LIMIT 1`
    : [];
  if (byCurp.length > 0) {
    const c = byCurp[0];
    await applyContact(sql, Number(c.id), 'email', data.email ?? null);
    await applyContact(sql, Number(c.id), 'phone', data.phone ?? null);
    return { customer: c as unknown as CustomerRow, matchedBy: 'curp', preferRegisteredName: true };
  }

  const byEmail = data.email
    ? await sql`SELECT * FROM customers WHERE email = ${data.email} LIMIT 1`
    : [];
  if (byEmail.length > 0) {
    const c = byEmail[0];
    await applyContact(sql, Number(c.id), 'email', data.email ?? null);
    await applyContact(sql, Number(c.id), 'phone', data.phone ?? null);
    return { customer: c as unknown as CustomerRow, matchedBy: 'email', preferRegisteredName: false };
  }

  const byPhone = data.phone
    ? await sql`SELECT * FROM customers WHERE phone = ${data.phone} LIMIT 1`
    : [];
  if (byPhone.length > 0) {
    const c = byPhone[0];
    await applyContact(sql, Number(c.id), 'email', data.email ?? null);
    await applyContact(sql, Number(c.id), 'phone', data.phone ?? null);
    return { customer: c as unknown as CustomerRow, matchedBy: 'phone', preferRegisteredName: false };
  }

  const created = await sql`
    INSERT INTO customers (curp, full_name, email, phone)
    VALUES (${data.curp ?? null}, ${data.name}, ${data.email ?? null}, ${data.phone ?? null})
    RETURNING *
  `;
  return { customer: created[0] as unknown as CustomerRow, matchedBy: 'new', preferRegisteredName: false };
}

// Vincula una reserva a su cliente (y, con match por CURP, homologa el
// nombre de la reserva al del expediente registrado).
export async function linkBookingToCustomer(
  sql: Sql,
  bookingId: number,
  data: { curp?: string | null; name: string; email?: string | null; phone?: string | null },
): Promise<LinkResult> {
  const result = await findOrCreateCustomer(sql, data);
  await sql`
    UPDATE bookings
    SET customer_id = ${result.customer.id},
        customer_name = COALESCE(
          ${result.preferRegisteredName ? result.customer.full_name : null},
          customer_name
        )
    WHERE id = ${bookingId}
  `;
  return result;
}

// Unificación: el CURP capturado en `sourceId` ya existía en `targetId`.
// Mueve las reservas, fusiona historiales de contacto y gana el NOMBRE y
// datos del expediente que YA TENÍA el CURP (decisión del dueño). Las notas
// de la fuente se anexan para no perder contexto.
export async function mergeCustomers(sql: Sql, sourceId: number, targetId: number): Promise<CustomerRow> {
  // OJO: bigserial llega como string desde postgres.js — comparar con Number().
  const rows = (await sql`SELECT * FROM customers WHERE id IN (${sourceId}, ${targetId})`) as Array<{
    id: number | string;
    email: string | null;
    phone: string | null;
    notes: string | null;
    contact_history: ContactEvent[] | null;
  }>;
  const source = rows.find((r) => Number(r.id) === sourceId);
  const target = rows.find((r) => Number(r.id) === targetId);
  if (!source || !target) throw new Error('expediente no encontrado para unificar');

  const history = (target.contact_history ?? []) as ContactEvent[];
  for (const [kind, value] of [
    ['email', source.email],
    ['phone', source.phone],
  ] as Array<['email' | 'phone', string | null]>) {
    if (value && value !== target[kind] && !history.some((h) => h.kind === kind && h.value === value)) {
      history.push({ kind, value, retiredAt: new Date().toISOString() });
    }
  }

  // Sin transacción formal (el tipo Sql compartido no declara begin): merge
  // del staff, baja concurrencia; el DELETE va al final y la FK garantiza
  // que una reserva nunca queda apuntando a un expediente inexistente.
  await sql`UPDATE bookings SET customer_id = ${targetId} WHERE customer_id = ${sourceId}`;
  // Parámetros null con cast explícito: Postgres no infiere el tipo de $n
  // cuando el valor es null en ambas ramas del CASE.
  const sourceNotes = source.notes ?? null;
  const newline = '\n';
  await sql`
    UPDATE customers
    SET contact_history = ${sql.json(history)}::jsonb,
        notes = CASE
          WHEN ${sourceNotes}::text IS NULL THEN notes
          ELSE COALESCE(notes || ${newline}::text || ${sourceNotes}::text, ${sourceNotes}::text)
        END,
        updated_at = now()
    WHERE id = ${targetId}
  `;
  await sql`DELETE FROM customers WHERE id = ${sourceId}`;

  const merged = await sql`SELECT * FROM customers WHERE id = ${targetId}`;
  return merged[0] as unknown as CustomerRow;
}
