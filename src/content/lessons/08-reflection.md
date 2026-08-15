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
hatch: it lets a program inspect a type it has never seen, read the tags on its
fields, and write into them — all at runtime, with none of that safety.

It is how `Select[User]` knows that `User` has a column called `email`. It is
also the part of the ORM most likely to panic, so this course spends as much
time on the failure modes as on the API.

And it is slower than direct field access — but not in the way you have probably
been told. The benchmarks near the end are the reason the registry exists.

## Type and Value

Reflection has two halves. `reflect.Type` describes the *shape*;
`reflect.Value` holds the *data*:

```go
t := reflect.TypeOf(u)
v := reflect.ValueOf(u)
```

```text
Type: main.User   Kind: struct   Name: "User"   PkgPath: "main"
fields: 5
```

You reach for `Type` to ask what fields exist and what tags they carry, and
`Value` to read or write what is in them. Most reflection code holds both,
walking them in step: `t.Field(i)` describes the field, `v.Field(i)` contains it.

## Kind is not Type

This distinction causes more confusion than any other part of the package:

```go
type UserID string
```

```text
x   Type=string          Kind=string
x   Type=main.UserID     Kind=string
```

**`Type` is the declared type. `Kind` is the underlying machine representation.**
`UserID` and `string` are different types that share a kind.

Switch on `Kind` when you care how a value is laid out — "is this a struct, a
slice, a pointer?" Compare `Type` when you care about identity — "is this
*exactly* `time.Time`?"

Get it backwards and you write a type switch that silently treats every named
string as a plain string. It is also the same `~` distinction from course 06,
seen from the runtime side: `~string` in a constraint means "kind is string".

## Walking the fields

```go
for i := range t.NumField() {
	f := t.Field(i)
	tag, ok := f.Tag.Lookup("po")
	// ...
}
```

```text
ID     string   exported=true  tag="id,primaryKey,uuid"         found=true  value=u1
Email  string   exported=true  tag="email,varchar(320),unique"  found=true  value=ada@example.com
Age    int      exported=true  tag="age"                        found=true  value=36
Temp   string   exported=true  tag=""                           found=false  value=
notes  string   exported=false tag=""                           found=false  value=<unexported>
```

Since Go 1.25 there is an iterator that reads better and does the same thing:

```go
for f := range t.Fields() {
	// f is a reflect.StructField
}
```

It returns `iter.Seq[StructField]`. The ORM uses this form. Use the indexed loop
only when you actually need `i`.

Two things in that output matter later.

**`Lookup` is not `Get`.** `Get` returns `""` both when the tag is absent and
when it is present but empty. `Lookup` returns a second `bool` that tells them
apart. `Temp` has no `po` tag at all — a distinction the ORM needs, because "no
tag" means *skip this field* while an explicit empty tag is a mistake worth
reporting.

**Unexported fields still appear.** `notes` shows up in the walk. You must skip
it yourself with `f.IsExported()` — reflection sees it, but touching its value
panics.

## Struct tags

A struct tag is just a string literal after the field. The convention — and it
is only a convention, enforced by nothing at compile time — is
space-separated `key:"value"` pairs:

```go
Email string `po:"email,varchar(320),unique" json:"email,omitempty"`
```

Each library reads its own key and ignores the rest. `reflect` provides `Get`
and `Lookup`; **everything inside the quotes is yours to parse.** The commas in
`po:"email,varchar(320),unique"` mean nothing to Go — the ORM splits them.

The catch is that malformed tags fail silently:

```text
A raw="po:'single quotes'"        -> po=""     found=false
B raw="po: \"leading space\""     -> po=""     found=false
C raw="po:\"ok\" json:\"c\""      -> po="ok"   found=true
D raw="PO:\"uppercase\""          -> po=""     found=false
```

Three of those four are typos and none of them is an error. The field just
quietly vanishes from your schema.

`go vet` catches some of it:

```text
main.go:9:2: struct field tag `po:'single quotes'` not compatible with
reflect.StructTag.Get: bad syntax for struct tag value
```

But notice what it does **not** catch: `PO:` instead of `po:`. That is
well-formed — it is simply a key nobody reads. Vet is a good safety net and not
a complete one, which is a large part of why course 10 validates tags explicitly
rather than trusting them.

## Writing values

Reading is the easy half. Writing requires the value to be **settable**, and by
default it is not:

```text
ValueOf(u).CanSet()         = false
ValueOf(&u).Elem().CanSet() = true
unexported .CanSet()        = false
```

`reflect.ValueOf(u)` receives a **copy** — course 03's pass-by-value rule, and
reflection cannot opt out of it. Writing to that copy would be silently useless,
so the package refuses. You have to pass a pointer and step through it with
`Elem()`:

```go
v := reflect.ValueOf(&u).Elem()
v.Field(1).SetString("ada@go.dev")
```

```text
after SetString: {ID:u1 Email:ada@go.dev notes:}
```

Settability needs both conditions: **addressable** (reached through a pointer)
and **exported**. Unexported fields are never settable, whatever you do.

To build a value from nothing — which is exactly what scanning a database row
into a fresh struct is — use `reflect.New`:

```go
dst := reflect.New(reflect.TypeOf(User{})).Elem()
for f := range dst.Type().Fields() {
	name, ok := f.Tag.Lookup("po")
	if !ok {
		continue
	}
	col, _, _ := strings.Cut(name, ",")
	if val, present := row[col]; present {
		dst.FieldByName(f.Name).Set(reflect.ValueOf(val))
	}
}
```

```text
built: {ID:u2 Email:alan@go.dev notes:}
```

`reflect.New(t)` returns a `Value` holding a `*T`; `.Elem()` steps into the `T`,
which is addressable and therefore settable. That is the entire shape of the
ORM's row scanner in twelve lines.

## What panics

Reflection moves type errors from compile time to runtime, so learn the messages
now rather than in production:

```text
panic: reflect.Value.Interface: cannot return value obtained from unexported field or method
panic: reflect: reflect.Value.SetString using unaddressable value
panic: reflect: call of reflect.Value.SetInt on string Value
panic: reflect: Field index out of range
```

In order: you touched an unexported field, you forgot the pointer, you used the
wrong setter for the kind, and you indexed past `NumField()`.

They are all avoidable with a guard — `IsExported`, `CanSet`, a `Kind` check, a
bounds check — and reflection code that skips those guards will eventually be a
3am page. Course 09 is about testing precisely this kind of code.

## What it actually costs

Reflection is "slow" is repeated so often that nobody checks. Here is the
measurement, on the same struct, Go 1.26:

```text
BenchmarkDirect               2.12 ns/op     0 B/op   0 allocs/op
BenchmarkReflectFieldIndex    2.28 ns/op     0 B/op   0 allocs/op
BenchmarkReflectFieldByName  27.78 ns/op     0 B/op   0 allocs/op

BenchmarkParseUncached      536.80 ns/op   488 B/op  13 allocs/op
BenchmarkParseCached          9.66 ns/op     0 B/op   0 allocs/op
```

Read those carefully, because two of them are surprising.

**`v.Field(1)` costs the same as `u.Email`** — 2.28 ns against 2.12 ns, no
allocations. Once you hold a `reflect.Value` and an integer index, reflection is
essentially free. The folklore that it is "100× slower" is simply wrong for this
operation.

**`FieldByName` is 12× slower than `Field(i)`.** It has to search the field names
as strings on every single call. The cost is not reflection — it is the lookup.

**Reading a type's tags costs 537 ns and 13 allocations**, and caching the result
makes it 9.7 ns and zero. That is **55×**, and it is the whole argument for the
registry.

So the accurate rule is not "reflection is slow". It is:

> **Resolving a name is expensive. Using a resolved index is not.**
> Do the resolving once, cache it, and index from then on.

Which is the same shape as compiling a regex once instead of per call, or
preparing a SQL statement.

## Why this matters for the ORM

Here is the real parser, and every piece of this course is in it:

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

The `Kind` loop unwraps `*User` to `User` so callers can pass either. The `Kind`
check rejects a non-struct with an error instead of a panic. `Fields()` walks
them, `IsExported` skips `notes`, `Tag.Get("po")` pulls the tag out.

And the cache is keyed by `reflect.Type` — the 537 ns path runs **once per
model**, ever. Every query after that is the 9.7 ns path. Course 11 wraps this
map in the `sync.RWMutex` you met last course, because it is read from every
goroutine at once.

There is one more detail worth seeing. When the parser records a column it
stores the struct field index:

```go
Position: field.Index[0]
```

The scanner, however, resolves fields by name at scan time:

```go
field := destValue.FieldByName(col.GoField)
```

That is the 12× path, once per column per row. Measured on a 1000-row,
10-column result:

```text
BenchmarkScan1000RowsByName    390,875 ns/op
BenchmarkScan1000RowsByIndex    35,260 ns/op
```

About 356 µs per query spent searching for names the parser already found. Not
fatal, and not the bottleneck next to a network round trip — but it is a real
cost, and you will know exactly where it comes from when you write that scanner
in course 13.

## Exercise

Write the function course 10 begins with:

```go
func Columns(v any) ([]string, error)
```

Given any struct — or a pointer to one — return the column names from its `po`
tags, in field order. The name is everything before the first comma.

The interesting part is the edge cases, so make each one a test:

- a pointer (`&User{}`) works the same as a value
- an unexported field is skipped, not panicked on
- a field with no `po` tag is skipped
- a non-struct (`42`, `"x"`) returns an error rather than panicking

```bash
cd greet
go test ./...
```

<details>
<summary>One way to do it</summary>

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

```go
func TestColumns(t *testing.T) {
	want := []string{"id", "email"}

	got, err := Columns(User{})
	if err != nil || !slices.Equal(got, want) {
		t.Errorf("Columns(User{}) = %v, %v", got, err)
	}

	got, err = Columns(&User{})
	if err != nil || !slices.Equal(got, want) {
		t.Errorf("Columns(&User{}) = %v, %v", got, err)
	}

	if _, err := Columns(42); err == nil {
		t.Error("Columns(42) should error")
	}
}
```

Four details worth the space:

**The pointer unwrap is a loop, not an `if`.** `**User` is legal, and the real
parser loops for the same reason.

**`t == nil` is checked.** `reflect.TypeOf(nil)` returns nil, and calling `Kind()`
on it panics — so a plain `Columns(nil)` would take down the process if you only
tested the happy path.

**`Lookup`, not `Get`.** An untagged field must be skipped; `Get` cannot tell
that apart from an empty tag.

**`-` is skipped.** That is the ORM's convention for a field that exists in Go
but is not a column — relationship fields use it, as you will see in course 12.

The function returns `[]string` and not `[]reflect.StructField` deliberately: the
caller gets plain data and never has to know reflection was involved. Keeping the
reflection inside is the same instinct as course 06's generic signature — one
boundary, crossed once.

</details>

## Next

Testing. You have been writing tests since course 01, but reflection code is the
first thing in this course where the compiler stops helping — table-driven tests,
coverage, fuzzing, and what is actually worth asserting.
