---
title: "From struct tags to a schema"
part: orm
order: 10
summary: "Parse `po:\"id,primaryKey\"` into typed metadata, including the options that a naive comma split shatters."
topics:
  - reflection
  - parsing
  - table-driven tests
minutes: 50
draft: false
---

Everything until now was the language. From here you build the ORM, and it
starts where the ORM starts: a string.

```go
type Product struct {
	ID    string  `po:"id,primaryKey,uuid"`
	Price float64 `po:"price,numeric(10,2)"`
}
```

Course 08 got you as far as `f.Tag.Lookup("po")`, which hands back
`"price,numeric(10,2)"` and stops. Everything inside those quotes is yours to
interpret. This course turns it into a column definition.

## Split it the obvious way

In your `greet` module:

```go
package main

import (
	"fmt"
	"strings"
)

func main() {
	for _, tag := range []string{
		"id,primaryKey,uuid",
		"price,numeric(10,2)",
		"status,enum(pending,active,completed)",
		"created_at,default(gen_random_uuid())",
	} {
		fmt.Printf("%-40s -> %q\n", tag, strings.Split(tag, ","))
	}
}
```

**Predict which of the four survive** before you run it.

```text
id,primaryKey,uuid                       -> ["id" "primaryKey" "uuid"]
price,numeric(10,2)                      -> ["price" "numeric(10" "2)"]
status,enum(pending,active,completed)    -> ["status" "enum(pending" "active" "completed)"]
created_at,default(gen_random_uuid())    -> ["created_at" "default(gen_random_uuid())"]
```

Two work, two shatter. Look at *why*, because the rule is narrower than it
first appears: **only a comma inside parentheses breaks.** `numeric(10,2)` is
precision and scale. `enum(pending,active,completed)` is a value list. Both
carry a comma that belongs to the option, not to the tag.

`default(gen_random_uuid())` is fine — nested parens and all — because there is
no comma in it. So is `check(age >= 0 AND age < 150)`. If you had only ever
tested with those two, you would ship this.

## Count the depth

The fix is to track how deep you are in parentheses and only split at depth
zero. Write it:

```go
func splitTag(tag string) []string {
	var parts []string
	var cur strings.Builder
	depth := 0
	for _, ch := range tag {
		switch {
		case ch == '(':
			depth++
			cur.WriteRune(ch)
		case ch == ')':
			depth--
			cur.WriteRune(ch)
		case ch == ',' && depth == 0:
			parts = append(parts, strings.TrimSpace(cur.String()))
			cur.Reset()
		default:
			cur.WriteRune(ch)
		}
	}
	return append(parts, strings.TrimSpace(cur.String()))
}
```

```text
price,numeric(10,2)                       -> ["price" "numeric(10,2)"]
status,enum(pending,active,completed)     -> ["status" "enum(pending,active,completed)"]
status,check(status IN ('a', 'b'))        -> ["status" "check(status IN ('a', 'b'))"]
```

`strings.Builder` rather than `+=`, for the reason course 02 gave: concatenating
in a loop reallocates every iteration.

Note what this is *not*. It is not a tokenizer and it does not understand
quotes — the comma in `IN ('a', 'b')` survives only because it happens to sit
inside parens too. That is enough for this grammar, and stopping there is the
right call. A tag parser that grows a lexer has usually lost an argument it
should have had about the tag format.

### Your turn: break the counter

The depth counter has a hole. Find an input where an option is **silently
swallowed** — not an error, just gone.

```go
fmt.Printf("%q\n", splitTag("id,foo)bar,notNull"))
```

```text
["id" "foo)bar,notNull"]
```

A stray `)` drives `depth` to **−1**. Every comma after it is now "inside
parens", so the rest of the tag collapses into one blob and `notNull` quietly
stops existing. Your column is nullable and nothing told you.

Decide what you want here and write the test first. Clamping at zero, or
rejecting a negative depth outright, are both defensible. The real ORM has this
same hole, and the honest reason is that no valid tag reaches it — which is an
argument for validating the input, not for trusting the splitter.

## The option grammar

After the first element (the column name), each part is one of three shapes:

```text
primaryKey        bare flag
varchar(320)      key(value)
onDelete:CASCADE  key:value
```

Parsing that looks like ten minutes of work. Here is the part that is not.

**Predict what these two produce for `fk:users(id)`:**

```go
// A: look for the paren first
if i := strings.Index(opt, "("); i != -1 { return opt[:i], opt[i+1:len(opt)-1] }
if k, v, ok := strings.Cut(opt, ":"); ok { return k, v }

// B: look for the colon first, unless a paren comes before it
paren, colon := strings.Index(opt, "("), strings.Index(opt, ":")
if colon != -1 && (paren == -1 || colon < paren) { return opt[:colon], opt[colon+1:] }
```

Run both over the whole option vocabulary:

```text
primaryKey         A=(primaryKey, )        B=(primaryKey, )
varchar(320)       A=(varchar, 320)        B=(varchar, 320)
numeric(10,2)      A=(numeric, 10,2)       B=(numeric, 10,2)
onDelete:CASCADE   A=(onDelete, CASCADE)   B=(onDelete, CASCADE)
default(NOW())     A=(default, NOW())      B=(default, NOW())
fk:users(id)       A=(fk:users, id)        B=(fk, users(id))   <-- DIFFERS
```

**Five of six agree.** The sixth is a foreign key, and version A gives you an
option named `fk:users` that nothing will ever look up. No error, no panic — the
column simply has no foreign key, and your migration is missing a `REFERENCES`
clause.

That was a real bug in this ORM, fixed in v1.18.0. It survived because the tests
covered `varchar(320)`, `default(NOW())` and `onDelete:CASCADE`, and every one
of those passes under both versions. **A colon before a paren wins**, because
the value is allowed to contain parens but the key never is.

## What you just built

The real interpreter lives in `pkg/schema/tags.go`, and its opening comment
explains why it is one file:

> This file holds the single interpretation of a `po:` struct tag, shared by the
> reflection parser and the AST loader. Both extract Go-type facts differently —
> one via reflect, one from the AST — but funnel them through `FieldMeta` and the
> functions here so a tag means exactly one thing regardless of entry point.

Two things read your tags. At runtime, reflection (course 08). At CLI time,
`go/ast`, because `pebble generate` parses source files that may not even
compile (course 14). Two implementations of one grammar is a standing invitation
to drift, and they *did* drift: for several versions the AST path silently
dropped `index`, `enum(...)` and `generated(...)`, so the CLI generated
migrations with no indexes at all.

The fix was to give the tag exactly one interpretation and let the two paths
differ only in how they gather Go-type facts:

```go
type FieldMeta struct {
	GoField      string // Go struct field name
	TypeName     string // base Go type name, pointer and slice dereferenced
	Nullable     bool   // Go type is a pointer or a sql.Null* type
	InferredType string // PostgreSQL type inferred from the Go type
	Position     int
}
```

That is the other half of a column. The tag says `varchar(320)` or says nothing;
the Go type says `string` or `*string`. **A column definition is those two
merged** — the tag wins where it is explicit, and the Go type fills the rest,
which is why `Price float64` with `po:"price"` still becomes a numeric column
and why a `*string` is nullable without you writing `null` anywhere.

## Build something

Write the parser this course has been circling:

```go
func ParseTag(tag string) (*Tag, error)

type Tag struct {
	Name    string
	Options map[string]string
}
```

Rules: split at depth zero, colon before paren, first element is the column
name. Reject an empty name and an option with an unclosed paren.

Make these table cases, and write them **before** the parser:

| tag | why it is there |
|---|---|
| `id,primaryKey` | the easy one |
| `price,numeric(10,2)` | comma inside parens |
| `status,enum(a,b,c)` | value list |
| `org_id,fk:orgs(id),onDelete:CASCADE` | colon before paren, twice |
| `created_at,default(NOW())` | nested parens |
| `-,hasMany,foreignKey(user_id)` | relationship field |

Then add the error cases (`""`, `",primaryKey"`, `"id,varchar(320"`) and a fuzz
test, using course 09's shape: *if it did not error, the column name must not be
empty.*

```bash
go test ./...
go test -fuzz=FuzzParseTag -fuzztime=30s
```

<details>
<summary>Check yourself</summary>

```go
func ParseTag(tag string) (*Tag, error) {
	parts := splitTag(tag)
	if parts[0] == "" {
		return nil, fmt.Errorf("tag %q: empty column name", tag)
	}
	t := &Tag{Name: parts[0], Options: map[string]string{}}
	for _, opt := range parts[1:] {
		if opt == "" {
			continue
		}
		paren := strings.Index(opt, "(")
		colon := strings.Index(opt, ":")
		switch {
		case colon != -1 && (paren == -1 || colon < paren):
			t.Options[opt[:colon]] = opt[colon+1:]
		case paren != -1:
			if !strings.HasSuffix(opt, ")") {
				return nil, fmt.Errorf("tag %q: option %q is missing a closing paren", tag, opt)
			}
			t.Options[opt[:paren]] = opt[paren+1 : len(opt)-1]
		default:
			t.Options[opt] = ""
		}
	}
	return t, nil
}
```

**`Options` is a `map[string]string`, and a bare flag maps to `""`.** That means
`Has("primaryKey")` is a comma-ok lookup, not a search — course 02's distinction
between "missing" and "present but empty" doing real work. Storing flags in a
separate `[]string` would force every caller to know which kind an option is.

**The `opt == ""` skip** handles a trailing or doubled comma. `"id,"` is sloppy
rather than wrong, and rejecting it buys nothing.

**Errors carry the whole tag, not just the option.** When this fires it is
inside a struct you cannot see from the message, so `tag "price,numeric(10,2"`
is the difference between finding the field and grepping for it.

The fuzzer earns its place here for the same reason it did in course 09: this is
a parser taking whatever a developer typed. Mine ran 4.7 million inputs clean
after the error cases were handled — and found nothing, which is the outcome you
want from thirty seconds of work.

</details>

## Next

You have a tag parser that runs on every field of every model. Course 11 makes
sure it runs **once** — the registry, a `map[reflect.Type]*TableMetadata` behind
the `sync.RWMutex` you built in course 07, turning course 08's 537 nanoseconds
into 9.7.
