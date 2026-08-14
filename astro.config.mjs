// @ts-check
import { defineConfig } from 'astro/config';

import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  site: 'https://gomason.dev',
  integrations: [react(), sitemap()],

  markdown: {
    shikiConfig: {
      // Warm-toned themes that sit with the limestone palette. `defaultColor:
      // false` emits both as CSS variables so one DOM serves both themes.
      themes: { light: 'vitesse-light', dark: 'vitesse-dark' },
      defaultColor: false,
      wrap: false,
    },
  },

  vite: {
    plugins: [tailwindcss()]
  }
});