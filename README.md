<p align="center">
  <img src="public/favicon.svg" width="72" alt="">
</p>

<h1 align="center">GoMason</h1>

<p align="center"><em>Build Go, course by course.</em></p>

Most Go tutorials stop at a todo list. This one ends with a working PostgreSQL
ORM.

GoMason is a free, open source course that teaches Go from `go mod init` through
to reflection, generics and `go/ast` — by building a real ORM one piece at a
time. No Go experience assumed.

In masonry, a *course* is one horizontal row of stones; a wall is raised course
by course. So is this.

## The courses

**Foundations** — the language itself, no ORM yet.

| # | Course | Covers |
|---|---|---|
| 01 | Setting up Go | `go mod init`, `go run`, `go build`, `go test`, `gofmt`, `go vet` |
| 02 | Values and types | zero values, slices vs arrays, maps, strings/runes/bytes |
| 03 | Structs and methods | pointer vs value receivers, composition |
| 04 | Errors are values | `errors.Is`/`As`, wrapping, `defer`, `panic` |

**The sharp tools** — each lands right before the course that needs it.

| # | Course | Covers |
|---|---|---|
| 05 | Interfaces | implicit satisfaction, small interfaces |
| 06 | Generics | type parameters, constraints |
| 07 | Goroutines and concurrency | channels, `select`, `sync.RWMutex`, `context` |
| 08 | Reflection and struct tags | `reflect.Type`, `reflect.Value` |
| 09 | Testing | table-driven tests, benchmarks, testcontainers |

**Building the ORM** — every course ends with running, tested code.

| # | Course | Covers |
|---|---|---|
| 10 | From struct tags to a schema | parsing, table-driven tests |
| 11 | The registry | concurrent-safe metadata cache |
| 12 | The query builder | `Select[T]`, fluent APIs, testable SQL |
| 13 | Executing queries with pgx | pools, row scanning |
| 14 | The AST loader | `go/ast`, reading tags without compiling |
| 15 | Migrations | introspect, diff, plan |

## What you need

- **Go 1.22+** for every course
- **Docker** from course 09 onwards, for a real PostgreSQL to test against

Courses 01–09 are plain standard-library Go and run anywhere. The ORM courses
talk to a live database on purpose — half the lessons are in watching Postgres
reject your SQL.

## Running the site

```sh
pnpm install
pnpm dev
```

Built with [Astro](https://astro.build), React islands, Tailwind and
[TanStack DB](https://tanstack.com/db). Progress is stored in your browser;
there is nothing to sign up for and no backend to run.

```sh
pnpm build     # static site to ./dist
pnpm preview   # serve the build locally
```

## Contributing

Course content lives in `src/content/lessons/` as Markdown with validated
frontmatter. Corrections to published courses are very welcome — especially if
a command's output does not match what you actually see.

Every command and output printed in a course is run before it is published. If
you find one that is wrong, that is a bug worth filing.

## Licence

MIT.
