// POST /api/admin/vehicles/photos — subida de fotos de flota (multipart).
// Recibe los archivos ORIGINALES que el admin seleccionó (el preview en el
// diálogo fue solo un blob: desechable, nunca viajó), los optimiza con
// sharp (WebP ~900px, igual que el pipeline del seed) y los guarda en el
// directorio de uploads. Devuelve las rutas públicas para el campo photos.
import type { APIContext } from 'astro';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { requireAdminApi } from '../../../../lib/auth';
import { invalidateFleetCache } from '../../../../lib/fleet-cache';

export const prerender = false;

// Runtime: los archivos NO van a public/ (ese directorio se congela en el
// build); van a UPLOAD_DIR y los sirve /uploads/[...path].
const UPLOAD_DIR = process.env.UPLOAD_DIR ?? 'uploads';
const MAX_FILES = 6;
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB por archivo

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function POST(context: APIContext): Promise<Response> {
  const admin = await requireAdminApi(context.cookies);
  if (!admin) return json({ error: 'unauthorized' }, 401);

  let form: FormData;
  try {
    form = await context.request.formData();
  } catch {
    return json({ error: 'invalid_form' }, 400);
  }

  // dest: 'fleet' (900px) | 'logo' (256px contain) — misma vía de subida.
  const dest = form.get('dest') === 'logo' ? 'logo' : 'fleet';
  const files = form.getAll('photos').filter((f): f is File => f instanceof File);
  if (files.length === 0) return json({ error: 'no_files' }, 400);
  if (files.length > MAX_FILES) return json({ error: 'too_many_files' }, 400);

  // Nunca confiar en el nombre del cliente: nombre aleatorio + extensión
  // canónica (sharp SIEMPRE emite WebP; la extensión del original solo se
  // usa como sanity check del content-type).
  const destDir = join(UPLOAD_DIR, dest);
  await mkdir(destDir, { recursive: true });

  const paths: string[] = [];
  try {
    for (const file of files) {
      if (file.size > MAX_BYTES) {
        return json({ error: 'too_large', name: file.name }, 400);
      }
      // No se confía en el content-type del cliente (curl/OS raramente
      // etiquetan bien): SHARP valida que sea una imagen real decodificable
      // y truena si no.
      const buffer = Buffer.from(await file.arrayBuffer());
      let optimized: Buffer;
      try {
        optimized = await sharp(buffer)
          .resize(
            dest === 'logo'
              ? { width: 256, height: 256, fit: 'inside', withoutEnlargement: true }
              : { width: 900, withoutEnlargement: true },
          )
          .webp({ quality: 72 })
          .toBuffer();
      } catch {
        return json({ error: 'not_an_image', name: file.name }, 400);
      }
      const name = `${crypto.randomUUID()}.webp`;
      await writeFile(join(destDir, name), optimized);
      paths.push(`/uploads/${dest}/${name}`);
    }
  } catch (err) {
    console.error('POST /api/admin/vehicles/photos falló:', err);
    return json({ error: 'processing' }, 500);
  }

  // Las fotos forman parte del HTML del catálogo: tumba el snapshot.
  invalidateFleetCache();
  return json({ paths }, 201);
}

export function ALL(): Response {
  return new Response(null, { status: 405, headers: { Allow: 'POST' } });
}
