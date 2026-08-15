// @ts-check
import { readdirSync, readFileSync } from "node:fs";
import { defineConfig } from "astro/config";

import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import sitemap from "@astrojs/sitemap";

// Canonical URLs and the sitemap are built from this. Cloudflare sets
// CF_PAGES_URL on every build; SITE_URL overrides it if a custom domain
// is ever added. The literal is the production fallback.
const SITE =
  process.env.SITE_URL ??
  process.env.CF_PAGES_URL ??
  "https://gomason.pages.dev";

// Unwritten courses are noindex, so they must not appear in the sitemap
// either — a sitemap should only ever list canonical, indexable URLs.
// Frontmatter stays the single source of truth for what is a draft.
const draftPaths = readdirSync("./src/content/lessons")
  .filter((file) => file.endsWith(".md"))
  .filter((file) =>
    /^draft:\s*true\s*$/m.test(
      readFileSync(`./src/content/lessons/${file}`, "utf8"),
    ),
  )
  .map((file) => `/courses/${file.replace(/\.md$/, "")}/`);

// https://astro.build/config
export default defineConfig({
  site: SITE,

  integrations: [
    react(),
    sitemap({
      filter: (page) => !draftPaths.some((path) => page.endsWith(path)),
    }),
  ],

  markdown: {
    shikiConfig: {
      // Warm-toned themes that sit with the limestone palette. `defaultColor:
      // false` emits both as CSS variables so one DOM serves both themes.
      themes: { light: "vitesse-light", dark: "vitesse-dark" },
      defaultColor: false,
      wrap: false,
    },
  },

  vite: {
    plugins: [tailwindcss()],
  },

  // Fully prerendered — Cloudflare Pages serves dist/ directly, so no
  // adapter is needed. Adding one routes prerendering through miniflare,
  // which currently fails on getStaticPaths.
  output: "static",
});
