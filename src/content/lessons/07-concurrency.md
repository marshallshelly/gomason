---
title: "Goroutines and concurrency"
part: tools
order: 7
summary: "Goroutines, channels, select, and the mutex that guards a shared cache."
topics:
  - goroutines
  - channels
  - select
  - sync.RWMutex
  - context
minutes: 50
draft: false
---

Concurrency is the feature Go is famous for and the one most likely to hurt you.
The syntax is three keywords. The hard part is that a program can be correct
every time you run it and still be broken.

This course ends with a concurrent-safe cache, because that is exactly what the
ORM's registry is in course 11.

## Goroutines

Put `go` in front of a call and it runs concurrently:

```go
go doSomething()
```

The calling function does not wait. Which raises the first question: how do you
know when it finished? `sync.WaitGroup` counts:

```go
var wg sync.WaitGroup
results := make([]int, 5)

for i := range 5 {
	wg.Add(1)
	go func() {
		defer wg.Done()
		results[i] = i * i
	}()
}
wg.Wait()
```

```text
each goroutine saw its own i: [0 1 4 9 16]
```

`Add` before starting, `Done` when finished — deferred, so it runs even on
panic — and `Wait` blocks until the count reaches zero.

If you have read older Go material you may expect that loop to be a bug, with
every goroutine seeing the final value of `i`. It was, until Go 1.22 gave each
iteration its own copy of the loop variable. The old workaround
(`go func(i int){...}(i)`) is no longer needed, and tutorials still teaching it
are out of date.

**Goroutines are genuinely cheap.** Not "lightweight thread" marketing — cheap:

```text
live goroutines: 100001
heap in use:     61.5 MB for all of them
after they exit: 1
```

A hundred thousand concurrent goroutines in about 60 MB, roughly 600 bytes each.
An OS thread costs a megabyte or more of stack. This is why Go servers handle a
goroutine per request without a thread pool.

## Channels

A channel is a typed pipe. **Unbuffered** channels are synchronisation points —
a send blocks until someone receives:

```go
unbuffered := make(chan string)
go func() { unbuffered <- "sent" }()
fmt.Println("unbuffered receive:", <-unbuffered)
```

```text
unbuffered receive: sent
```

That handoff *is* the synchronisation: the sender knows the receiver arrived.

**Buffered** channels accept up to their capacity without a receiver:

```go
buffered := make(chan int, 3)
buffered <- 1
buffered <- 2
```

```text
buffered: len=2 cap=3 (send did not block)
```

Get it wrong and Go tells you at runtime, which is friendlier than it sounds:

```go
ch := make(chan int)
ch <- 1
```

```text
fatal error: all goroutines are asleep - deadlock!
```

The runtime noticed every goroutine was blocked forever and stopped. This only
works when *all* goroutines are stuck — a leak in one corner of a live server
will not be caught.

## select

`select` waits on several channel operations and takes whichever is ready first.
Its most common use is a timeout:

```go
func slowQuery(ctx context.Context, d time.Duration) (string, error) {
	select {
	case <-time.After(d):
		return "rows", nil
	case <-ctx.Done():
		return "", ctx.Err()
	}
}
```

Whichever channel fires first wins; the other case is simply not taken.

## The bug you cannot see

Here is a cache, of the kind any ORM needs:

```go
type Registry struct {
	tables map[string]int
}

func (r *Registry) Set(k string, v int) { r.tables[k] = v }
func (r *Registry) Get(k string) int    { return r.tables[k] }
```

Call it from a hundred goroutines and Go refuses outright:

```text
fatal error: concurrent map writes
```

Maps are deliberately not safe for concurrent use, and the runtime crashes
rather than corrupt itself. But that crash is the *lucky* outcome. Races on
other types produce no error at all — just a wrong value, sometimes, on a
machine you do not own.

Which is why the race detector exists. Add `-race`:

```bash
go run -race .
go test -race ./...
```

```text
==================
WARNING: DATA RACE
Write at 0x00c0001a20f0 by goroutine 7:
  main.(*Registry).Set()
      /.../main.go:12 +0xe0

Previous write at 0x00c0001a20f0 by goroutine 19:
  main.(*Registry).Set()
      /.../main.go:12 +0xe0
```

It names both goroutines, the address, and the exact line each was on. It has
essentially no false positives: if `-race` reports something, it is real.

It only detects races on code paths that actually execute, so it is only as good
as your tests. That is a large part of why every course from here runs
`go test -race ./...` — and why the ORM's own test suite does.

## Mutexes

The fix is a lock:

```go
type Registry struct {
	mu     sync.RWMutex
	tables map[string]int
}

func (r *Registry) Set(k string, v int) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.tables[k] = v
}

func (r *Registry) Get(k string) (int, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	v, ok := r.tables[k]
	return v, ok
}
```

```text
done, len = 100
```

Clean under `-race`.

**`sync.RWMutex` has two locks in one.** `Lock` is exclusive: one writer, no
readers. `RLock` is shared: any number of readers at once, but no writer. Use it
when reads heavily outnumber writes — otherwise a plain `sync.Mutex` is simpler
and marginally faster.

Three rules worth internalising:

- **`defer` the unlock**, on the line after the lock. An early return that skips
  `Unlock` deadlocks the whole program, and the deferred form makes that
  impossible.
- **Never copy a struct containing a mutex.** Course 03 showed `go vet` catching
  exactly this: *"passes lock by value"*. A copied mutex protects nothing.
- **The lock and the data it guards belong together.** Putting `mu` immediately
  above the fields it protects is a convention worth following — it is the only
  documentation of what the lock covers.

### Channels or mutexes?

The proverb is *"do not communicate by sharing memory; share memory by
communicating."* It is good advice and frequently over-applied.

Channels are for **transferring ownership** of a value between goroutines, and
for coordination. A mutex is for **protecting shared state in place**. A cache
that many readers hit is shared state, so it takes a mutex — routing every read
through a channel and a goroutine would be slower and much harder to follow.

Use whichever makes the code simpler to read. That is the actual Go position,
not the bumper sticker.

## Context

`context.Context` carries cancellation and deadlines across API boundaries. It
is the first parameter of any function that might block:

```go
ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
defer cancel()
```

```text
fast query: completed
slow query: context deadline exceeded (deadline exceeded? true)
```

The fast call finishes; the slow one is cut off. Note that `ctx.Err()` returns a
sentinel you can test with `errors.Is` — course 04's machinery, reused.

Two rules:

- **Always `defer cancel()`.** Even when the operation completes, cancel
  releases the timer. Skipping it leaks until the deadline passes. `go vet`
  catches the obvious cases.
- **Pass it, never store it.** `ctx` is the first argument, named `ctx`, never a
  struct field. It describes one call's lifetime, not an object's.

You have already seen this in the ORM's signatures — `All(ctx)`, `Exec(ctx)` —
and now you know what it is for: cancel the HTTP request, and the query it
triggered stops too.

## Why this matters for the ORM

Course 08 shows that reflection is expensive, so the ORM reads a struct's shape
**once** and caches it. That cache is read by every query, from every goroutine
handling every request. Here is the real struct:

```go
type Registry struct {
	mu     sync.RWMutex
	parser *schema.Parser
	tables map[reflect.Type]*schema.TableMetadata
	names  map[string]*schema.TableMetadata
}
```

Two maps, one lock, `mu` sitting directly above what it guards.

It is an `RWMutex` rather than a `Mutex` for a measurable reason: the registry
takes **eight read locks to three write locks**. Writes happen once per model,
the first time it is seen. Reads happen on every single query, forever. Readers
must not block each other, or the lock becomes the bottleneck of the whole ORM.

Without it, you get `fatal error: concurrent map writes` under load — in
production, not in your tests, because a single-threaded test never triggers it.

## Exercise

Build the cache you will need in course 11:

```go
type Cache[K comparable, V any] struct {
	// ...
}

func (c *Cache[K, V]) Get(key K) (V, bool)
func (c *Cache[K, V]) Set(key K, value V)
```

Generic, from course 06. Then write a test that hammers it from many goroutines
at once and run it with the detector:

```bash
cd greet
go test -race ./...
```

Write the unlocked version first and watch `-race` fail. Then add the lock. If
the test passes without `-race` but fails with it, that is the whole point of
this course.

<details>
<summary>One way to do it</summary>

```go
type Cache[K comparable, V any] struct {
	mu    sync.RWMutex
	items map[K]V
}

func NewCache[K comparable, V any]() *Cache[K, V] {
	return &Cache[K, V]{items: make(map[K]V)}
}

func (c *Cache[K, V]) Get(key K) (V, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	v, ok := c.items[key]
	return v, ok
}

func (c *Cache[K, V]) Set(key K, value V) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.items[key] = value
}
```

```go
func TestCacheConcurrent(t *testing.T) {
	c := NewCache[int, string]()
	var wg sync.WaitGroup

	for i := range 100 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			c.Set(i, fmt.Sprint(i))
			c.Get(i % 10)
		}()
	}
	wg.Wait()

	if v, ok := c.Get(7); !ok || v != "7" {
		t.Errorf("Get(7) = %q, %t", v, ok)
	}
}
```

`NewCache` exists because the zero value is not usable — the map would be nil,
and course 02 established that writing to a nil map panics. When a type needs
setup, give it a constructor and say so.

`K comparable` is required, exactly as in course 06: map keys must be
comparable.

Note the test does not assert on ordering or on `len`. With a hundred goroutines
racing, only the final state is deterministic. Asserting on timing produces
tests that fail one run in fifty, which is worse than no test.

</details>

## Next

Reflection: how a program inspects a type it has never seen, reads the tags on
its fields, and builds a schema from them. It is the last tool before you start
building the ORM itself — and the reason the registry above needs to exist.
