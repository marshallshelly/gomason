## Development

When starting the dev server, use background mode:

```
astro dev --background
```

Manage the background server with `astro dev stop`, `astro dev status`, and `astro dev logs`.

## Documentation

Full documentation: https://docs.astro.build

Consult these guides before working on related tasks:

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)
- [Adding or managing content](https://docs.astro.build/en/guides/content-collections/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
- [Supporting multiple languages](https://docs.astro.build/en/guides/internationalization/)

## Brand

**GoMason** — gomason.dev · github.com/gomason. Tagline: *Build Go, course by course.*

In masonry a **course** is one horizontal row of stones; a wall is raised course
by course. The name is a double meaning, not a decoration — say it that way in
copy. The course teaches Go by building a working PostgreSQL ORM.

### Logo

`src/assets/logo.svg` — stepped courses of stone (4/3/2/1) ascending left to
right, with the top block in Go cyan: the course you have not laid yet.

- Use `<Logo />` (`src/components/Logo.astro`), props: `size`, `wordmark`, `class`.
- The mark's blocks are `currentColor`; the cyan cap reads `--logo-accent`, so it
  adapts to the theme automatically. Do not hardcode the mark's colors.
- `public/favicon.svg` is a chunkier 3-step cut with a basalt tile behind it —
  the 4-step mark loses legibility at 16px.

### Design tokens (`src/styles/global.css`)

Warm limestone neutrals against Go cyan. The neutrals are hue-biased warm on
purpose; do not swap in a pure grey.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--background` | `#F7F4EE` paper | `#14120E` basalt | page ground |
| `--foreground` | `#1A1712` ink | `#EFE9DE` chalk | body text |
| `--card` | `#FFFDF8` | `#1D1A15` slate | raised surfaces |
| `--stone` | `#6F6555` | `#C9BCA8` limestone | mark, stone accents |
| `--mortar` | `#726858` | `#8A8073` | secondary text |
| `--brand-cyan` | `#00728E` | `#00ADD8` | accent, primary, focus ring |

Tailwind utilities: `text-stone`, `text-mortar`, `text-cyan` (plus all the
standard shadcn tokens).

**Cyan is deepened to `#00728E` in light mode on purpose.** True Go cyan
(`#00ADD8`) only reaches 3.7:1 on paper and fails AA for labels and button text.
Every foreground/background pair in both themes clears WCAG AA — re-check with a
contrast calculation before changing any color token.

Theme is class-based (`.dark` on `<html>`), set before first paint by an inline
script in `Layout.astro` and persisted to `localStorage` under `gomason-theme`.

### Type

- **Display** (`--font-heading`): Fraunces Variable — Roman inscriptional
  lineage, letterforms cut in stone. Applied to `h1`–`h3` with `WONK 1`.
- **Body** (`--font-sans`): IBM Plex Sans.
- **Code** (`--font-mono`): IBM Plex Mono. Also used for eyebrows and small
  uppercase labels with `tracking-[0.14em]`+.

Do not use Inter or Space Grotesk. Fonts are self-hosted via `@fontsource`;
never add a font CDN link.

## Curriculum content

Lessons are an Astro content collection, defined in `src/content.config.ts`,
loaded from `src/content/lessons/*.md` via the `glob()` loader.

Frontmatter is schema-validated: `title`, `part`, `order`, `summary`,
`topics[]`, `minutes`, `draft`. **Quote `title` and `summary`** — several
contain colons (`"Migrations: introspect, diff, plan"`) or escaped quotes
(`po:\"id,primaryKey\"`), which break unquoted YAML.

The course runs in three parts, exported as `PARTS` from `src/content.config.ts`:

| Part | Lessons | Covers |
|---|---|---|
| `foundations` | 01–04 | setup and the `go` CLI, types, structs and methods, errors |
| `tools` | 05–09 | interfaces, generics, concurrency, reflection, testing |
| `orm` | 10–15 | tags → schema, registry, query builder, pgx, `go/ast`, migrations |

The ordering is deliberate: each language feature lands immediately before the
chapter that needs it (generics before `Select[T]`, `sync.RWMutex` before the
registry, reflection before the tag parser). Keep that property when editing.

## Progress tracking

### Why TanStack DB and not plain localStorage

The reader-state store costs ~50 KB gzip on top of React, which is a lot for
what is currently a set of 15 booleans. It is a deliberate choice, not an
oversight: **notes and bookmarks are planned**, and those need cross-collection
live queries (e.g. "lessons I bookmarked that I have not finished", "notes on
this lesson") that a hand-rolled localStorage store would grow into badly.

Adding those means adding collections beside `progress` and querying across
them — the components do not change shape. If sign-in ever arrives, each
collection swaps `localStorageCollectionOptions` for a query collection and
nothing else moves.

Do not replace this with `useState` + `localStorage` to save bundle size
without first checking whether notes and bookmarks have shipped.

`src/lib/progress.ts` — a TanStack DB collection backed by
`localStorageCollectionOptions`. Survives refresh, syncs across tabs, no
account required. One row per *completed* lesson; absent means not started,
so clearing progress is just deleting rows.

`src/components/Curriculum.tsx` is the island. Note its shape:

- `CurriculumView` is pure and renders identically on server and client.
- `LiveCurriculum` calls `useLiveQuery` and is **only rendered after
  hydration**, gated by a `useState`/`useEffect` flag.

That gate exists for a reason: `useLiveQuery` uses `useSyncExternalStore`
with no server snapshot, so calling it during SSR throws
*"Missing getServerSnapshot"* and the build fails. The gate keeps all 15
lessons in the prerendered HTML (SEO, and it works without JavaScript) while
progress fills in on hydration. Do not "simplify" it to `client:only`.

## Motion

Custom easing tokens live in `global.css`: `--ease-out` and `--ease-in-out`.
The browser defaults are too weak to read as intentional. Never use `ease-in`
on UI — it delays the moment the user is watching most closely.

Frequency decides whether something animates at all:

| Interaction | Frequency | Treatment |
|---|---|---|
| Ticking a lesson off | ~15 times, ever | Earns a moment: 180ms mark-in, `scale(0.94)` on press |
| Progress bar | ~15 times | 450ms `--ease-out` |
| Row hover | constant | Colour only, behind `@media (hover: hover) and (pointer: fine)` |
| List entrance | once per visit | 35ms stagger, capped at 350ms total |

Rules applied throughout, and worth keeping:

- Animate `transform` and `opacity` only. The progress bar uses
  `transform: scaleX()`, never `width` — width relayouts every frame.
- Never enter from `scale(0)`; the tick mark starts at `scale(0.8)`.
- Exits are faster than entrances (100ms out, 180ms in).
- Everything degrades under `prefers-reduced-motion: reduce`.
