import { readdirSync, readFileSync } from "node:fs";
import { defineConfig } from "astro/config";

import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import sitemap from "@astrojs/sitemap";

const fromVercel = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : undefined;

const SITE =
  process.env.SITE_URL ??
  fromVercel ??
  process.env.CF_PAGES_URL ??
  "https://gomason.vercel.app";

const draftPaths = readdirSync("./src/content/lessons")
  .filter((file) => file.endsWith(".md"))
  .filter((file) =>
    /^draft:\s*true\s*$/m.test(
      readFileSync(`./src/content/lessons/${file}`, "utf8"),
    ),
  )
  .map((file) => `/courses/${file.replace(/\.md$/, "")}/`);

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
      themes: { light: "vitesse-light", dark: "vitesse-dark" },
      defaultColor: false,
      wrap: false,
    },
  },

  vite: {
    plugins: [tailwindcss()],
  },

  output: "static",
});
