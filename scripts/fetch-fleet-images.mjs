// One-off: descarga las fotos de flota (URLs remotas en vehicle_models.photos),
// las optimiza a tamaño web (WebP, ancho máx 900px) en public/images/fleet/ y
// actualiza la BD con las rutas locales. Re-ejecutable: si el archivo local ya
// existe, solo actualiza la BD.
// Uso: node --env-file=.env scripts/fetch-fleet-images.mjs
import postgres from 'postgres';
import sharp from 'sharp';
import { mkdir, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';

const sql = postgres(process.env.DATABASE_URL, { max: 1 });
const dir = join('public', 'images', 'fleet');
await mkdir(dir, { recursive: true });

const models = await sql`SELECT slug, photos FROM vehicle_models`;

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

let updated = 0;
let downloaded = 0;
for (const model of models) {
  const urls = model.photos ?? [];
  if (urls.length === 0) continue;
  const localPaths = [];
  for (let i = 0; i < urls.length; i++) {
    const file = join(dir, `${model.slug}-${i + 1}.webp`);
    const publicPath = `/images/fleet/${model.slug}-${i + 1}.webp`;
    if (!(await exists(file))) {
      const res = await fetch(urls[i]);
      if (!res.ok) {
        console.error(`  ✗ ${model.slug}-${i + 1}: HTTP ${res.status}, se conserva la URL remota`);
        localPaths.push(urls[i]);
        continue;
      }
      const buffer = Buffer.from(await res.arrayBuffer());
      // Redimensiona y convierte a WebP: las fuentes remotas llegan de hasta
      // 5161px/megabytes; la web necesita ~900px.
      const optimized = await sharp(buffer)
        .resize({ width: 900, withoutEnlargement: true })
        .webp({ quality: 72 })
        .toBuffer();
      await writeFile(file, optimized);
      downloaded++;
      console.log(`  ↓ ${model.slug}-${i + 1}.webp (${Math.round(optimized.length / 1024)} KB)`);
    }
    localPaths.push(publicPath);
  }
  const arr = '{' + localPaths.join(',') + '}';
  await sql`UPDATE vehicle_models SET photos = ${arr}::text[] WHERE slug = ${model.slug}`;
  updated++;
}

console.log(`${updated} modelos actualizados, ${downloaded} imágenes descargadas y optimizadas`);
await sql.end();
