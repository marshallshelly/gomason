---
title: "Interfaces"
part: tools
order: 5
summary: "Implicit satisfaction, why small interfaces win, and how io.Reader got everywhere."
topics:
  - implicit satisfaction
  - small interfaces
  - io.Reader
  - type assertions
minutes: 40
draft: false
---

Part two starts here. Everything from now on is a tool you will use directly in
the ORM, and this is the load-bearing one: it is what lets a query run against a
connection pool or a transaction without writing the code twice.

An interface is a set of method signatures. Any type with those methods
satisfies it. That is the whole feature — but the word **implicit** is doing an
enormous amount of work.

## Nothing declares that it implements anything

```go
type Stringer interface {
	String() string
}

type ValueGreeter struct{ Name string }

func (g ValueGreeter) String() string { return "value: " + g.Name }
```

`ValueGreeter` now satisfies `Stringer`. There is no `implements` keyword, no
registration, and — critically — **`ValueGreeter` does not import or know about
`Stringer` at all**.

That inversion is the point. In most languages the implementation declares its
interfaces, so the interface has to exist first and the dependency points from
implementation to interface. In Go the *consumer* declares what it needs, and
any pre-existing type can satisfy it retroactively.

The practical consequence: you can define an interface describing exactly what
your function needs, and types from the standard library — written years before
your code — will satisfy it without modification.

## Small interfaces win

The most-used interface in Go has one method:

```go
type Reader interface {
	Read(p []byte) (n int, err error)
}
```

Write a function against `io.Reader` and it works on anything that can produce
bytes:

```go
func CountLines(r io.Reader) (int, error) {
	n := 0
	s := bufio.NewScanner(r)
	for s.Scan() {
		n++
	}
	return n, s.Err()
}
```

```text
strings.Reader -> 3 lines
bytes.Buffer   -> 2 lines
os.File        -> 4 lines
```

One function, three unrelated types — a string in memory, a byte buffer, a file
on disk. Add a network connection, a gzip stream, or an HTTP request body and it
still works. None of those types were written with `CountLines` in mind.

This is why the Go proverb is **"the bigger the interface, the weaker the
abstraction."** A one-method interface is satisfied by almost everything; a
ten-method interface is satisfied by almost nothing, and mocking it in a test is
miserable. When you are tempted to write a large interface, you usually want a
struct.

## The receiver decision comes due

Course 03 said to be consistent about value versus pointer receivers, and that
mixing them causes surprises "when interfaces get involved". Here is the
surprise.

Three of these four combinations work:

```go
var s Stringer

s = ValueGreeter{"a"}    // value type, value receiver
s = &ValueGreeter{"b"}   // pointer,    value receiver
s = &PointerGreeter{"c"} // pointer,    pointer receiver
```

```text
 value type, value receiver  -> value: a
 pointer,    value receiver  -> value: b
 pointer,    pointer receiver-> pointer: c
```

The fourth does not:

```go
var s Stringer = PointerGreeter{"d"}
```

```text
cannot use PointerGreeter{…} (value of struct type PointerGreeter) as Stringer
value in variable declaration: PointerGreeter does not implement Stringer
(method String has pointer receiver)
```

The rule: **a pointer's method set includes both value and pointer receiver
methods; a value's method set includes only value receiver methods.**

Why the asymmetry? Given a pointer, Go can always dereference it to call a value
method. Given a value, it would have to take its address to call a pointer
method — and not every value is addressable, as course 03 showed with map
elements. Rather than have it work sometimes, the language says no.

In practice: **if any method on your type has a pointer receiver, store and pass
`*T`, not `T`.** This is the concrete reason for the consistency rule.

## Asking what is inside

An interface value holds two things: a **type** and a **value**. Sometimes you
need to look.

A type assertion, in the comma-ok form so it does not panic:

```go
if s, ok := v.(string); ok {
	fmt.Println("a string:", s)
}
```

A type switch, when there are several possibilities:

```go
func describe(v any) string {
	switch x := v.(type) {
	case nil:
		return "nil"
	case int:
		return fmt.Sprintf("int %d", x)
	case string:
		return fmt.Sprintf("string %q (len %d)", x, len(x))
	case []int:
		return fmt.Sprintf("slice of %d ints", len(x))
	case error:
		return "an error: " + x.Error()
	default:
		return fmt.Sprintf("something else: %T", x)
	}
}
```

```text
  nil
  int 42
  string "hi" (len 2)
  slice of 2 ints
  an error: boom
  something else: float64
```

Note that `case error` matches anything satisfying the interface, and `x` is
typed differently in each branch — `int` in one, `string` in another. `any` is
an alias for `interface{}`: the empty interface, satisfied by every type.

Reach for these sparingly. A type switch over concrete types is often a sign
that the interface should have had a method instead. `errors.As` from course 04
is a type assertion with the unwrapping built in, and is the right tool for
errors.

## The nil that is not nil

This one has bitten every Go programmer at least once, and it follows directly
from an interface holding *two* words.

```go
type NotFoundError struct{ Key string }

func (e *NotFoundError) Error() string { return "not found: " + e.Key }

func buggy() error {
	var e *NotFoundError
	return e
}
```

```text
buggy():   err == nil ? false
           but the pointer inside IS nil
           errors.As finds it: true, and it is <nil>
```

`err == nil` is **false**. The interface holds the *type* `*NotFoundError` and
the *value* `nil`, and an interface is only equal to `nil` when **both** are
absent. Every caller doing `if err != nil` now takes the error branch, and then
often panics dereferencing a nil pointer.

`go vet` does not catch this. I checked.

The fix is to never return a typed nil pointer as an interface:

```go
func correct() error {
	var e *NotFoundError
	if e != nil {
		return e
	}
	return nil
}
```

```text
correct(): err == nil ? true
```

The practical rule: **declare error-returning functions as returning `error`,
and return the literal `nil`** — never a concrete pointer variable that happens
to be nil. If you find yourself with a `*MyError` you might return, check it
first.

## Accept interfaces, return structs

The most useful piece of Go design advice, and it falls out of everything above:

- **Accept interfaces** in your parameters, so callers can pass whatever they
  have — including a fake in a test.
- **Return concrete types**, so callers get every method, not the subset some
  interface happened to name.

And define the interface **in the package that consumes it**, not the one that
implements it. That is the inversion from the top of this course, used
deliberately: the consumer states its requirement, and implementations satisfy
it without ever importing the consumer.

## Why this matters for the ORM

Here is the real interface from the ORM you are building, in full:

```go
type queryExecutor interface {
	Query(ctx context.Context, sql string, args ...interface{}) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...interface{}) pgx.Row
	Exec(ctx context.Context, sql string, args ...interface{}) (int64, error)
}
```

Three methods. Its entire job is to answer one question: *can I run SQL on this?*

A connection pool can. A transaction can. They are different types from a
third-party library, with no common ancestor, and you cannot add methods to
either — course 03 established you can only define methods on types from your
own package.

Because satisfaction is implicit, the pool satisfies this **as it already is**.
The transaction needs a thin adapter, because its `Exec` returns a different
type:

```go
type txExecutor struct{ tx pgx.Tx }
```

That is the entire abstraction. Every query builder — select, insert, update,
delete — takes a `queryExecutor` and stops caring whether it is talking to a
pool or a transaction.

Without it, the ORM had two parallel copies of every builder: one for the pool,
one for transactions. They drifted, as duplicated code does — the transaction
path silently lost a feature that the pool path had gained, and nobody noticed
until someone went looking. One three-method interface deleted both the
duplication and that entire class of bug.

That is what a good interface buys. Not abstraction for its own sake — one
fewer copy of the truth.

## Exercise

Interfaces are what make code testable without a database, so practise exactly
that shape.

Define a one-method interface and a function that accepts it:

```go
type Fetcher interface {
	Fetch(id int) (string, error)
}

func Describe(f Fetcher, id int) string
```

`Describe` should return `"user: <name>"` on success, and `"unknown user"` if
`Fetch` returns an error.

Then write a test with a **fake** `Fetcher` — a small struct in your test file
that returns whatever you tell it. No database, no network, no mocking library.

```bash
cd greet
go test ./...
```

Write the fake's method with a value receiver and pass the struct directly. If
you get a compile error about method sets, re-read the receiver section above.

<details>
<summary>One way to do it</summary>

```go
func Describe(f Fetcher, id int) string {
	name, err := f.Fetch(id)
	if err != nil {
		return "unknown user"
	}
	return "user: " + name
}
```

```go
type fakeFetcher struct {
	name string
	err  error
}

func (f fakeFetcher) Fetch(int) (string, error) { return f.name, f.err }

func TestDescribe(t *testing.T) {
	tests := []struct {
		name    string
		fetcher fakeFetcher
		want    string
	}{
		{"found", fakeFetcher{name: "Ada"}, "user: Ada"},
		{"missing", fakeFetcher{err: errors.New("nope")}, "unknown user"},
	}

	for _, tt := range tests {
		if got := Describe(tt.fetcher, 1); got != tt.want {
			t.Errorf("%s: Describe() = %q, want %q", tt.name, got, tt.want)
		}
	}
}
```

`Fetch(int)` omits the parameter name — legal, and idiomatic when the
implementation ignores the argument. It documents that the fake does not care
which id you ask for.

The fake is nine lines and lives in the test file. That is the whole point of
accepting an interface: no mocking framework, no dependency injection
container, just a struct that answers the one question your code asks.

This is also your first **table-driven test** — the loop over a slice of cases.
Course 09 makes it the default.

</details>

## Next

Interfaces let one function work with many types, as long as those types share
methods. But how do you write a function that works with `int` and `string` —
types with no methods at all — and still get a typed result back?

That is generics, and it is what makes `Select[User]` return `[]User` instead of
`[]any`.
