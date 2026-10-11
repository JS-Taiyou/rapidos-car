// @ts-check
import { defineConfig } from 'astro/config';

import react from '@astrojs/react';
import node from '@astrojs/node';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  // URL base para canonical/hreflang (ARCHITECTURE §6 paso 2). En producción
  // la plataforma inyecta PUBLIC_SITE_URL; el fallback sirve para dev local.
  site: process.env.PUBLIC_SITE_URL ?? 'http://localhost:4321',
  integrations: [react()],
  adapter: node({ mode: 'standalone' }),
  vite: {
    plugins: [tailwindcss()],
  },
});
