---
title: "Generics"
part: tools
order: 6
summary: "Type parameters and constraints, and the difference between []any and []User."
topics:
  - type parameters
  - constraints
  - type inference
  - when not to use generics
minutes: 45
draft: false
---

Interfaces let one function work with many types, provided those types share
methods. Generics let one function work with many types that share **nothing** —
and still hand you back a real, typed result.

This is the course that makes the promise on the front page literal. By the end
you will understand exactly why `Select[User](qb)` gives you `[]User` and not
`[]any`.

Generics arrived in Go 1.18. They are also the feature most commonly overused,
so the last section is about when *not* to reach for them.

## The problem

Before generics, a function that worked on any slice returned `any`:

```go
func FirstAny(items []any) any {
	if len(items) == 0 {
		return nil
	}
	return items[0]
}
```

The caller gets back something they have to assert:

```text
FirstAny -> Ada (type string) — needs a cast to use
```

The type is *there* at runtime, but the compiler has forgotten it. Every caller
writes `s := raw.(string)`, and every caller can get that wrong — a mistake the
compiler cannot catch, because as far as it knows the value is `any`.

The alternative was writing `FirstString`, `FirstInt`, `FirstUser` — the same
five lines, once per type.

## Type parameters

A generic function declares its type parameters in square brackets before the
arguments:

```go
func First[T any](items []T) (T, bool) {
	if len(items) == 0 {
		var zero T
		return zero, false
	}
	return items[0], true
}
```

`T` is a placeholder for a type the caller supplies. `any` is its **constraint**
— the set of types allowed. `any` means no restriction.

```text
First    -> Ada (type string) ok=true — already a string
First    -> 3 (type int) — same function, no cast
empty    -> 0 (type float64) ok=false — the zero value of T
```

One function, three types, no assertions. The compiler knows `First(names)`
returns a `string`, so misusing it is a compile error rather than a runtime
panic.

Note `var zero T`. You cannot write `return nil` — `T` might be `int`, where nil
is meaningless. `var zero T` gives you the zero value for whatever `T` turns out
to be, which is course 02 paying off: every type has one, so this always works.

## Constraints

`any` allows every type, which means you can do almost nothing with the value —
you cannot add it, compare it, or call methods on it. Constraints widen what
you are allowed to do by narrowing what can be passed.

**`comparable`** permits `==` and `!=`:

```go
func Contains[T comparable](items []T, want T) bool {
	for _, v := range items {
		if v == want {
			return true
		}
	}
	return false
}
```

This is the same comparability from course 03 — so `Contains` accepts a struct
of ints, and rejects a struct containing a slice, at compile time.

**A type set** lists the permitted underlying types:

```go
type Number interface {
	~int | ~int64 | ~float64
}

func Sum[T Number](items []T) T {
	var total T
	for _, v := range items {
		total += v
	}
	return total
}
```

An interface used this way is a constraint, not a runtime type — you can't
declare a variable of type `Number`. It exists only to answer "may this type be
substituted for `T`?"

### The tilde

That `~` matters:

```go
type Celsius float64
```

```text
Sum ints     6
Sum floats   4
Sum Celsius  22 <- named type, thanks to ~
```

`~float64` means "any type whose **underlying** type is float64", which includes
`Celsius`. Plain `float64` means that exact type and nothing else:

```text
./main.go:31:33: Celsius does not satisfy Number
(possibly missing ~ for float64 in Number)
```

The compiler even names the fix. Since Go code defines named types constantly —
`type Celsius float64`, `type UserID int` — you almost always want `~`.

## Type inference

You rarely write the type parameter explicitly. Go infers it from the arguments:

```go
names := Map(users, func(u User) string { return u.Name })
lens  := Map(names, func(s string) int { return len(s) })
```

```text
inferred from args: []string [Ada Alan]
inferred again:     []int [3 4]
```

`Map[In, Out any]` has two type parameters and both are inferred — `In` from the
slice, `Out` from the function's return type.

Inference only works when there is something to infer *from*. A function with no
arguments of type `T` cannot be inferred:

```text
./main.go:26:12: in call to Empty, cannot infer T
```

You supply it by hand: `Empty[User]()`. Remember that shape — it is exactly what
the ORM does.

## Methods cannot have type parameters

This limitation shapes every generic API in Go, so it is worth meeting directly:

```go
func (db *DB) Select[T any]() []T { return nil }
```

```text
./main.go:5:21: syntax error: method must have no type parameters
```

A method may **use** its receiver's type parameters, but it cannot introduce its
own. So `db.Select[User]()` is not expressible, no matter how much you want it.

The workaround is a generic **function** that takes the receiver and returns a
generic **struct**:

```go
type Query[T any] struct {
	db    *DB
	limit int
}

func Select[T any](db *DB) *Query[T] {
	return &Query[T]{db: db}
}

func (q *Query[T]) Limit(n int) *Query[T] {
	q.limit = n
	return q
}

func (q *Query[T]) All() []T {
	return make([]T, 0, q.limit)
}
```

```go
users := Select[User](db).Limit(10).All()
```

```text
[]main.User with cap 10
```

The type parameter lives on the **struct**. Once `Select[User]` has produced a
`*Query[User]`, every method on it can say `T` freely — `Limit` returns
`*Query[T]` so the chain keeps its type, and `All` returns `[]T`.

## When not to use generics

Generics are the most over-applied feature in modern Go. Some honest guidance:

- **One concrete type? Don't.** If only `[]User` will ever be passed, write it
  for `User`. You can generalise later; the change is mechanical.
- **Two or three near-copies? Probably still don't.** The Go proverb is *"a
  little copying is better than a little dependency."* Duplication is cheap to
  read; a clever constraint is not.
- **Methods differ per type? Use an interface.** Generics are for code that is
  identical across types. Interfaces are for behaviour that differs. Reaching
  for generics where an interface belongs produces constraint hierarchies that
  read like another language.
- **Do use them** for containers and operations that are genuinely
  type-independent — a slice helper, a cache, a result set — and where losing
  the type would push casts onto every caller.

That last clause is the real test: **who pays if the type is erased?** If the
answer is "every caller, forever", generics earn their place.

## Why this matters for the ORM

Here is the actual signature from the ORM you are building:

```go
func Select[T any](d *DB) *SelectQuery[T]

type SelectQuery[T any] struct { /* ... */ }

func (q *SelectQuery[T]) Where(condition Condition) *SelectQuery[T]
func (q *SelectQuery[T]) All(ctx context.Context) ([]T, error)
```

That is the exact pattern above, and it is not a style choice — **the language
forces it.** `qb.Select[User]()` cannot exist, so the entry point is a package
function and the type parameter rides on the struct from there.

The payoff is the last line. `All` returns `([]T, error)`, so:

```go
users, err := builder.Select[User](qb).Where(...).All(ctx)
```

gives you a `[]User`. No `any`, no type assertion, no reflection at the call
site. Rename a field and the compiler finds every use.

Reflection still happens — course 08 uses it to read struct tags and map columns
to fields — but it happens *inside* the ORM, once, and the generic signature
keeps it there. The caller only ever sees their own type.

And `Select[User]` must be written explicitly, because there is no argument of
type `User` to infer from — precisely the `Empty[User]()` case above.

## Exercise

Write two generic helpers you will genuinely reuse:

```go
func Keys[K comparable, V any](m map[K]V) []K
func Filter[T any](items []T, keep func(T) bool) []T
```

`Keys` returns a map's keys. `Filter` returns only the items for which `keep`
returns true.

Then answer this with a test: what constraint does `Keys` need on `K`, and why
can `V` be `any`?

```bash
cd greet
go test ./...
```

Map iteration order is randomised — course 02 — so sort before comparing, or
compare as a set.

<details>
<summary>One way to do it</summary>

```go
func Keys[K comparable, V any](m map[K]V) []K {
	out := make([]K, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}

func Filter[T any](items []T, keep func(T) bool) []T {
	out := make([]T, 0, len(items))
	for _, v := range items {
		if keep(v) {
			out = append(out, v)
		}
	}
	return out
}
```

```go
func TestKeys(t *testing.T) {
	got := Keys(map[string]int{"b": 2, "a": 1})
	sort.Strings(got)
	want := []string{"a", "b"}
	if !slices.Equal(got, want) {
		t.Errorf("Keys() = %v, want %v", got, want)
	}
}
```

**`K` must be `comparable`** — not because `Keys` compares anything, but because
Go requires every map key type to be comparable. The constraint on the type
parameter has to be at least as strict as the constraint on `map[K]V`, or the
type would not be a legal map key.

**`V` can be `any`** because the function never touches the values. Constrain
only what you actually use; a tighter constraint than necessary just rejects
callers for no reason.

`slices.Equal` is in the standard library from Go 1.21 and saves a loop.

The standard library also has close relatives of both helpers, and the
differences are instructive. `maps.Keys` returns an **iterator**, not a slice,
so you compose it:

```go
keys := slices.Sorted(maps.Keys(m))
```

And `slices.DeleteFunc` is `Filter` inverted — it removes what matches, and it
modifies the slice in place rather than returning a new one.

So the real lesson is smaller than "don't write helpers": **check the standard
library first, then read its signature carefully.** Close is not the same as
equivalent.

</details>

## Next

You can write one function that serves many types. Next: running many things at
once. Goroutines, channels, and the mutex that will guard the ORM's metadata
cache in course 11.
