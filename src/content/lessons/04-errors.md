---
title: "Errors are values"
part: foundations
order: 4
summary: "Multiple returns, wrapping with %w, defer, and when panic is genuinely correct."
topics:
  - error interface
  - errors.Is / errors.As
  - defer
  - panic and recover
minutes: 35
draft: false
---

Go has no exceptions. A function that can fail returns an error alongside its
result, and you deal with it right there. This is more typing than a `try` block
and a great deal less guessing about where control went.

The whole mechanism is one interface:

```go
type error interface {
	Error() string
}
```

Anything with an `Error() string` method is an error. That is it — no base
class, no hierarchy, no special language support beyond the convention that
errors come last in the return list.

## The pattern

```go
f, err := os.Open("config.json")
if err != nil {
	return err
}
defer f.Close()
```

You will write `if err != nil` thousands of times. People complain about this,
and the complaint is fair: it is repetitive. What you get in exchange is that
every place a function can fail is visible in the code, and the compiler will
not let you silently ignore a returned value you assigned.

Two conventions worth adopting immediately:

- **The error is the last return value.** `(T, error)`, never `(error, T)`.
- **When `err != nil`, treat the other values as meaningless.** A function that
  returns a useful value *and* a non-nil error is a function fighting the
  convention.

## Making errors

For a fixed message, `errors.New`:

```go
var ErrNotFound = errors.New("not found")
```

Declaring it as a package-level `var` makes it a **sentinel** — a specific error
value callers can compare against. Note `Err` prefix: universal convention.

For a message built at the point of failure, `fmt.Errorf`:

```go
return fmt.Errorf("parsing column %q: unexpected type %s", name, typ)
```

Error strings are lowercase and have no trailing punctuation. They get
concatenated into larger messages, and `Failed to open file.: not found` reads
badly.

## Wrapping

The interesting part is adding context as an error travels up without throwing
away what it was. `fmt.Errorf` with the **`%w`** verb wraps:

```go
return fmt.Errorf("loading profile: %w", err)
```

`%w` produces an error that prints like `%v` would, but keeps a reference to the
original so it can still be inspected. Compare:

- `%v` — flattens to a string. Context preserved, identity lost.
- `%w` — preserves the chain. Callers can still ask what really went wrong.

The difference is invisible in the output and total in behaviour:

```go
withW := fmt.Errorf("parsing %q: %w", "x", ErrMalformed)
withV := fmt.Errorf("parsing %q: %v", "x", ErrMalformed)
```

```text
%w text: parsing "x": malformed column  -> errors.Is = true
%v text: parsing "x": malformed column  -> errors.Is = false
```

Same message, character for character. One can be inspected by callers and the
other cannot. You will not catch this by reading logs.

Wrapping is therefore a decision about your API, not a formatting choice. `%w`
makes the underlying error part of what callers can rely on. If the fact that
you use `os.Open` internally is an implementation detail you might change, use
`%v` deliberately.

## errors.Is and errors.As

Once errors nest, `==` is not enough. There are two questions you can ask.

**"Is this particular error in there?"** — `errors.Is` walks the chain:

```go
if errors.Is(err, ErrNotFound) {
	// handle the missing case
}
```

**"Is there an error of this type in there, and can I have it?"** —
`errors.As` walks the chain and assigns:

```go
var qe *QueryError
if errors.As(err, &qe) {
	log.Printf("failing query was: %s", qe.Query)
}
```

`errors.As` takes a **pointer to** the variable you want filled, which is why
that `&` is there. Forgetting it is a runtime panic, not a compile error.

Here is the whole thing working. A custom error type, wrapping a sentinel:

```go
var ErrNotFound = errors.New("not found")

type QueryError struct {
	Query string
	Err   error
}

func (e *QueryError) Error() string {
	return fmt.Sprintf("query %q: %v", e.Query, e.Err)
}

func (e *QueryError) Unwrap() error { return e.Err }
```

The `Unwrap() error` method is what makes a custom type participate in the
chain. Without it, `errors.Is` stops at your type and never finds the sentinel
underneath.

```text
error text: query "SELECT * FROM users": not found

errors.Is(err, ErrNotFound) = true
errors.As gave us the query: "SELECT * FROM users"

wrapped: loading profile: query "SELECT * FROM users": not found
still matches sentinel: true
still matches type:     true
```

Note the last two lines. After wrapping the `*QueryError` in *another* layer with
`%w`, both checks still succeed. That is the payoff: callers three levels up can
still ask "was this a not-found?" without caring how many times it was annotated
on the way.

## defer

`defer` schedules a call to run when the surrounding **function** returns —
however it returns, including on a panic. It is how Go does cleanup:

```go
f, err := os.Open(path)
if err != nil {
	return err
}
defer f.Close()
```

The close sits next to the open, which is the point. You cannot forget it at the
bottom of a long function because it is not at the bottom.

Three behaviours to know.

**Deferred calls run last-in-first-out:**

```text
  body
  deferred 3
  deferred 2
  deferred 1
```

**Arguments are evaluated when the `defer` statement runs, not when the call
does:**

```go
i := 0
defer fmt.Println("  args evaluated at defer time, i =", i)
i = 99
```

```text
  i is now 99
  args evaluated at defer time, i = 0
```

If you want the later value, defer a closure — `defer func() { fmt.Println(i) }()` —
which reads `i` when it runs.

**A deferred closure can modify a named return value:**

```go
func namedReturn() (n int) {
	defer func() { n *= 2 }()
	return 21
}
```

```text
defer can modify a named return: 42
```

`return 21` sets `n`, *then* the deferred function runs and doubles it. This is
occasionally elegant and frequently confusing — the main legitimate use is
converting a recovered panic into an error, which is next.

One trap: `defer` fires at **function** return, not at the end of a loop
iteration. Opening files in a loop and deferring each `Close` keeps every handle
open until the whole function finishes. Move the body into its own function, or
close explicitly.

## panic and recover

`panic` unwinds the stack, running deferred functions as it goes, and crashes
the program with a stack trace:

```text
panic: assignment to entry in nil map

goroutine 1 [running]:
main.main()
	/.../main.go:5 +0x34
```

`recover` stops that unwinding, but only when called inside a deferred function:

```go
func safe(n int) (result int, err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("recovered: %v", r)
		}
	}()
	return mustPositive(n), nil
}
```

```text
safe(5)  = 5, err = <nil>
safe(-1) = 0, err = recovered: negative input: -1
```

Note how this works: `recover` catches the panic, and because `err` is a **named
return**, the deferred closure can set it. The caller sees an ordinary error and
never knows a panic happened.

The important question is when any of this is appropriate. The Go answer is
narrow:

- **Panic for programmer errors** — states that should be impossible if the code
  is correct. An out-of-range index, a nil map write, a `Must...` constructor
  given invalid input at startup.
- **Return an error for anything the world can cause** — missing file, bad
  input, network failure, row not found. None of these are bugs.
- **Recover only at a boundary** — the top of a request handler, or a library's
  public edge, so one bad request does not take down the process. A panic
  crossing a package boundary is almost always a design mistake.

If you find yourself using panic and recover as exceptions, stop. The reason Go
reads the way it does is that failure is in the signature.

## Why this matters for the ORM

The error type you build in course 13 is exactly the one above:

```go
type QueryError struct {
	Query string
	Err   error
}
```

When a query fails, a bare `pq: syntax error at or near "SELCT"` is not much
help — you want to know which query. Wrapping the driver's error in a
`QueryError` adds the SQL while keeping the original intact, so callers can
still use `errors.Is` against driver sentinels, and `errors.As` to pull out the
statement for a log line.

That is the whole design: **add context, preserve identity**. It is why
`Unwrap()` is there, and why the ORM never does
`fmt.Errorf("query failed: %v", err)` — that would flatten the driver's error
into a string and take the choice away from the caller.

## Exercise

Write a small parser for column definitions in the form `name:type`, such as
`"email:varchar"`.

```go
func ParseColumn(s string) (Column, error)
```

Requirements:

- Define a sentinel `ErrMalformed` for input with no colon.
- On failure, return an error that **wraps** `ErrMalformed` and includes the bad
  input in the message.
- Write a test asserting both that the message mentions the input **and** that
  `errors.Is(err, ErrMalformed)` is true.

That last assertion is the point. It is what proves you wrapped with `%w`
instead of `%v`.

```bash
cd greet
go test ./...
```

<details>
<summary>One way to do it</summary>

```go
var ErrMalformed = errors.New("malformed column")

func ParseColumn(s string) (Column, error) {
	name, typ, found := strings.Cut(s, ":")
	if !found {
		return Column{}, fmt.Errorf("parsing %q: %w", s, ErrMalformed)
	}
	return Column{Name: name, Type: typ}, nil
}
```

```go
func TestParseColumnMalformed(t *testing.T) {
	_, err := ParseColumn("nocolon")
	if !errors.Is(err, ErrMalformed) {
		t.Errorf("errors.Is(err, ErrMalformed) = false, want true")
	}
	if !strings.Contains(err.Error(), "nocolon") {
		t.Errorf("error %q should mention the input", err)
	}
}
```

`strings.Cut` is the modern way to split on the first separator — it returns the
two halves and a bool, so you do not have to check the length of a slice from
`strings.Split`.

Returning `Column{}` alongside the error is deliberate: when `err != nil` the
value is meaningless, and the zero value is the clearest way to say so.

</details>

## Next

That is the foundations. You can set up a module, reason about values, model
data, and fail properly.

Part two starts with the feature that ties Go's packages together, and the one
that makes `Select[T]` possible three courses later: interfaces.
