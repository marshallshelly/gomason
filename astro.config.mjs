// @ts-check
import { readdirSync, readFileSync } from "node:fs";
import { defineConfig } from "astro/config";

import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import sitemap from "@astrojs/sitemap";

// Canonical URLs, the sitemap, robots.txt and the OG image URL are all
// built from this, so a wrong value ships silently broken SEO.
//
// Resolution order:
//   SITE_URL                       - explicit override, e.g. a custom domain
//   VERCEL_PROJECT_PRODUCTION_URL  - stable production domain, set by Vercel.
//                                    Deliberately not VERCEL_URL, which is a
//                                    per-deployment hostname; preview builds
//                                    should canonicalise to production, not
//                                    to themselves.
//   CF_PAGES_URL                   - set by Cloudflare Pages builds only.
// The literal is the last resort, used by local builds.
const fromVercel = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : undefined;

const SITE =
  process.env.SITE_URL ??
  fromVercel ??
  process.env.CF_PAGES_URL ??
  "https://gomason.vercel.app";

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

  // Fully prerendered: the host serves dist/ as static files, so no
  // adapter is needed on any platform.
  output: "static",
});
