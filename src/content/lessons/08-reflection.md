---
title: "Reflection and struct tags"
part: tools
order: 8
summary: "Read a type at runtime, pull values out of it, and parse the tags on its fields."
topics:
  - reflect.Type
  - reflect.Value
  - struct tags
  - performance costs
minutes: 50
draft: false
---

Everything so far has been checked by the compiler. Reflection is the escape
hatch: a program inspecting a type it has never seen, reading the tags on its
fields, and writing into them at runtime.

It is how `Select[User]` knows that `User` has a column called `email`. It is
also where you will meet your first panics that no compiler warned you about — so
you are going to trigger several of them on purpose.

## Type and Value

Reflection has two halves. Run this:

```go
package main

import (
	"fmt"
	"reflect"
)

type User struct {
	ID    string `po:"id,primaryKey,uuid"`
	Email string `po:"email,varchar(320),unique"`
	Age   int    `po:"age"`
	Temp  string
	notes string
}

func main() {
	u := User{ID: "u1", Email: "ada@example.com", Age: 36}
	t := reflect.TypeOf(u)
	fmt.Println(t, t.Kind(), t.NumField())
}
```

```text
main.User struct 5
```

`reflect.Type` describes the **shape**; `reflect.Value` holds the **data**. Most
reflection code holds both and walks them in step — `t.Field(i)` describes a
field, `v.Field(i)` contains it.

**Predict `NumField()` before you run it.** Five, including the unexported
`notes` — reflection sees everything.

## Kind is not Type

This distinction causes more confusion than the rest of the package combined. Add
a named type and print both:

```go
type UserID string

var raw string = "x"
var wrapped UserID = "x"
fmt.Println(reflect.TypeOf(raw), reflect.TypeOf(raw).Kind())
fmt.Println(reflect.TypeOf(wrapped), reflect.TypeOf(wrapped).Kind())
```

```text
string        string
main.UserID   string
```

**`Type` is what was declared. `Kind` is the underlying machine representation.**
`UserID` and `string` are different types sharing a kind.

Switch on `Kind` when you care how a value is laid out ("is this a struct, a
slice, a pointer?"). Compare `Type` when you care about identity ("is this
*exactly* `time.Time`?"). Get it backwards and you write a type switch that
silently flattens every named string into a plain one.

It is also course 06's `~` seen from the runtime side: `~string` in a constraint
means "kind is string".

## Walking fields and reading tags

```go
for f := range t.Fields() {
	tag, ok := f.Tag.Lookup("po")
	fmt.Printf("%-6s exported=%-5t tag=%-28q found=%t\n",
		f.Name, f.IsExported(), tag, ok)
}
```

```text
ID     exported=true  tag="id,primaryKey,uuid"         found=true
Email  exported=true  tag="email,varchar(320),unique"  found=true
Age    exported=true  tag="age"                        found=true
Temp   exported=true  tag=""                           found=false
notes  exported=false tag=""                           found=false
```

`Fields()` is an iterator added in Go 1.25 and is what the ORM uses; the older
`for i := range t.NumField()` with `t.Field(i)` does the same thing when you need
the index.

Two details that matter later:

**`Lookup` is not `Get`.** `Get` returns `""` both when a tag is missing and when
it is present but empty. `Lookup`'s second return tells them apart — and the ORM
needs that, because "no tag" means *skip this field* while an empty tag is a
mistake worth reporting.

**Unexported fields still appear.** You skip them yourself with `IsExported()`.

### Your turn: break the tags

A struct tag is a string literal, and the `key:"value"` convention is enforced by
nothing at compile time. Type these four and see which survive:

```go
type Bad struct {
	A string `po:'single quotes'`
	B string `po: "leading space"`
	C string `po:"ok" json:"c,omitempty"`
	D string `PO:"uppercase"`
}
```

```text
A -> po=""    found=false
B -> po=""    found=false
C -> po="ok"  found=true
D -> po=""    found=false
```

Three typos, zero errors — the fields just vanish from your schema. Now run
`go vet ./...`:

```text
struct field tag `po:'single quotes'` not compatible with reflect.StructTag.Get:
bad syntax for struct tag value
```

**Vet catches two of the three.** It does not catch `PO:` — that is well-formed,
just a key nobody reads. Good safety net, not a complete one, which is why
course 10 validates tags explicitly instead of trusting them.

## Writing values

Reading is easy. Writing needs the value to be **settable**, and by default it is
not. **Predict all three:**

```go
u := User{}
fmt.Println(reflect.ValueOf(u).Field(0).CanSet())
fmt.Println(reflect.ValueOf(&u).Elem().Field(0).CanSet())
fmt.Println(reflect.ValueOf(&u).Elem().Field(4).CanSet())  // notes
```

```text
false
true
false
```

`reflect.ValueOf(u)` receives a **copy** — course 03's pass-by-value rule, which
reflection cannot opt out of. Writing to it would be silently useless, so the
package refuses. Pass a pointer and step through with `Elem()`. Unexported fields
are never settable whatever you do.

Now build a value from nothing, which is exactly what scanning a database row is:

```go
row := map[string]any{"id": "u2", "email": "alan@go.dev"}
dst := reflect.New(reflect.TypeOf(User{})).Elem()

for f := range dst.Type().Fields() {
	tag, ok := f.Tag.Lookup("po")
	if !ok {
		continue
	}
	col, _, _ := strings.Cut(tag, ",")
	if val, present := row[col]; present {
		dst.FieldByName(f.Name).Set(reflect.ValueOf(val))
	}
}
fmt.Printf("%+v\n", dst.Interface().(User))
```

```text
{ID:u2 Email:alan@go.dev Age:0 Temp: notes:}
```

`reflect.New(t)` gives you a `Value` holding a `*T`; `.Elem()` steps into the
`T`, which is addressable and therefore settable. **That is the ORM's row scanner
in twelve lines.**

## Your turn: collect the panics

Reflection moves type errors from compile time to runtime. Trigger these four
yourself — wrap each in a function with `recover()` so you can run them in one
go:

```go
_ = reflect.ValueOf(u).Field(4).Interface()   // unexported
reflect.ValueOf(u).Field(0).SetString("x")    // not addressable
reflect.ValueOf(&u).Elem().Field(0).SetInt(3) // wrong kind
_ = reflect.ValueOf(u).Field(9)               // out of range
```

```text
panic: reflect.Value.Interface: cannot return value obtained from unexported field or method
panic: reflect: reflect.Value.SetString using unaddressable value
panic: reflect: call of reflect.Value.SetInt on string Value
panic: reflect: Field index out of range
```

Each is avoidable with a guard you already know: `IsExported`, `CanSet`, a `Kind`
check, a bounds check. Reflection code that skips them is a 3am page waiting to
happen.

## Benchmark it yourself

"Reflection is slow" is repeated so often that almost nobody measures it. You are
going to.

Write these five benchmarks in a `_test.go` file and **predict the ranking before
you run them:**

```go
var strSink string

func BenchmarkDirect(b *testing.B) {
	for b.Loop() { strSink = m.Email }
}

func BenchmarkReflectFieldIndex(b *testing.B) {
	v := reflect.ValueOf(m)
	for b.Loop() { strSink = v.Field(1).String() }
}

func BenchmarkReflectFieldByName(b *testing.B) {
	v := reflect.ValueOf(m)
	for b.Loop() { strSink = v.FieldByName("Email").String() }
}
```

Plus one that parses the tags on every call, and one that caches the result in a
map.

```bash
go test -bench=. -benchmem -run=^$ ./...
```

```text
BenchmarkDirect               2.12 ns/op     0 B/op   0 allocs/op
BenchmarkReflectFieldIndex    2.28 ns/op     0 B/op   0 allocs/op
BenchmarkReflectFieldByName  27.78 ns/op     0 B/op   0 allocs/op

BenchmarkParseUncached      536.80 ns/op   488 B/op  13 allocs/op
BenchmarkParseCached          9.66 ns/op     0 B/op   0 allocs/op
```

Two of those should surprise you.

**`v.Field(1)` costs the same as `u.Email`** — 2.28 ns against 2.12 ns, zero
allocations. Once you hold a `reflect.Value` and an integer index, reflection is
essentially free. The folklore that it is "100× slower" is simply wrong for this
operation.

**`FieldByName` is 12× slower**, because it searches the field names as strings
on every call. The cost is not reflection — it is the *lookup*.

And reading a type's tags costs **537 ns and 13 allocations**; caching makes it
9.7 ns and zero. **55×.**

So the rule is not "reflection is slow":

> **Resolving a name is expensive. Using a resolved index is not.**
> Do the resolving once, cache it, index from then on.

Same shape as compiling a regex once instead of per call.

One trap while you write these: if your sink variable is `any` rather than
`string`, boxing allocates and swamps the measurement — direct access will look
as slow as reflection. Benchmarks lie easily; check `allocs/op` before believing
one.

## What you just built

The real parser, with every piece of this course in it:

```go
type Parser struct {
	typeMapper *TypeMapper
	cache      map[reflect.Type]*TableMetadata
}

func (p *Parser) Parse(modelType reflect.Type) (*TableMetadata, error) {
	for modelType.Kind() == reflect.Pointer {
		modelType = modelType.Elem()
	}
	if modelType.Kind() != reflect.Struct {
		return nil, fmt.Errorf("model must be a struct, got %s", modelType.Kind())
	}
	if cached, ok := p.cache[modelType]; ok {
		return cached, nil
	}

	for field := range modelType.Fields() {
		if !field.IsExported() {
			continue
		}
		tagValue := field.Tag.Get(StructTagKey)
		// ...
	}
}
```

The `Kind` loop unwraps `*User` to `User`. The `Kind` check returns an error
instead of panicking. `Fields()` walks, `IsExported` skips `notes`, `Tag.Get`
reads the tag.

And the cache is keyed by `reflect.Type`, so the 537 ns path runs **once per
model, ever** — every query after that is the 9.7 ns path. Course 11 wraps this
map in the `sync.RWMutex` you built last course.

## Build something

Write the function course 10 begins with:

```go
func Columns(v any) ([]string, error)
```

Given any struct — or a pointer to one — return the column names from its `po`
tags in field order. The name is everything before the first comma.

The edge cases are the exercise, so make each one a test:

- a pointer (`&User{}`) behaves like a value
- an unexported field is skipped, not panicked on
- a field with no `po` tag is skipped
- a non-struct (`42`, `"x"`) returns an error
- `Columns(nil)` returns an error rather than panicking

That last one will catch you if you only test the happy path.

<details>
<summary>Check yourself</summary>

```go
func Columns(v any) ([]string, error) {
	t := reflect.TypeOf(v)
	for t != nil && t.Kind() == reflect.Pointer {
		t = t.Elem()
	}
	if t == nil || t.Kind() != reflect.Struct {
		return nil, fmt.Errorf("columns: want a struct, got %v", t)
	}

	var cols []string
	for f := range t.Fields() {
		if !f.IsExported() {
			continue
		}
		tag, ok := f.Tag.Lookup("po")
		if !ok {
			continue
		}
		name, _, _ := strings.Cut(tag, ",")
		if name == "" || name == "-" {
			continue
		}
		cols = append(cols, name)
	}
	return cols, nil
}
```

**The pointer unwrap is a loop, not an `if`** — `**User` is legal, and the real
parser loops for the same reason.

**`t == nil` is checked** because `reflect.TypeOf(nil)` returns nil and calling
`Kind()` on it is a nil dereference. Try deleting that check and running
`Columns(nil)`.

**`Lookup`, not `Get`** — an untagged field must be skipped, and `Get` cannot
tell that from an empty tag.

**`-` is skipped**: the ORM's convention for a field that exists in Go but is not
a column. Relationship fields use it, as you will see in course 12.

The function returns `[]string`, not `[]reflect.StructField`. The caller gets
plain data and never learns reflection was involved — the same instinct as course
06's generic signature. One boundary, crossed once.

</details>

## Next

Testing. You have been writing tests since course 01, but reflection is the first
thing here where the compiler stops helping — so next is table-driven tests,
coverage, and a fuzzer that will find a bug you cannot see.
