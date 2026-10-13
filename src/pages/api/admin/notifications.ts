// GET /api/admin/notifications — stream SSE de alertas para el staff.
// Requiere sesión de admin: clientes públicos no pueden conectarse.
// Heartbeat cada 25 s para que proxies no corten la conexión.
import type { APIContext } from 'astro';
import { requireAdminApi } from '../../../lib/auth';
import { addAlertClient } from '../../../lib/alerts';

export const prerender = false;

export async function GET(context: APIContext): Promise<Response> {
  const admin = await requireAdminApi(context.cookies, ['admin', 'desk', 'yard']);
  if (!admin) return new Response(null, { status: 401 });

  const encoder = new TextEncoder();
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let unsubscribe: (() => void) | undefined;

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      unsubscribe = addAlertClient(send);
      send('ready', { at: new Date().toISOString() });
      heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode(': ping\n\n'));
      }, 25_000);
    },
    cancel() {
      if (heartbeat) clearInterval(heartbeat);
      unsubscribe?.();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}

export function ALL(): Response {
  return new Response(null, { status: 405, headers: { Allow: 'GET' } });
}
