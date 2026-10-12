// /admin/app-icon/[size].png — icono de la app PWA generado AL VUELO desde
// el logo del tenant (icono de la galería con su color, o la imagen subida).
// Cache en memoria por versión del tenant: cambia el logo en Ajustes y la
// invalidación de tenant.ts también renueva estas respuestas vía no-store.
import type { APIRoute } from 'astro';
import sharp from 'sharp';
import { getTenant } from '../../../lib/tenant';
import { iconPath } from '../../../lib/icons';

export const prerender = false;

const cache = new Map<string, Buffer>();

export const GET: APIRoute = async ({ params }) => {
  // El icono alimenta el manifest del PWA: lo ve el personal con sesión, y
  // aunque el navegador lo pidea sin cookie al instalar, exigir sesión aquí
  // rompería A2HS → se sirve abierto (no contiene datos sensibles).
  const sizeRaw = (params.size ?? '192').replace(/\.png$/i, '');
  const size = /^(192|512)$/.test(sizeRaw) ? Number(sizeRaw) : 192;

  const tenant = await getTenant();
  const key = `${size}:${tenant.logo.type}:${tenant.logo.icon}:${tenant.logo.color}:${tenant.logo.url ?? ''}`;
  let png = cache.get(key);
  if (!png) {
    const density = size >= 512 ? 72 : 36;
    if (tenant.logo.type === 'image' && tenant.logo.url) {
      // Imagen subida: se sirve desde /uploads (mismo disco), resizeada.
      const fs = await import('node:fs/promises');
      const path = await import('node:path');
      const rel = tenant.logo.url.replace(/^\/uploads\//, '');
      const file = await fs.readFile(path.join(process.env.UPLOAD_DIR ?? 'uploads', rel));
      png = await sharp(file)
        .resize({ width: size, height: size, fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
        .png()
        .toBuffer();
    } else {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}">
  <rect width="24" height="24" rx="5" fill="#ffffff"/>
  <path d="${iconPath(tenant.logo.icon)}" fill="${tenant.logo.color}" transform="translate(2.4 2.4) scale(0.8)"/>
</svg>`;
      png = await sharp(Buffer.from(svg), { density }).resize(size, size).png().toBuffer();
    }
    cache.set(key, png);
  }

  return new Response(new Uint8Array(png), {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'no-store',
    },
  });
};
