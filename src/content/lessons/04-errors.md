---
title: "Errors"
part: foundations
order: 4
summary: "Errors are values. Sentinels, wrapping, errors.Is and errors.As, defer, and when to panic."
topics:
  - error interface
  - wrapping with %w
  - errors.Is and errors.As
  - defer
  - panic and recover
minutes: 40
draft: false
---

Go has no exceptions. A function that can fail returns an error as its last
value, and the caller checks it. That is the whole model, and it is why Go code
has so many `if err != nil` blocks — the failure path is written down instead of
being invisible.

There is exactly one character in this course that decides whether your error
handling works. Let us find it.

## One character

Put this in your `greet` module:

```go
package main

import (
	"errors"
	"fmt"
)

var ErrNotFound = errors.New("not found")

func findV() error { return fmt.Errorf("query users: %v", ErrNotFound) }
func findW() error { return fmt.Errorf("query users: %w", ErrNotFound) }

func main() {
	v, w := findV(), findW()
	fmt.Println(v)
	fmt.Println(w)
	fmt.Println(errors.Is(v, ErrNotFound))
	fmt.Println(errors.Is(w, ErrNotFound))
}
```

**Predict all four lines.** The only difference is `%v` against `%w`.

```text
query users: not found
query users: not found
false
true
```

**Identical messages. Opposite behaviour.** `%v` formats the error into a string
and throws the original away. `%w` *wraps* it — the new error keeps a reference
to the old one, so callers can still ask what it was.

Print the two errors and they look the same, which is why this bug survives code
review and only surfaces when someone's `errors.Is` check quietly stops matching.
**When you add context to an error, use `%w`.**

## The pattern

```go
func Load(id string) (*User, error) {
	row, err := db.Query(id)
	if err != nil {
		return nil, fmt.Errorf("load user %s: %w", id, err)
	}
	return row, nil
}
```

Three conventions worth copying:

- **Error is the last return value**, and on failure the other values are zero.
- **Messages are lowercase and have no trailing punctuation**, because they get
  wrapped into larger sentences: `load user 42: query: connection refused`.
- **Each layer adds what it knows** and nothing more. `Load` knows the user ID;
  it does not know or restate what the database layer already said.

`errors.New` makes a fixed error. `fmt.Errorf` makes one with formatting, and
with `%w`, a chain.

## Sentinels and errors.Is

A **sentinel** is a package-level error value callers can compare against:

```go
var ErrNotFound = errors.New("not found")
```

Never compare with `==` — that breaks the moment anyone wraps it. Use
`errors.Is`, which walks the whole chain:

```go
if errors.Is(err, ErrNotFound) {
	// handle a missing row
}
```

The standard library does this everywhere. Try it:

```go
_, err := os.Open("/nope")
fmt.Println(errors.Is(err, os.ErrNotExist))
```

```text
true
```

## errors.As, for errors that carry data

Sometimes you need more than identity — you need fields. Define a type with an
`Error() string` method and an `Unwrap`:

```go
type QueryError struct {
	SQL string
	Err error
}

func (e *QueryError) Error() string { return fmt.Sprintf("query %q: %v", e.SQL, e.Err) }
func (e *QueryError) Unwrap() error { return e.Err }
```

`errors.As` searches the chain for one of that type and assigns it:

```go
var qe *QueryError
if errors.As(err, &qe) {
	fmt.Println("failing SQL was:", qe.SQL)
}
```

```text
errors.As: true -> SELECT 1
Is through two layers: true
```

`Unwrap` is what keeps the chain intact, so `errors.Is` still finds the sentinel
underneath your custom type. **`Is` asks "which error is this?"; `As` asks "give
me the error as this type."**

The ORM ships exactly this — a `QueryError` carrying the SQL and args that
failed, so a caller can log the statement without the ORM deciding how.

## Your turn

Here is a function whose error handling looks fine and is not:

```go
var ErrEmpty = errors.New("empty input")

func Parse(s string) (string, error) {
	if s == "" {
		return "", fmt.Errorf("parse: %v", ErrEmpty)
	}
	return s, nil
}
```

Write a test asserting `errors.Is(err, ErrEmpty)` is true. Watch it fail. Then
fix the function — the change is one character.

That test is worth keeping: it is the only thing that catches a `%w` silently
becoming a `%v` during a later edit.

## defer

`defer` schedules a call to run when the surrounding function returns, however
it returns:

```go
f, err := os.Open(path)
if err != nil {
	return err
}
defer f.Close()
```

The cleanup sits next to the acquisition, so it cannot be forgotten down some
branch you added later.

**Predict the output** of this:

```go
func deferOrder() {
	for i := range 3 {
		defer fmt.Println("deferred", i)
	}
	fmt.Println("body done")
}
```

```text
body done
deferred 2
deferred 1
deferred 0
```

Deferred calls run **last-in-first-out**, after the body. Now a harder one:

```go
func deferArgs() (result int) {
	x := 1
	defer fmt.Println("x was:", x)
	defer func() { result *= 2 }()
	x = 100
	return 5
}
```

**Predict both the printed `x` and the returned value.**

```text
x was: 1
returned: 10
```

Two separate rules, both surprising:

- **Arguments to a deferred call are evaluated immediately**, at the `defer`
  line. `x` was 1 then, so 1 is what prints — the later assignment is irrelevant.
- **A deferred closure can modify a named return value**, because `return 5` sets
  `result` first and *then* runs the defers. This is how functions recover from a
  panic and still return a sensible error.

That second rule is worth using sparingly. It is invisible at the call site, and
readers will not expect the returned value to differ from the one in the
`return` statement.

## panic and recover

`panic` unwinds the stack and crashes the program. `recover`, inside a deferred
function, stops the unwinding.

You will meet panics from nil map writes (course 02), out-of-range indexes, and
reflection mistakes (course 08). You should almost never *create* one.

The rule: **panic for programmer error, return an error for anything else.** A
malformed struct tag in a library is arguably programmer error — but a library
that panics takes down its caller's process, so the ORM returns errors even
there, and the CLI decides what to do.

The one legitimate use of `recover` is a boundary that must not die: a server
converting a panic in one request handler into a 500 rather than killing every
other in-flight request.

```go
defer func() {
	if r := recover(); r != nil {
		err = fmt.Errorf("recovered: %v", r)
	}
}()
```

Note what makes that work — `recover()` is only meaningful inside a deferred
function, and it is assigning to a *named* return value, which is the rule you
just learned.

## Build something

Write a parser for column definitions in the form `name:type`, like
`"email:varchar"`:

```go
func ParseColumn(s string) (Column, error)
```

- Define a sentinel `ErrMalformed` for input with no colon.
- On failure, return an error that **wraps** it and includes the bad input.
- Write a test asserting both that the message mentions the input **and** that
  `errors.Is(err, ErrMalformed)` is true.

That second assertion is the point of the whole course — it is what proves you
wrote `%w` and not `%v`.

<details>
<summary>Check yourself</summary>

```go
var ErrMalformed = errors.New("malformed column definition")

func ParseColumn(s string) (Column, error) {
	name, typ, found := strings.Cut(s, ":")
	if !found || name == "" || typ == "" {
		return Column{}, fmt.Errorf("parse %q: %w", s, ErrMalformed)
	}
	return Column{Name: name, Type: typ}, nil
}
```

```go
func TestParseColumnMalformed(t *testing.T) {
	_, err := ParseColumn("nocolon")
	if !errors.Is(err, ErrMalformed) {
		t.Errorf("errors.Is(err, ErrMalformed) = false, err = %v", err)
	}
	if !strings.Contains(err.Error(), "nocolon") {
		t.Errorf("error should mention the input: %v", err)
	}
}
```

`strings.Cut` returns the two halves and a bool, which is cleaner than
`strings.Split` plus a length check — it says exactly what you meant.

The empty-half checks matter: `":varchar"` and `"email:"` both contain a colon
but neither is valid. Splitting on a delimiter almost always needs this, and it
is the kind of edge the fuzzer in course 09 finds in seconds.

Returning `Column{}` rather than a pointer means there is no nil to dereference
if a caller ignores the error. Zero values from course 02, earning their keep.

</details>

## Next

Interfaces — how Go does polymorphism without inheritance, and the trick that
lets you test database code without a database.
