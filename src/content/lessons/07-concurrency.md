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

Start by breaking something. Put this in your `greet` module:

```go
package main

import (
	"fmt"
	"sync"
)

func main() {
	count := 0
	var wg sync.WaitGroup
	for range 1000 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			count++
		}()
	}
	wg.Wait()
	fmt.Println("count =", count)
}
```

A thousand goroutines, each adding one. **Predict the output, then run it six
times.**

```text
count = 944
count = 884
count = 951
count = 958
count = 964
count = 919
```

Never 1000. Never the same twice. **And it never crashes** — no error, no
warning, just a quietly wrong number that would be a quietly wrong invoice in
production.

That is a data race, and the rest of this course is about seeing them and fixing
them.

## Goroutines

Put `go` in front of a call and it runs concurrently. `sync.WaitGroup` counts
them: `Add` before starting, `Done` when finished (deferred, so it runs even on
panic), `Wait` blocks until zero.

Since **Go 1.25** there is a shorthand that does all three:

```go
wg.Go(func() {
	results[i] = i * i
})
```

`wg.Go` handles the `Add`, starts the goroutine, and defers the `Done`. Prefer it
for new code — the three-line form is what you will meet in existing codebases,
and forgetting the `Done` is a classic way to hang forever. `go fix` will convert
the old form for you.

Goroutines are genuinely cheap. Try it — start a hundred thousand:

```go
var wg sync.WaitGroup
for range 100_000 {
	wg.Add(1)
	go func() { defer wg.Done(); time.Sleep(time.Second) }()
}
fmt.Println("live goroutines:", runtime.NumGoroutine())
```

```text
live goroutines: 100001
heap in use:     61.5 MB for all of them
```

About 600 bytes each. An OS thread costs a megabyte or more, which is why Go
servers run a goroutine per request and no thread pool.

One thing worth knowing if you read older Go material. Try this:

```go
for i := range 5 {
	wg.Add(1)
	go func() { defer wg.Done(); results[i] = i * i }()
}
```

```text
[0 1 4 9 16]
```

Each goroutine saw its own `i`. That was a famous bug until **Go 1.22** gave each
iteration its own copy of the loop variable. The old workaround
`go func(i int){...}(i)` is no longer needed — if a tutorial tells you to write
it, the tutorial is out of date.

## Find the race

Go back to your broken counter and add one flag:

```bash
go run -race .
```

```text
==================
WARNING: DATA RACE
Write at 0x00c0001a20f0 by goroutine 7:
  main.main.func1()
      /.../main.go:15 +0x68

Previous write at 0x00c0001a20f0 by goroutine 19:
  main.main.func1()
      /.../main.go:15 +0x78
```

It names both goroutines, the memory address, and the exact line each was on.

**The race detector has essentially no false positives.** If it reports
something, it is real. It only sees code that actually runs, so it is only as
good as your tests — which is why every course from here uses
`go test -race ./...`, and why the ORM's own suite does.

Now try a different broken thing — a shared map:

```go
type Registry struct {
	tables map[string]int
}

func (r *Registry) Set(k string, v int) { r.tables[k] = v }
```

Call `Set` from a hundred goroutines and run it **without** `-race`:

```text
fatal error: concurrent map writes
```

Maps refuse to corrupt themselves; the runtime crashes instead. **That crash is
the lucky outcome.** Your counter got no such warning — it just lied. Which of
the two failure modes you get depends entirely on the type, so do not rely on
noticing.

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

Clean under `-race`. **Go fix your counter the same way** before reading on —
then confirm it prints 1000 six times running.

**`sync.RWMutex` is two locks in one.** `Lock` is exclusive: one writer, no
readers. `RLock` is shared: any number of readers at once, no writer. Use it when
reads heavily outnumber writes; otherwise plain `sync.Mutex` is simpler.

Three rules worth internalising:

- **`defer` the unlock**, on the line after the lock. An early return that skips
  `Unlock` deadlocks the program; the deferred form makes that impossible.
- **Never copy a struct containing a mutex.** Course 03's `go vet` warning —
  *"passes lock by value"* — is exactly this. A copied mutex protects nothing.
- **Put the lock directly above the fields it guards.** It is the only
  documentation of what the lock actually covers.

### Channels or mutexes?

The proverb is *"do not communicate by sharing memory; share memory by
communicating."* Good advice, frequently over-applied.

Channels **transfer ownership** of a value between goroutines. A mutex
**protects shared state in place**. A cache that many readers hit is shared
state, so it takes a mutex — routing every read through a channel and a goroutine
would be slower and much harder to follow. Use whichever reads more simply. That
is the real Go position, not the bumper sticker.

## Channels

A channel is a typed pipe. **Unbuffered** channels are synchronisation points —
a send blocks until someone receives:

```go
ch := make(chan string)
go func() { ch <- "sent" }()
fmt.Println(<-ch)
```

**Buffered** channels accept up to their capacity without a receiver:

```go
buffered := make(chan int, 3)
buffered <- 1
buffered <- 2
fmt.Println(len(buffered), cap(buffered))
```

```text
2 3
```

**Your turn: deadlock on purpose.** Remove the buffer and send without a
receiver:

```go
ch := make(chan int)
ch <- 1
```

```text
fatal error: all goroutines are asleep - deadlock!
```

The runtime noticed every goroutine was blocked forever. Useful — but note it
only fires when *all* of them are stuck. A leak in one corner of a live server
keeps the process alive and healthy-looking while goroutines pile up.

**Go 1.27 added a profile for exactly that.** Leak three goroutines on a channel
nobody will ever send to, then ask for them:

```go
p := pprof.Lookup("goroutineleak")
p.WriteTo(os.Stdout, 1)
```

```text
goroutineleak profile: total 3
3 @ 0x102d93f18 0x102d2f0b0 0x102d2ec34
#	main.leak.func1+0x23	.../main.go:14
```

Three leaks, and the exact line each one is blocked on. It works by asking the
garbage collector which blocking primitives have become unreachable — so a
goroutine parked on a channel that no live code can still reach is provably
stuck. It cannot catch everything (a channel held in a global stays reachable, so
that leak is invisible to it), but it turns a whole class of invisible bug into a
named line number. The same data is served at `/debug/pprof/goroutineleak`.

## select and context

`select` waits on several channel operations and takes whichever is ready first.
Its commonest use is a timeout, paired with `context.Context`:

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

Run it with a deadline shorter than the work:

```go
ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
defer cancel()
```

```text
fast query: completed
slow query: context deadline exceeded
```

`ctx.Err()` returns a sentinel you can test with `errors.Is` — course 04's
machinery, reused.

Two rules:

- **Always `defer cancel()`**, even on success. It releases the timer; skipping
  it leaks until the deadline passes.
- **Pass it, never store it.** `ctx` is the first argument, named `ctx`, never a
  struct field. It describes one call's lifetime, not an object's.

You have already seen this in the ORM's signatures — `All(ctx)`, `Exec(ctx)`.
Now you know what it buys: cancel the HTTP request and the query it triggered
stops too.

## What you just rebuilt

Course 08 shows that reflection is expensive, so the ORM reads a struct's shape
once and caches it. That cache is read by every query, from every goroutine. The
real struct:

```go
type Registry struct {
	mu     sync.RWMutex
	parser *schema.Parser
	tables map[reflect.Type]*schema.TableMetadata
	names  map[string]*schema.TableMetadata
}
```

Two maps, one lock, `mu` directly above what it guards — the thing you just
built.

It is an `RWMutex` rather than a `Mutex` for a measurable reason: the registry
takes **eight read locks to three write locks**. Writes happen once per model,
the first time it is seen; reads happen on every query, forever. Readers must not
block each other or the lock becomes the bottleneck of the whole ORM.

Without it you get `fatal error: concurrent map writes` under load — in
production, not in your tests, because a single-threaded test never triggers it.

## Build something

Build the cache you will need in course 11:

```go
type Cache[K comparable, V any] struct { /* ... */ }

func (c *Cache[K, V]) Get(key K) (V, bool)
func (c *Cache[K, V]) Set(key K, value V)
```

Generic, from course 06. **Write the unlocked version first**, hammer it from a
hundred goroutines in a test, and watch `-race` fail. Then add the lock.

```bash
go test ./...        # may well pass
go test -race ./...  # will not
```

If the test passes without `-race` and fails with it, you have understood this
course.

<details>
<summary>Check yourself</summary>

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

`NewCache` exists because the zero value is unusable — the map would be nil, and
course 02 established that writing to a nil map panics. When a type needs setup,
give it a constructor.

`K comparable` is required exactly as in course 06: map keys must be comparable.

The test asserts on one key, not on `len` or on ordering. With a hundred
goroutines racing, only the final state is deterministic — asserting on timing
produces a test that fails one run in fifty, which is worse than no test.

</details>

## Next

Reflection: how a program inspects a type it has never seen, reads the tags on
its fields, and builds a schema from them. It is the last tool before you start
building the ORM — and the reason the registry above has to exist.
