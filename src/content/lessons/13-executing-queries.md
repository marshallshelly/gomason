---
title: "Executing queries with pgx"
part: orm
order: 13
summary: "Connect, run the SQL you built, and scan rows straight into your structs."
topics:
  - pgx
  - connection pools
  - row scanning
  - interfaces
minutes: 55
draft: false
---

Course 12 ended with a string and a list of arguments. This course sends them to
PostgreSQL and turns the answer back into `[]User`.

There is one mistake in here that produces no error, no panic, and the wrong
answer. It is three characters long and almost everyone leaves it out the first
time.

## The first real query

Install the driver and open a pool:

```bash
go get github.com/jackc/pgx/v5
```

```go
pool, err := pgxpool.New(ctx, "postgres://localhost:5432/mydb?sslmode=disable")
if err != nil {
	return err
}
defer pool.Close()
```

A **pool**, not a connection. Postgres forks a backend process per connection, so
opening one per request is how you take a database down. `pgxpool` keeps a set of
them, hands one out per query and takes it back after. It is safe for concurrent
use — the only type in this ORM that is, besides course 11's registry.

Now run the SQL from course 12:

```go
sql, args, err := builder.Select[User](qb).Where(builder.Gt("age", 18)).ToSQL()
if err != nil {
	return err
}

rows, err := pool.Query(ctx, sql, args...)
if err != nil {
	return err
}
defer rows.Close()

for rows.Next() {
	var u User
	if err := rows.Scan(&u.ID, &u.Email, &u.Age); err != nil {
		return err
	}
	users = append(users, u)
}
return nil
```

Read that loop and decide whether it is correct. It compiles, it vets clean, it
passes a test against a working database.

## Predict: where does the error go?

Type this against a real server. The first two rows are fine and the third
divides by zero:

```go
const q = `select 10 / x from (values (1),(2),(0)) t(x)`

rows, err := conn.Query(ctx, q)
fmt.Println("Query error:", err)

var got []int
for rows.Next() {
	var n int
	rows.Scan(&n)
	got = append(got, n)
}
fmt.Println("collected:", got)
fmt.Println("rows.Err():", rows.Err())
```

**Predict all three lines.**

```text
Query error: <nil>
collected:   [10 5]
rows.Err():  ERROR: division by zero (SQLSTATE 22012)
```

`Query` succeeded. The loop ended **normally**. `rows.Next()` returned false
exactly as it does at the end of a healthy result set, and the function above
would have returned `[10, 5]` and `nil`.

Two of three rows, reported as success. A truncated report, a partial invoice, a
page of search results missing its tail — and nothing anywhere says so.

**`rows.Next()` returning false means "no more rows", not "all rows".** The only
way to tell the difference is to ask:

```go
if err := rows.Err(); err != nil {
	return nil, err
}
```

Those three lines go after every `rows.Next()` loop you will ever write. The
error can arrive mid-stream because Postgres streams results — it has already
sent you row one when it discovers row three is impossible.

## Scanning into a struct

Hand-writing `rows.Scan(&u.ID, &u.Email, &u.Age)` is the boilerplate the ORM
exists to delete. You have what you need to generate it: the registry (course 11)
knows the column order, and reflection (course 08) can address the fields.

```go
func scanIntoStruct[T any](rows pgx.Rows, dst *T, table *TableMetadata) error {
	v := reflect.ValueOf(dst).Elem()
	targets := make([]any, 0, len(table.Columns))
	for _, col := range table.Columns {
		field := v.FieldByName(col.GoField)
		targets = append(targets, field.Addr().Interface())
	}
	return rows.Scan(targets...)
}
```

`field.Addr().Interface()` is the piece worth pausing on: it produces a `*string`
or `*int` pointing *into the struct*, which is exactly what `Scan` wants.
`reflect.New` from course 08 gave you an addressable value; this is why that
mattered.

### Predict: what does FieldByName cost?

Course 08 measured `FieldByName` at 12× the cost of `Field(i)` for a single
field. **Predict what that becomes for a 1000-row, 10-column result:**

```text
BenchmarkScan1000RowsByName-11     364415 ns/op   0 allocs/op
BenchmarkScan1000RowsByIndex-11     38421 ns/op   0 allocs/op
```

**9.5×.** 364 microseconds of the scan spent searching for field names the
registry already resolved — comparable to the entire network round trip for the
same query.

The fix is to store the field index at registration time and use `Field(i)`.
Which this ORM does not do: `scanner.go` calls `FieldByName` in three places. The
metadata even carries a `Position` field holding `field.Index[0]`, so the index is
sitting right there unused.

I am telling you this because the interesting part is *why* it is still like
that. The two schema paths disagree about what `Position` means — the reflection
parser stores the struct field index, the AST loader stores a column counter — so
using it as an index is only safe for models registered the first way. Making it
load-bearing means reconciling the two paths first. That is a real piece of
work, not an oversight, and it is the kind of thing you find by benchmarking
rather than by reading.

## One interface, two callers

Everything so far used `pool.Query`. Inside a transaction you have a `pgx.Tx`
instead, and its methods have different signatures.

The wrong answer is to write every builder twice. **This ORM did exactly that**,
and the two copies drifted until the transaction path silently lost `LATERAL`
join support for several releases.

The right answer is course 05's lesson. Write down the three methods you
actually use:

```go
type queryExecutor interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Exec(ctx context.Context, sql string, args ...any) (int64, error)
}
```

`*pgxpool.Pool` satisfies that already. `pgx.Tx` does not quite — its `Exec`
returns a `CommandTag` rather than a count — so a six-line adapter closes the
gap:

```go
type txExecutor struct{ tx pgx.Tx }

func (t txExecutor) Exec(ctx context.Context, sql string, args ...any) (int64, error) {
	tag, err := t.tx.Exec(ctx, sql, args...)
	return tag.RowsAffected(), err
}
```

Three methods, defined by the consumer, with a tiny adapter for the type that
does not fit. Eight builders, one execution path, and no way for them to diverge
again.

## Transactions

```go
tx, err := pool.Begin(ctx)
if err != nil {
	return err
}
defer tx.Rollback(ctx)

if _, err := builder.TxInsert[User](tx).Values(u).ExecReturning(); err != nil {
	return err
}

return tx.Commit(ctx)
```

**`defer tx.Rollback(ctx)` goes immediately after the error check**, before any
work. It is course 04's deferred cleanup doing real safety work: every early
return, and any panic, now rolls back. Rolling back an already-committed
transaction is a no-op error you ignore, which is what makes the pattern safe.

One thing to know that is not obvious: a transaction is **one connection**. Two
result sets cannot be open on it at once. This ORM hit that with eager loading —
the preload query ran while the main result set was still streaming, on the same
connection — and the fix was to close the rows before loading relationships:

```go
if len(preloads) > 0 && len(results) > 0 {
	rows.Close()
	// ... now load relationships
}
```

A `defer rows.Close()` is still there for every other exit. Closing twice is
harmless; closing too late is a deadlock.

## Why not database/sql?

The standard library has a database package. The usual argument for skipping it
is that it cannot handle PostgreSQL's types. **Check whether that is still
true** — scan a `text[]` through `database/sql` using pgx's `stdlib` driver:

```go
var tags []string
err := db.QueryRow(`select '{go,sql}'::text[]`).Scan(&tags)
```

```text
database/sql -> []string : [go sql]
pgx native   -> []string : [go sql]
```

Both work. As of pgx v5.11 on Go 1.27, `database/sql` scans arrays and ranges
directly through the new `driver.RowsColumnScanner` interface. **The capability
argument is dead**, and if you read it in an older blog post it was true when
written.

What is left is cost. Same 1000-row, 4-column query, both paths:

```text
BenchmarkPgxNativeScan-11      300530 ns/op   6004 allocs/op
BenchmarkDatabaseSQLScan-11    576841 ns/op   8664 allocs/op
```

**1.92× slower and 44% more allocations.** Every value crosses `driver.Value`,
which has six permitted types, so a PostgreSQL value becomes one of those six and
then becomes your Go type.

And some things `database/sql` has no vocabulary for at all: `CopyFrom` for bulk
loading, `SendBatch` for pipelining, `LISTEN`/`NOTIFY`.

So the honest case for going native is "roughly twice as fast, with access to
Postgres-specific features", not "arrays do not work". Keep `database/sql` if you
need to swap databases, which is the one thing it genuinely buys you and the one
thing this ORM has no interest in.

## Build something

Give your builder from course 12 an `All` method:

```go
func (q *SelectQuery[T]) All(ctx context.Context) ([]T, error)
```

It calls `ToSQL`, runs the query, scans each row into a `T` using the registry's
column order, and returns `[]T`. Take a `queryExecutor` rather than a
`*pgxpool.Pool`, so a transaction works without a second implementation.

Then write the test that matters. Not "does it return rows" — this one:

- Run a query that fails on a later row (`select 10 / x from (values (1),(0)) t(x)`
  is enough) and assert `All` returns an **error**, not a short slice.

Write `All` without the `rows.Err()` check first and watch that test fail while
every other test passes.

```bash
go test -race ./...
```

<details>
<summary>Check yourself</summary>

```go
func (q *SelectQuery[T]) All(ctx context.Context) ([]T, error) {
	sql, args, err := q.ToSQL()
	if err != nil {
		return nil, err
	}

	rows, err := q.exec.Query(ctx, sql, args...)
	if err != nil {
		return nil, fmt.Errorf("query %q: %w", sql, err)
	}
	defer rows.Close()

	var out []T
	for rows.Next() {
		var item T
		if err := scanIntoStruct(rows, &item, q.table); err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("query %q: %w", sql, err)
	}
	return out, nil
}
```

**The error wraps the SQL.** Course 04's `%w` keeps the chain intact so a caller
can still `errors.Is` the pgx error underneath, while the message says which
statement failed. This ORM goes further and defines a `QueryError` carrying the
SQL and the args as fields, so a caller can log the statement without the ORM
deciding how — `errors.As` from course 04.

**`defer rows.Close()` and the explicit `rows.Err()` are both required**, and they
do different jobs. `Close` releases the connection back to the pool. `Err`
reports whether the stream ended because it finished or because it broke.

**`out` starts nil and is never preallocated.** You do not know the row count,
`rows` will not tell you, and `append` handles growth. Returning a nil slice for
zero rows is fine — course 02 established that `len` and `range` both work on it.

**Nothing here is in `ToSQL`.** That separation is what let courses 12 and 13 be
different lessons, and what lets every test in course 12 run without a database.

</details>

## Next

Your models have to compile for reflection to see them. The CLI cannot assume
that — `pebble generate` runs on source files mid-refactor. Course 14 reads your
structs with `go/ast` instead, and then has to prove the two readers agree.
