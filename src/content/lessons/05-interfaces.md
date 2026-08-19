---
title: "Interfaces"
part: tools
order: 5
summary: "Implicit satisfaction, small interfaces, and how to test database code without a database."
topics:
  - implicit interfaces
  - method sets
  - type assertions
  - the nil interface trap
minutes: 40
draft: false
---

An interface is a set of method signatures. Any type with those methods satisfies
it — automatically, with no declaration. That one design choice is why Go code
composes as well as it does, and it has two sharp edges that this course makes
you cut yourself on deliberately.

## Nothing declares that it implements anything

Write this in your `greet` module and run it:

```go
package main

import "fmt"

type Describer interface {
	Describe() string
}

type Column struct {
	Name string
	Type string
}

func (c Column) Describe() string {
	return fmt.Sprintf("%s %s", c.Name, c.Type)
}

func main() {
	var d Describer = Column{Name: "email", Type: "varchar"}
	fmt.Println(d.Describe())
}
```

```text
email varchar
```

There is no `implements Describer` anywhere. `Column` has a `Describe() string`
method, so it satisfies the interface — the compiler checks it at the assignment.

The consequence is that **you can define an interface for a type you do not
own.** In most languages the type must opt in; in Go, the *consumer* declares
what it needs. That is why the standard library's interfaces work with types
written years later.

## Predict: does this compile?

Change the receiver to a pointer, and nothing else:

```go
func (c *Column) Describe() string {
	return fmt.Sprintf("%s %s", c.Name, c.Type)
}
```

The assignment `var d Describer = Column{...}` is unchanged. **Compile error or
not?**

```text
cannot use Column{} (value of struct type Column) as Describer value:
Column does not implement Describer (method Describe has pointer receiver)
```

**A pointer receiver means only the pointer satisfies the interface.**
`&Column{}` works; `Column{}` does not. The reverse is fine — a value receiver
puts the method on both `Column` and `*Column`.

The reason is course 03's rule seen from another angle: a method that can modify
its receiver is meaningless on a copy, so Go will not let an unaddressable value
sneak into an interface that promises it.

In practice: **if any method on your type has a pointer receiver, pass pointers
everywhere.** Fix it with `var d Describer = &Column{...}` and move on.

## Small interfaces win

The most-used interface in Go has one method:

```go
type Writer interface {
	Write(p []byte) (n int, err error)
}
```

Write a function that takes it:

```go
func WriteSchema(w io.Writer, cols []string) error {
	for _, c := range cols {
		if _, err := fmt.Fprintf(w, "  %s\n", c); err != nil {
			return err
		}
	}
	return nil
}
```

Now call it three ways and run:

```go
WriteSchema(os.Stdout, cols)

var buf bytes.Buffer
WriteSchema(&buf, cols)

var sb strings.Builder
WriteSchema(&sb, cols)
```

```text
  id
  email
captured 13 bytes: "  id\n  email\n"
also works with strings.Builder: 2 lines
```

One function, and it writes to a terminal, an in-memory buffer, a file, a network
connection, or a gzip stream — none of which it knows about. **The buffer version
is a test**: you called the real function and captured its output with no files
and no mocking library.

That is the whole trick this course exists to teach. Note the direction of the
dependency: `WriteSchema` did not have to anticipate `bytes.Buffer`, and
`bytes.Buffer` did not have to anticipate `WriteSchema`.

Keep interfaces small. One or two methods is normal; the Go proverb is *"the
bigger the interface, the weaker the abstraction."* A ten-method interface has
exactly one implementation and buys you nothing.

## Asking what is inside

A **type assertion** pulls the concrete value back out. Always use the two-value
form, which cannot panic:

```go
if c, ok := d.(Column); ok {
	fmt.Println(c.Name)
}
```

A **type switch** handles several:

```go
switch v := value.(type) {
case string:
	return fmt.Sprintf("%q", v)
case int, int64:
	return fmt.Sprint(v)
case nil:
	return "NULL"
default:
	return fmt.Sprintf("unsupported: %T", v)
}
```

That shape is how an ORM turns a Go value into a SQL literal, and `%T` in the
default case is what makes the failure debuggable.

Reach for these sparingly. Needing to know the concrete type usually means the
interface is wrong.

## Your turn: the nil that is not nil

Type this exactly and predict the output:

```go
type MyErr struct{}

func (e *MyErr) Error() string { return "boom" }

func mightFail() error {
	var p *MyErr    // nil pointer
	return p        // returned as an error interface
}

func main() {
	err := mightFail()
	fmt.Println("err == nil?", err == nil)
}
```

**It returned a nil pointer. Is `err == nil` true?**

```text
err == nil? false
```

An interface value is a **pair**: a type and a value. `err` holds *type
`*MyErr`, value nil* — and a pair with a type in it is not the nil interface,
which is *no type, no value*. So `if err != nil` fires and the caller handles a
failure that never happened.

This is Go's most notorious gotcha, and the fix is a habit rather than a
technique: **never declare a typed nil and return it as an interface.** Return
the literal `nil`:

```go
func mightFail() error {
	if somethingWrong {
		return &MyErr{}
	}
	return nil
}
```

Now make it fail for real — call `err.Error()` on that non-nil error holding a
nil pointer, and see which line panics. That is the shape of the 3am page this
rule prevents.

## Accept interfaces, return structs

The guideline worth internalising:

**Accept interfaces** in parameters, so callers can pass whatever they have —
including a fake in a test. **Return concrete types**, so callers get every
method and are not boxed in by the narrow view you happened to pick.

Returning an interface also hides the nil trap above inside your API, where your
callers cannot see it.

One more rule: **define the interface where it is used, not where it is
implemented.** The consumer knows what it needs. A package that exports an
interface nobody consumes has guessed at an abstraction instead of discovering
one.

## Build something

Practise the exact shape that makes the ORM testable.

```go
type Fetcher interface {
	Fetch(id int) (string, error)
}

func Describe(f Fetcher, id int) string
```

`Describe` returns `"user: <name>"` on success and `"unknown user"` if `Fetch`
returns an error.

Then test it with a **fake** — a small struct in your test file that returns
whatever you tell it. No database, no network, no mocking library. If you find
yourself wanting one, the interface is too big.

<details>
<summary>Check yourself</summary>

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
		fetcher Fetcher
		want    string
	}{
		{"success", fakeFetcher{name: "Ada"}, "user: Ada"},
		{"failure", fakeFetcher{err: errors.New("nope")}, "unknown user"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := Describe(tt.fetcher, 1); got != tt.want {
				t.Errorf("Describe() = %q, want %q", got, tt.want)
			}
		})
	}
}
```

The fake is six lines and no dependency. That is what a one-method interface
buys you — the reason to keep them small is not elegance, it is that a
twenty-method interface makes this fake unwritable.

`func (f fakeFetcher) Fetch(int) (string, error)` omits the parameter name
because the fake ignores it. Legal, and it documents that the argument does not
matter here.

`fakeFetcher` is a value receiver, so both `fakeFetcher{}` and `&fakeFetcher{}`
satisfy `Fetcher` — the rule from the top of this course, chosen deliberately so
the table can hold plain values.

</details>

## Next

Generics. Interfaces let one function serve many types that share methods;
generics let one function serve many types that share nothing, and still hand
back a real typed result. It is what makes `Select[User]` return `[]User`.
