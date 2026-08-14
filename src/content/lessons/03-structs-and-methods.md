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

Go has no classes. It has structs, which hold data, and methods, which are
ordinary functions with one extra parameter. That is the whole object model, and
it is smaller than it sounds — most of this course is one decision you have to
make every time you write a method, and which everyone gets wrong at least once.

The struct is also the unit this entire series is built on. By course 10 a
struct definition *is* your database schema.

## Defining a struct

```go
type User struct {
	ID    int
	Name  string
	Email string
}
```

Create one by naming the fields:

```go
u := User{ID: 1, Name: "Ada", Email: "ada@example.com"}
```

You can also write `User{1, "Ada", "ada@example.com"}` positionally, but do not.
It compiles today and breaks silently the moment someone reorders the fields.
Named fields also let you omit any you do not care about — the rest get their
zero values, as course 02 covered.

Fields follow the same export rule as everything else: `Name` is visible outside
the package, `name` is not.

## Methods

A method is a function with a **receiver** — the parameter in parentheses before
the name:

```go
func (u User) Label() string {
	return fmt.Sprintf("%s <%s>", u.Name, u.Email)
}
```

`u.Label()` now works. There is no `this`, and the receiver is named like any
other parameter. Convention is one or two letters — a short abbreviation of the
type, used consistently across every method on that type. Not `self`, not `me`.

Methods can be declared on any named type you define, not just structs:

```go
type Celsius float64

func (c Celsius) String() string {
	return fmt.Sprintf("%.1f°C", float64(c))
}
```

You cannot declare methods on types from other packages. That restriction is
what makes Go's type system tractable, and it is why you will occasionally see a
one-field wrapper type whose only job is to give you somewhere to hang a method.

## The receiver decision

This is the part that matters. A receiver is either a **value** or a
**pointer**, and the difference is not cosmetic:

```go
type Counter struct {
	N int
}

// Value receiver: operates on a copy.
func (c Counter) IncValue() { c.N++ }

// Pointer receiver: operates on the original.
func (c *Counter) IncPointer() { c.N++ }

func main() {
	c := Counter{}

	c.IncValue()
	c.IncValue()
	fmt.Printf("after two IncValue()   N = %d\n", c.N)

	c.IncPointer()
	c.IncPointer()
	fmt.Printf("after two IncPointer() N = %d\n", c.N)
}
```

```text
after two IncValue()   N = 0
after two IncPointer() N = 2
```

`IncValue` did nothing. It incremented a copy that was discarded when the method
returned. It did not warn you, because it is not an error — you are allowed to
mutate a copy.

This is the single most common bug in early Go code. If a method is supposed to
change the receiver, the receiver must be a pointer.

### Go takes the address for you

Notice that `c.IncPointer()` worked even though `c` is a value, not a pointer.
Go rewrites it to `(&c).IncPointer()` automatically. The same happens in
reverse: a pointer can call a value method, and Go dereferences it.

So the calling syntax is identical either way, which is convenient and also
exactly why the bug above is so easy to write. You cannot tell from the call
site which kind of receiver you got.

That automatic address-taking only works on **addressable** values. A map
element is not addressable, and the compiler is blunt about it:

```go
m := map[string]Counter{"a": {}}
m["a"].Inc()
```

```text
./main.go:9:9: cannot call pointer method Inc on Counter
```

The fix is to pull the value out, modify it, and put it back — or, more usually,
to store `map[string]*Counter` instead.

### The rule

Pick a receiver by asking two questions:

1. **Does the method modify the receiver?** If yes, it must be a pointer.
2. **Is the struct large, or does it contain a lock?** If yes, use a pointer to
   avoid copying it.

Otherwise either works — and then the real rule takes over: **be consistent
within a type.** If any method on `User` takes a pointer receiver, give them all
pointer receivers. Mixing them is legal, confusing, and causes surprises later
when interfaces get involved (course 05).

The second question is not just about performance. Copying a struct that
contains a `sync.Mutex` copies the lock, which quietly breaks it. `go vet` knows:

```go
type Store struct {
	mu sync.Mutex
	n  int
}

func (s Store) Bad() { s.mu.Lock(); defer s.mu.Unlock(); s.n++ }
```

```text
mu.go:10:9: Bad passes lock by value: example.com/shapes.Store contains sync.Mutex
```

Keep running `go vet ./...`. This is exactly the class of mistake it exists for,
and you will meet it for real in course 11, when the ORM's registry gets a lock.

## Composition, not inheritance

Go has no `extends`. Instead you **embed** one type in another by declaring it
without a field name:

```go
type Model struct {
	ID      int
	Created string
}

func (m Model) Describe() string { return fmt.Sprintf("Model(%d)", m.ID) }

type User struct {
	Model // embedded: no field name
	Email string
}
```

The embedded type's fields and methods are **promoted** — reachable as if they
were declared on the outer type:

```text
promoted field  u.ID = 1
still reachable u.Model.Created = "today"
promoted method u.Describe() = Model(1)
```

`u.ID` works, and `u.Model.ID` still works too. Promotion is a shorthand, not a
merge.

This looks like inheritance, so be careful: it is not. If the outer type
declares a method with the same name, it **shadows** the inner one — but
nothing dispatches virtually:

```go
type Admin struct {
	Model
	Email string
}

func (a Admin) Describe() string { return fmt.Sprintf("Admin(%d)", a.ID) }
```

```text
shadowed        a.Describe()       = Admin(2)
original still  a.Model.Describe() = Model(2)
```

Crucially, if `Model` had another method that called `Describe()`, it would call
**`Model`'s** `Describe`, not `Admin`'s. The inner type has no idea it has been
embedded. There is no `super`, and no base class reaching down into a subclass.

If you want that kind of polymorphism, you use an interface — which is course 05.

Embedding is best used for exactly what it looks like here: sharing a common set
of fields, or borrowing an implementation. Reach for a named field
(`Model Model`) whenever the relationship is "has a" rather than "is basically a".

## Structs compare with ==

Two structs are equal if every field is equal, provided every field is
comparable:

```go
type Point struct{ X, Y int }

fmt.Println(Point{1, 2} == Point{1, 2})   // true
fmt.Println(Point{1, 2} == Point{9, 9})   // false
```

That also makes them usable as map keys:

```go
m := map[Point]string{{1, 2}: "origin-ish"}
```

But a struct containing a slice, map or function is **not** comparable, and the
failure is at compile time:

```go
type Tagged struct {
	Name string
	Tags []string
}

fmt.Println(Tagged{"a", nil} == Tagged{"a", nil})
```

```text
./main.go:11:14: invalid operation: Tagged{…} == Tagged{…} (struct containing []string cannot be compared)
```

Worth knowing before you try to use a struct as a map key and find out the hard
way. For those, compare field by field, or use `reflect.DeepEqual` in tests.

## Why this matters for the ORM

From course 10 onwards, a struct definition is the schema:

```go
type User struct {
	ID    string `po:"id,primaryKey,uuid"`
	Email string `po:"email,varchar(320),unique"`
}
```

Those backtick strings are **struct tags** — metadata attached to a field,
ignored by the compiler, readable at runtime. They are how the ORM learns that
`Email` maps to a `varchar(320)` column called `email`. Course 08 shows how to
read them; course 10 turns them into a schema.

Two things from this course carry straight over.

**The receiver decision shows up in the query builder.** Every method on
`Select[T]` returns a pointer so the chain accumulates state — `.Where(...)`
has to modify the query, not a copy of it. If those were value receivers, the
builder would silently discard every clause, exactly like `IncValue` above.

**Embedding raises a question an ORM has to answer.** If you embed a `Model`
with an `ID` field, is `ID` a column? Promotion says the field is reachable at
`u.ID`, but reflection over `User`'s fields sees one field named `Model`, not
three. Any ORM has to decide whether to walk into embedded structs. Keep that in
mind when you write the parser — it is a real design decision, not an oversight.

## Exercise

Build the beginnings of a schema type:

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

Write two methods:

- `AddColumn(name, typ string)` — appends a column
- `ColumnNames() []string` — returns just the names

Write the test first. Add two columns, then assert `ColumnNames()` returns both.

```bash
cd greet
go test ./...
```

If your test says you have zero columns after adding two, you have just
reproduced the bug at the top of this course. Do not fix it by guessing — read
the receiver.

<details>
<summary>One way to do it</summary>

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

`AddColumn` **must** take a pointer receiver: it modifies `t.Columns`. With a
value receiver it appends to a copy and the caller sees nothing.

`ColumnNames` does not modify anything, so a value receiver is defensible — but
by the consistency rule above, most Go programmers would make it `*Table` too,
so every method on `Table` matches. Either is fine as long as you can say why.

`make([]string, 0, len(t.Columns))` pre-sizes the slice: length zero, capacity
enough for every name. That avoids the repeated reallocation you watched happen
in course 02.

</details>

## Next

You can model data and give it behaviour. Next: what happens when things go
wrong. Go has no exceptions, and errors are ordinary values you are expected to
handle in the open.
