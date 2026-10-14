---
title: "The registry"
part: orm
order: 11
summary: "Cache table metadata once, read it from many goroutines, and never parse the same struct twice."
topics:
  - sync.RWMutex
  - package design
  - lazy initialisation
minutes: 40
draft: false
---

Course 10 gave you a tag parser. Course 08 measured what it costs: around 500
nanoseconds and 13 allocations to read one struct's tags. Every query would pay
that.

So you cache it. The package is about sixty lines and it has one hard
requirement — every query, on every goroutine, reads from it at once.

This course has a benchmark in the middle that contradicts what course 07 told
you. Run it yourself.

## The cheapest possible cache

In your `greet` module:

```go
type Registry struct {
	tables map[reflect.Type]*TableMetadata
}

func (r *Registry) Get(t reflect.Type) (*TableMetadata, bool) {
	m, ok := r.tables[t]
	return m, ok
}
```

A map from type to metadata. Course 08 already showed the payoff:

```text
BenchmarkParseUncached    507.3 ns/op   488 B/op   13 allocs/op
BenchmarkParseCached       10.4 ns/op     0 B/op    0 allocs/op
```

Roughly fifty times faster and no garbage. That is the whole reason this package
exists, and it is also the entire easy part.

## Predict: which lock is faster?

Course 07 said readers must not block each other or the lock becomes a
bottleneck. So put the same map behind each kind of lock and race eleven
goroutines at it:

```go
func (r *RW) Get(t reflect.Type) *meta { r.mu.RLock(); defer r.mu.RUnlock(); return r.m[t] }
func (r *MU) Get(t reflect.Type) *meta { r.mu.Lock();  defer r.mu.Unlock();  return r.m[t] }
```

```bash
go test -bench=MapLookup -benchmem -run=^$ .
```

**Predict the gap before you run it.** Many readers, one map lookup each.

```text
BenchmarkRWMutex_MapLookup-11    98.14 ns/op
BenchmarkMutex_MapLookup-11     100.7  ns/op
```

**Two and a half percent.** Not 10×, not 2× — nothing.

The reason is that `RLock` is not free. It atomically increments a shared reader
counter, and that counter lives on one cache line that every core has to fight
over. A `Mutex` fights over one word too. When the work *inside* the lock is a
single map lookup — about ten nanoseconds — the contention on the lock itself
dominates completely, and both locks contend about equally.

## When it does pay

Change one thing: make the reader hold the lock longer. Same locks, a loop
inside the critical section:

```bash
go test -bench=LongRead -benchmem -run=^$ .
```

```text
BenchmarkRWMutex_LongRead-11    106.5 ns/op
BenchmarkMutex_LongRead-11      206.1 ns/op
```

**1.93×.** Now the readers genuinely overlap, and `RWMutex` wins roughly in
proportion to how long they hold it.

So the rule is not "reads outnumber writes, therefore RWMutex". It is:

> **`RWMutex` pays off in proportion to how long readers hold the lock.**
> For a bare map lookup it is a wash. Reach for it when readers do real work.

Which leaves an honest question about the ORM. Its hot path — `Get` by type — is
a bare map lookup, so the `RWMutex` buys it almost nothing there. What justifies
it is the *other* readers:

```go
func (r *Registry) GetAllTables() map[string]*schema.TableMetadata {
	r.mu.RLock()
	defer r.mu.RUnlock()

	tables := make(map[string]*schema.TableMetadata)
	maps.Copy(tables, r.names)
	return tables
}
```

That copies the whole map under the read lock. The migration pipeline calls it,
and it is exactly the long read the second benchmark describes. Course 07's claim
was right about the ORM and wrong about the reason, and I would not have noticed
without running it.

## The bug in lazy initialisation

Query builders do not register models up front. They call `GetOrRegister`, which
parses on first use:

```go
func (r *Registry) GetOrRegister(t reflect.Type) *meta {
	r.mu.RLock()
	got, ok := r.m[t]
	r.mu.RUnlock()
	if ok {
		return got
	}

	r.mu.Lock()
	defer r.mu.Unlock()
	m := parse(t)      // ~500ns, 13 allocations
	r.m[t] = m
	return m
}
```

Read under `RLock`, and on a miss take the write lock and parse. That looks
correct and it is not.

**Your turn.** Release 200 goroutines at the same type simultaneously, count how
many parse, and count how many *distinct pointers* they get back. Use a channel
as a start barrier so they all hit the read check together, and make `parse`
sleep a couple of milliseconds so the window is visible.

```text
no inner check: 2 missed, 2 parses, 2 distinct pointers
no inner check: 3 missed, 3 parses, 3 distinct pointers
no inner check: 1 missed, 1 parses, 1 distinct pointers
```

Two things to notice.

**Only one to three of 200 goroutines miss.** The window between `RUnlock` and
`Lock` is a few nanoseconds wide. That is why this class of bug ships: it almost
never happens, and when it does nothing fails loudly.

**Each miss produces a distinct pointer.** That is the real damage. Two callers
now hold different `*TableMetadata` for the same type, and the map keeps whichever
wrote last. The loser is holding an orphan — and if anything ever mutates
metadata after registration, those writes land somewhere nobody can read.

Note what the race detector says about this: nothing. `go test -race` is clean.
Every access is properly locked. This is a *logic* race, not a data race, and
course 07's detector cannot see it.

### The second check

The fix is to check again after acquiring the write lock:

```go
	r.mu.Lock()
	defer r.mu.Unlock()
	if got, ok := r.m[t]; ok {   // someone registered while we waited
		return got
	}
	m := parse(t)
```

```text
inner check: 2 missed, 1 parses, 1 distinct pointers
```

Read that line carefully — **two goroutines got past the read check, and only one
parsed.** The second acquired the write lock, found the entry the first had just
written, and returned it. One pointer, one parse.

This is **double-checked locking**, and it is one of the few places the pattern
is both correct and necessary in Go. The cheap read handles the 99.99% case; the
second check handles the rest.

## Predict: key by name or by type?

Two packages in one codebase, each with a `User`:

```go
package admin;   type User struct { ID, Email string }
package billing; type User struct { ID, StripeID string }
```

**What does `reflect.Type.Name()` return for each, and what happens to a
`map[string]` keyed by it?**

```text
admin.User   Name()="User"  String()="admin.User"
billing.User Name()="User"  String()="billing.User"
same Name()?        true
same reflect.Type?  false

map[string] keyed by Name() holds 1 entries for 2 models
map[reflect.Type]  holds 2 entries for 2 models
```

`Name()` is the bare identifier, so both are `"User"` and the name-keyed map
**silently collapses two models into one**. `reflect.Type` is identity — it
carries the package — so it never collides. That is why the cache is keyed by
type, and it is course 08's `Type` versus `Kind` distinction cashing out: you
want identity here, not shape.

## What you just built

The real registry, with everything above in it:

```go
type Registry struct {
	mu     sync.RWMutex
	parser *schema.Parser
	tables map[reflect.Type]*schema.TableMetadata
	names  map[string]*schema.TableMetadata
}
```

**Two maps, deliberately.** `tables` is keyed by `reflect.Type` for the query
builders, which always have a `T`. `names` is keyed by table name for the
migration pipeline, which reads SQL and only has a string. The second map has
the collision you just measured — two models that resolve to the same table name
would overwrite each other — and the ORM does not guard it, on the grounds that
two tables with one name is already broken.

The lock ratio is the giveaway about what this package is for: **eight `RLock`
sites to three `Lock` sites.** Writes happen once per model, ever. Reads happen
on every query, forever.

## Build something

Turn course 10's parser into a registry.

```go
func NewRegistry() *Registry
func (r *Registry) GetOrRegister(model any) (*TableMetadata, error)
func (r *Registry) GetByName(name string) (*TableMetadata, error)
```

`GetOrRegister` takes `any`, so unwrap pointers and reject a non-struct with an
error rather than a panic — course 08's `Kind` loop. Then write two tests:

1. **One parse under contention.** Count parses with an `atomic.Int64`, release
   100 goroutines at the same type, assert the count is exactly 1.
2. **Distinct pointers.** Collect what every goroutine got back and assert there
   is exactly one unique pointer.

Then write the version *without* the inner check and run the tests repeatedly.
Be ready for an uncomfortable result.

```bash
go test -race ./...
```

<details>
<summary>Check yourself</summary>

```go
func (r *Registry) GetOrRegister(model any) (*TableMetadata, error) {
	t := reflect.TypeOf(model)
	for t != nil && t.Kind() == reflect.Pointer {
		t = t.Elem()
	}
	if t == nil || t.Kind() != reflect.Struct {
		return nil, fmt.Errorf("registry: want a struct, got %v", t)
	}

	r.mu.RLock()
	got, ok := r.tables[t]
	r.mu.RUnlock()
	if ok {
		return got, nil
	}

	r.mu.Lock()
	defer r.mu.Unlock()
	if got, ok := r.tables[t]; ok {
		return got, nil
	}

	meta, err := r.parser.Parse(t)
	if err != nil {
		return nil, err
	}
	r.tables[t] = meta
	r.names[meta.Name] = meta
	return meta, nil
}
```

**The validation happens before any lock.** Unwrapping a pointer and checking
`Kind` needs no lock, and doing it first keeps the critical sections as short as
the benchmark says they should be.

**`parse` runs while holding the write lock.** That is 500 nanoseconds of
exclusive access, which feels wrong until you count how often it happens: once
per model. Parsing outside the lock and then taking it would mean two goroutines
could both parse — the same wasted work, plus more code.

**The error return is why this is not `sync.Once` per type.** `Once` cannot fail,
so a parse error would have to be stored and replayed, and you would be writing
this anyway with worse ergonomics.

**Both tests pass most of the time against the broken version.** With the inner
check removed, I measured the bug surfacing in **1 run out of 12**, and adding a
two-millisecond sleep inside `parse` to widen the window only moved it to 1 in 8.
The parse count and the pointer count also move together — 2 parses always meant
2 pointers — so neither assertion is more sensitive than the other.

That is the real lesson of this section, and it is not a comfortable one. You
cannot test your way to confidence about this bug. A hundred goroutines released
at once still mostly serialise, because the first one through finishes before the
scheduler has run the rest, and no amount of sleeping fixes that reliably.

Keep both tests — they document the invariant and they will occasionally catch a
regression. But the reason to write the second check is that it is *correct*, not
that a test demanded it. This is the category of bug you prevent by reasoning
about the window, and the only tool that helps afterwards is the
`goroutineleak`-style profile or a reader who knows the pattern.

</details>

## Next

The query builder. You have metadata keyed by type and a generic entry point
from course 06 — next they meet, and `Select[User](qb)` starts producing real
SQL with real placeholders.
