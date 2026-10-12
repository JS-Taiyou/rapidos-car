// POST /api/quote — cotización pública de disponibilidad + precio
// (ARCHITECTURE §4). Endpoint de CONSULTA: no aparta nada; entre "parece
// libre" y "está apartado" hay una carrera que solo resuelve /api/bookings
// con la transacción y la constraint no_overlap (§2.9).
import type { APIContext } from 'astro';
import { sql } from '../../lib/db';
import { findAvailableModels } from '../../lib/availability';
import { computeQuote, loadPricingContext, type QuoteResult } from '../../lib/pricing';
import { quoteSchema } from '../../lib/validation';
import { getPickupPoints } from '../../lib/pickup-points';

export const prerender = false;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function POST({ request }: APIContext): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const parsed = quoteSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: 'validation', issues: parsed.error.issues }, 400);
  }
  const { start, end, pickupZone, returnZone } = parsed.data;
  const selectedExtras = parsed.data.extras ?? [];

  // Las 3 queries de contexto van en UN Promise.all: son independientes.
  const ctx = await loadPricingContext(sql);
  const models = await findAvailableModels(start, end);

  // computeQuote es puro: sin await dentro del map (evita N+1, §4).
  const results: QuoteResult[] = models
    .filter((m) => m.unitsAvailable > 0)
    .map((m) => ({
      slug: m.slug,
      name: m.name,
      category: m.category,
      transmission: m.transmission,
      seats: m.seats,
      luggage: m.luggage,
      dailyRateCents: m.dailyRateCents,
      photos: m.photos,
      unitsAvailable: m.unitsAvailable,
      price: computeQuote(m, start, end, pickupZone, selectedExtras, ctx, returnZone ?? pickupZone),
    }))
    // Orden explícito por TOTAL: incluye extras y entrega y puede reordenar
    // respecto a la tarifa base.
    .sort((a, b) => a.price.totalCents - b.price.totalCents);

  // extras/zones viajan con la respuesta para que el wizard (paso 3) y el
  // resumen muestren catálogo y cargos sin una segunda llamada.
  return json({
    results,
    extras: ctx.extrasCatalog,
    zones: (await getPickupPoints()).map((p) => ({ zone: p.key, name: p.name, feeCents: p.feeCents ?? 0, lat: p.lat, lng: p.lng })),
  });
}

// Astro enruta por nombre de función: sin ALL, un GET caería en 404 genérico
// y el cliente no sabría que el endpoint existe con otro método.
export function ALL(): Response {
  return new Response(null, { status: 405, headers: { Allow: 'POST' } });
}
