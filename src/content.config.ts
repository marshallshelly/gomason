import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

export const PARTS = [
  {
    id: "foundations",
    title: "Foundations",
    blurb: "The language itself. No ORM yet — just Go, and enough of it to build one.",
  },
  {
    id: "tools",
    title: "The sharp tools",
    blurb:
      "Interfaces, generics, concurrency, reflection. Each one lands right before the chapter that needs it.",
  },
  {
    id: "orm",
    title: "Building the ORM",
    blurb:
      "Every course from here ends with something that runs, and something that is tested.",
  },
] as const;

const lessons = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/lessons" }),
  schema: z.object({
    title: z.string(),
    part: z.enum(["foundations", "tools", "orm"]),
    order: z.number().int().positive(),
    summary: z.string(),
    topics: z.array(z.string()).min(1),
    minutes: z.number().int().positive(),
    draft: z.boolean().default(true),
  }),
});

export const collections = { lessons };
