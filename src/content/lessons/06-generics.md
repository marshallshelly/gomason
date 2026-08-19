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

Interfaces let one function work with many types that share methods. Generics let
one function work with many types that share **nothing** — and still hand you
back a real, typed result.

This is the course that makes the front page literal. By the end you will have
built, by hand, the exact shape that makes `Select[User](db)` return `[]User`
instead of `[]any`.

## The problem, felt

Write the pre-generics version and use it:

```go
func FirstAny(items []any) any {
	if len(items) == 0 {
		return nil
	}
	return items[0]
}

func main() {
	names := []any{"Ada", "Alan"}
	got := FirstAny(names)
	fmt.Println(got + "!")
}
```

**Predict: does that compile?**

```text
invalid operation: got + "!" (mismatched types any and untyped string)
```

The value *is* a string at runtime, but the compiler has forgotten. Every caller
must write `got.(string)`, and every caller can get that wrong — a runtime panic
the compiler cannot help with. The alternative was writing `FirstString`,
`FirstInt`, `FirstUser`: the same five lines forever.

## Type parameters

Declare them in square brackets before the arguments:

```go
func First[T any](items []T) (T, bool) {
	if len(items) == 0 {
		var zero T
		return zero, false
	}
	return items[0], true
}
```

Call it with three different types and print what you get:

```go
name, _ := First([]string{"Ada", "Alan"})
n, _ := First([]int{3, 4})
_, ok := First([]float64{})
fmt.Printf("%q %d %t\n", name, n, ok)
```

```text
"Ada" 3 false
```

No assertions anywhere, and `name + "!"` now compiles. `T` is a placeholder the
caller fills in; `any` is its **constraint**, meaning no restriction.

Note `var zero T`. You cannot `return nil` — `T` might be `int`. Every type has a
zero value (course 02), so `var zero T` always works. That is the kind of thing
Go's design decisions buy you three courses later.

## Constraints

`any` allows every type, which means you can do almost nothing with the value.
Constraints widen what you may do by narrowing what may be passed.

**`comparable`** permits `==`:

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

Same comparability as course 03 — try passing a slice of structs-containing-slices
and the compiler stops you.

**A type set** lists permitted underlying types:

```go
type Number interface {
	int | float64
}

func Sum[T Number](items []T) T {
	var total T
	for _, v := range items {
		total += v
	}
	return total
}
```

Now the prediction. You have a named type:

```go
type Celsius float64

fmt.Println(Sum([]Celsius{20, 2}))
```

**`Celsius` is a float64. Does this compile?**

```text
./main.go:17:30: Celsius does not satisfy Number
(possibly missing ~ for float64 in Number)
```

No — and the compiler tells you the fix. Change the constraint to `~int | ~float64`:

```text
22
```

**`~float64` means "any type whose underlying type is float64"**, which includes
`Celsius`. Plain `float64` means that exact type and nothing else. Since Go code
declares named types constantly — `type UserID int`, `type Celsius float64` — you
almost always want the tilde.

## Type inference

You rarely write the type parameter. Go infers it from the arguments:

```go
names := Map(users, func(u User) string { return u.Name })
lens := Map(names, func(s string) int { return len(s) })
```

Both type parameters of `Map[In, Out any]` are inferred — `In` from the slice,
`Out` from the function's return type.

Inference needs something to infer *from*. **Predict what happens here:**

```go
func Empty[T any]() []T { return nil }

func useIt() { _ = Empty() }
```

```text
./bad.go:5:25: in call to Empty, cannot infer T
```

You supply it by hand: `Empty[User]()`. Hold on to that shape — it is exactly
what `Select[User](db)` is doing, and why you must always name the type there.

## Your turn: the wall you will hit

Try to write the API you actually want:

```go
type DB struct{}

func (db *DB) Select[T any]() []T { return nil }
```

**Predict the error.**

```text
./bad.go:5:21: syntax error: method must have no type parameters
```

A method may **use** its receiver's type parameters but cannot introduce its own.
So `db.Select[User]()` is not expressible in Go, at all.

Work around it: put the type parameter on a **struct**, and use a package-level
**function** to construct it. Build this yourself before reading on — a
`Query[T]` type with a `Limit` method that chains, and an `All` method returning
`[]T`.

<details>
<summary>Compare with yours</summary>

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
fmt.Printf("%T with cap %d\n", users, cap(users))
```

```text
[]main.User with cap 10
```

The type parameter lives on the struct. Once `Select[User]` has produced a
`*Query[User]`, every method may say `T` freely — `Limit` returns `*Query[T]` so
the chain keeps its type, and `All` returns `[]T`.

Pointer receivers, from course 03: value receivers here would discard every
clause.

</details>

## When not to use generics

Generics are the most over-applied feature in modern Go:

- **One concrete type? Don't.** Write it for `User`. Generalising later is
  mechanical.
- **Two or three near-copies? Probably still don't.** *"A little copying is
  better than a little dependency."* Duplication is cheap to read; a clever
  constraint is not.
- **Methods differ per type? Use an interface.** Generics are for code that is
  *identical* across types; interfaces are for behaviour that *differs*.
- **Do use them** for containers and genuinely type-independent operations — a
  slice helper, a cache, a result set.

The real test: **who pays if the type is erased?** If the answer is "every
caller, forever", generics earn their place. That is precisely the ORM's case.

## What you just built

The real signature from the ORM:

```go
func Select[T any](d *DB) *SelectQuery[T]

func (q *SelectQuery[T]) Where(condition Condition) *SelectQuery[T]
func (q *SelectQuery[T]) All(ctx context.Context) ([]T, error)
```

That is your `Query[T]`, and it is not a style choice — **the language forces
it**, as you proved with the compile error above.

The payoff is the last line: `All` returns `([]T, error)`, so

```go
users, err := builder.Select[User](qb).Where(...).All(ctx)
```

gives you a `[]User`. Reflection still happens — course 08 uses it to map
columns to fields — but it happens *inside*, once, and the generic signature
keeps it there.

## Build something

Two helpers you will genuinely reuse:

```go
func Keys[K comparable, V any](m map[K]V) []K
func Filter[T any](items []T, keep func(T) bool) []T
```

Then answer this **with a test**: why must `K` be `comparable` when `Keys` never
compares anything — and why can `V` be `any`?

Map iteration order is not guaranteed (course 02), so sort before comparing.

<details>
<summary>Check yourself</summary>

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

**`K` must be `comparable`** not because `Keys` compares anything, but because Go
requires every map key type to be comparable. The constraint on `T` has to be at
least as strict as the one on `map[K]V`.

**`V` can be `any`** because the function never touches the values. Constrain
only what you use — a tighter constraint than necessary just rejects callers for
no reason.

Now look at what the standard library already has, and read the signatures
carefully. `maps.Keys` returns an **iterator**, not a slice, so you compose it:

```go
keys := slices.Sorted(maps.Keys(m))
```

And `slices.DeleteFunc` is `Filter` inverted — it removes what matches, in place.

The lesson is not "don't write helpers". It is **check the standard library
first, then read its signature**, because close is not the same as equivalent.

</details>

## Next

Concurrency. Goroutines, channels, and the mutex that will guard the ORM's
metadata cache — plus the detector that finds the bugs you cannot see.
