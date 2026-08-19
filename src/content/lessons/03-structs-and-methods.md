---
title: "Structs and methods"
part: foundations
order: 3
summary: "Model data with structs, hang behaviour off it with methods, and pick the right receiver."
topics:
  - structs
  - methods
  - pointer vs value receivers
  - composition
minutes: 40
draft: false
---

There is one decision in this course that you will get wrong at least once in
real code, and it fails silently. We are going to trigger it deliberately in the
next three minutes so you recognise it later.

Open your `greet` module and put this in `main.go`:

```go
package main

import "fmt"

type Counter struct {
	n int
}

func (c Counter) Inc() {
	c.n++
}

func main() {
	c := Counter{}
	c.Inc()
	c.Inc()
	c.Inc()
	fmt.Println(c.n)
}
```

**Predict the number before you run it.** Three calls to `Inc`.

```bash
go run .
```

```text
0
```

Not three. Not a crash. Zero — and no warning from the compiler or from `go vet`.

## The receiver

That `(c Counter)` before the function name is the **receiver**, and it makes
`Inc` a method on `Counter`. It is an ordinary parameter with an unusual
position, which means the usual rule applies: **Go passes it by value.** Each
call got its own copy of the counter, incremented it, and threw it away.

Change one character — add a `*`:

```go
func (c *Counter) Inc() {
	c.n++
}
```

```text
3
```

A pointer receiver gets the address, so the method mutates the original.

Notice what you did *not* have to write: no `(&c).Inc()`, no `c->n`. Go
automatically takes the address of an addressable value when you call a
pointer-method on it, and automatically dereferences when you call a
value-method on a pointer. The call site looks identical either way — which is
exactly why the bug above is so easy to ship.

### The rule

Pick a receiver with these, in order:

1. **Does the method modify the receiver?** Then it must be a pointer. No choice.
2. **Is the struct large, or does it contain a mutex?** Pointer — copying is
   wasteful, and copying a mutex is a bug that `go vet` will report.
3. **Otherwise, be consistent.** If any method on the type needs a pointer, use
   pointers for all of them. Mixed receivers on one type confuse readers and
   interact badly with interfaces in course 05.

In practice most types end up with pointer receivers. Value receivers are for
small immutable things — a `Point`, a `Duration`, a wrapper around a string.

## Your turn

Here is a method chain that silently loses data. Type it and run it:

```go
type Query struct {
	table string
	where []string
}

func (q Query) Where(cond string) Query {
	q.where = append(q.where, cond)
	return q
}

func main() {
	q := Query{table: "users"}
	q.Where("age > 18")
	q.Where("active = true")
	fmt.Println(q.where)
}
```

```text
[]
```

Fix it so both conditions land. There are **two** different fixes — one changes
the receiver, the other changes the call site. Find both, then decide which one
the ORM's query builder should use, given that you want to write
`Select[User](db).Where(...).Limit(10)` as a single chain.

<details>
<summary>Once you have tried both</summary>

The call-site fix keeps value receivers and reassigns:

```go
q = q.Where("age > 18")
q = q.Where("active = true")
```

The receiver fix uses a pointer and returns it so calls can chain:

```go
func (q *Query) Where(cond string) *Query {
	q.where = append(q.where, cond)
	return q
}
```

```go
q.Where("age > 18").Where("active = true")
```

The ORM uses the second. Every builder method returns `*SelectQuery[T]` so the
chain accumulates state in one object. Had they been value receivers, the builder
would discard every clause exactly like `Counter.Inc` — and produce a query that
runs fine and returns the wrong rows.

</details>

## Composition, not inheritance

Go has no `extends`. You **embed** a type by declaring it with no field name:

```go
type Model struct {
	ID      int
	Created string
}

func (m Model) Describe() string { return fmt.Sprintf("Model(%d)", m.ID) }

type User struct {
	Model
	Email string
}
```

**Predict which of these compile:** `u.ID`, `u.Model.ID`, `u.Describe()`.

```text
u.ID         = 1
u.Model.ID   = 1
u.Describe() = Model(1)
```

All three. The embedded type's fields and methods are **promoted** to the outer
type, and the long form still works — promotion is a shorthand, not a merge.

This looks like inheritance. It is not, and the difference matters. Add a type
that overrides the method:

```go
type Admin struct {
	Model
	Email string
}

func (a Admin) Describe() string { return fmt.Sprintf("Admin(%d)", a.ID) }
```

```text
a.Describe()       = Admin(2)
a.Model.Describe() = Model(2)
```

`Admin.Describe` shadows the promoted one. But **if a method on `Model` called
`Describe()`, it would call `Model`'s** — the inner type has no idea it has been
embedded. There is no virtual dispatch, no `super`, no base class reaching into a
subclass. When you want that, you use an interface, which is course 05.

Use embedding for what it looks like: sharing a common set of fields, or
borrowing an implementation. Use a named field (`Model Model`) when the
relationship is "has a" rather than "is basically a".

### One prediction that matters later

`User` has an embedded `Model` with two fields, plus its own `Email`. **How many
fields does reflection see on `User`?** Run it:

```go
t := reflect.TypeOf(User{})
fmt.Println(t.NumField())
for f := range t.Fields() {
	fmt.Printf("  %s (%v) anonymous=%t\n", f.Name, f.Type, f.Anonymous)
}
```

```text
2
  Model (main.Model) anonymous=true
  Email (string) anonymous=false
```

**Two, not three.** Promotion is a compile-time convenience; the runtime sees one
field called `Model`, flagged `Anonymous`.

That is a real design decision waiting for you in course 10. If someone embeds a
`Model` with an `ID` field, is `ID` a column? Every ORM has to choose whether to
walk into embedded structs, and now you know why the choice exists.

## Structs compare with ==

```go
a := User{Name: "Ada", Age: 36}
b := User{Name: "Ada", Age: 36}
fmt.Println(a == b)
```

```text
true
```

Field by field, no method to write. Comparable structs also work as **map keys**,
which is worth remembering.

Now add a slice field and try again:

```go
type Tagged struct {
	Name string
	Tags []string
}
```

**Predict: runtime panic, or compile error?**

```text
./main.go:6:9: invalid operation: x == y (struct containing []string cannot be compared)
```

Compile error — caught before you ship. A struct is comparable only if every
field is, and slices, maps and functions are not. This is the same
`comparable` constraint you will meet in course 06's generics, and the reason
`registry` in course 11 keys its cache by `reflect.Type` rather than by a struct.

## Build something

Start the type the whole ORM is built around. In your `greet` module:

```go
type Column struct {
	Name string
	Type string
}

type Table struct {
	Name    string
	Columns []Column
}
```

Write two methods and a test:

- `AddColumn(name, typ string)` — appends a column
- `ColumnNames() []string` — returns just the names

**Write the test first.** Add two columns, then assert `ColumnNames()` returns
both. If your test reports zero columns after adding two, you have reproduced
the bug from the top of this course — do not guess at the fix, read the receiver.

<details>
<summary>Check yourself</summary>

```go
func (t *Table) AddColumn(name, typ string) {
	t.Columns = append(t.Columns, Column{Name: name, Type: typ})
}

func (t Table) ColumnNames() []string {
	names := make([]string, 0, len(t.Columns))
	for _, c := range t.Columns {
		names = append(names, c.Name)
	}
	return names
}
```

`AddColumn` modifies, so it takes a pointer — rule 1, no choice. `ColumnNames`
only reads, so a value receiver would work.

By rule 3 you should still make them both pointers. Consistency matters more
than the micro-optimisation, and the moment `Table` grows a mutex — which it
does, in course 11 — the value receiver becomes an actual bug that `go vet`
reports as *"passes lock by value"*.

`make([]string, 0, len(t.Columns))` sets the capacity up front so `append` never
has to reallocate. Course 02's slice internals, put to use.

</details>

## Next

Errors. Go has no exceptions — failure is a value you return, check, and wrap.
It is the convention that shapes every function signature you will write from
here on.
