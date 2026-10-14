---
title: "The AST loader"
part: orm
order: 14
summary: "Read struct tags out of source files with go/ast — no compilation required."
topics:
  - go/ast
  - go/parser
  - file walking
minutes: 50
draft: false
---

Course 08's reflection needs a `reflect.Type`, which means your models must
compile and be imported. The CLI cannot have either.

`pebble generate` runs in the middle of a refactor, on a package with a half
-written model and a missing import, and it still has to produce a migration.
And it cannot import your models at all — a CLI compiled months ago has no way
to link against code you wrote this morning.

So the CLI reads your source as **text with structure**. By the end of this
course you will have two readers of one grammar, which is a problem, and a test
that keeps them honest, which is the answer.

## Predict: will this parse?

Put this in a file. It has a nonexistent import, an undefined type, and a
function that returns a string from a signature with no return value:

```go
package models

import "nonexistent/package/that/does/not/exist"

// table_name: users
type User struct {
	ID    string `po:"id,primaryKey,uuid"`
	Email string `po:"email,varchar(320),unique"`
	Owner undefinedType
}

func (u User) Broken() {
	return "this is not even valid Go semantics"
}
```

Now parse it:

```go
fset := token.NewFileSet()
node, err := parser.ParseFile(fset, "models.go", nil, parser.ParseComments)
fmt.Println("parse error:", err)
fmt.Println("package name:", node.Name.Name)
```

**Predict the error.** Three separate things in that file would stop a compiler.

```text
parse error: <nil>
package name: models
```

Nothing. `go/parser` builds a **syntax** tree. It checks that the tokens form
grammatical Go and stops there. It does not resolve imports, does not look up
`undefinedType`, and does not type-check a single expression — type checking is
a different package (`go/types`) that you are not going to use.

That is the whole trick. Syntactic validity is a much lower bar than
compilability, and it is all you need to find a struct and read its tags.

## Walking to the tags

The tree you want is three levels down. A file has declarations; a type
declaration is a `*ast.GenDecl` with `Tok == token.TYPE`; its spec is a
`*ast.TypeSpec`; and the interesting ones have a `*ast.StructType`:

```go
for _, d := range node.Decls {
	gd, ok := d.(*ast.GenDecl)
	if !ok || gd.Tok != token.TYPE {
		continue
	}
	for _, spec := range gd.Specs {
		ts := spec.(*ast.TypeSpec)
		st, ok := ts.Type.(*ast.StructType)
		if !ok {
			continue
		}
		fmt.Printf("struct %s, doc=%q\n", ts.Name.Name, strings.TrimSpace(gd.Doc.Text()))
		for _, f := range st.Fields.List {
			// f.Tag, f.Names, f.Type
		}
	}
}
```

```text
struct User, doc="table_name: users"
  ID     raw=`po:"id,primaryKey,uuid"`
  Email  raw=`po:"email,varchar(320),unique"`
  Owner  raw=
```

That is a type switch per level — course 05's machinery, applied to a tree. It
is tedious and it is not hard.

Two details worth having now. **`gd.Doc` is the doc comment**, which is where
`// table_name:` and the other table-level directives live, and you only get it
if you pass `parser.ParseComments`. And **`f.Names` is a slice**, because
`A, B string` is one field with two names, while an embedded field has none at
all.

## Predict: what is in f.Tag.Value?

You have the tag. Compare it to what reflection gives for the same struct:

```go
type Odd struct {
	A string `po:"a,primaryKey"`
	B string "po:\"b,varchar(10)\""
}
```

Field `B` is legal Go — a struct tag may be *any* string literal, and `gofmt`
leaves it alone. **Predict what each reader sees.**

```text
reflection (ground truth):
  A -> po="a,primaryKey"
  B -> po="b,varchar(10)"

the AST, with strings.Trim(raw, "`"):
  A -> po="a,primaryKey"
  B -> po=""                      <-- gone
```

`f.Tag.Value` is the **raw source literal, delimiters included** — backticks and
all. Stripping backticks works for the common form and silently fails for the
other one, and a field whose tag is invisible becomes a column that does not
exist.

The right tool is `strconv.Unquote`, which understands every Go string literal:

```text
Unquote:
  A -> po="a,primaryKey"
  B -> po="b,varchar(10)"
```

This ORM gets it wrong. Both tag sites in `pkg/loader` use
`strings.Trim(field.Tag.Value, "`")`. Run the real loader over that struct and
the column is simply absent:

```text
loader registered 1 table(s)
table "odds" columns:
  a    sql=text
```

One column, not two. `b` is gone from every CLI-generated migration while the
runtime sees it normally. Nobody writes tags that way on purpose — you would
have to escape every quote — which is exactly why it survived.

## What the AST cannot know

Reflection hands you a `reflect.Type`: identity, kind, the lot. The AST hands
you **names**. Sometimes that is the same thing and sometimes it is not.

Nullability is the clearest case. A pointer is visible in the syntax, so this
works:

```go
case *ast.StarExpr:
	return true
```

A `sql.NullString` is not a pointer, so it needs a second rule — and the only
thing available is the name:

```go
case *ast.SelectorExpr:
	if x, ok := t.X.(*ast.Ident); ok && x.Name == "sql" && strings.HasPrefix(t.Sel.Name, "Null") {
		return true
	}
```

**Predict what that does with an aliased import:**

```go
import (
	"database/sql"
	stdsql "database/sql"
)

type T struct {
	A sql.NullString
	B stdsql.NullString
	C *string
}
```

```text
A  nullable=true
B  nullable=false      <-- same type
C  nullable=true
```

`stdsql.NullString` and `sql.NullString` are the identical type. The function
matched the *qualifier*, not the type.

Now run the **real loader** over that model and see whether it matters:

```text
a  nullable=true
b  nullable=true       <-- correct, despite the above
c  nullable=true
```

It does not. The column is nullable anyway, because nullability is decided by
default rather than by the Go type:

```go
column.Nullable = !opts.Has("notNull") && !opts.Has("primaryKey")
if fm.Nullable {
	column.Nullable = true
}
```

A column is nullable **unless the tag says otherwise**, and the Go type can only
force it *on*, never off. So `astNullable` returning the wrong answer is masked —
right up until the tag contradicts the type:

```text
d  sql.NullString    + notNull -> nullable=true    (the Go type wins)
e  stdsql.NullString + notNull -> nullable=false   <-- diverges
```

Reflection says `true` for both, because it sees the real type whatever the
import is called. So the bug is real and it is **one corner wide**: an aliased
`database/sql` plus an explicit `notNull` on the same field.

The fix is available — `parser.ParseFile` returns `node.Imports`, so you can map
each local name to its import path and check the path rather than the qualifier.

That gap between "the function is wrong" and "the output is wrong" is worth
sitting with. I found the first by reading the code, assumed the second, and was
wrong until I ran the real loader. A default was hiding it. Defaults move.

## Two readers, one grammar

So you have reflection reading tags at runtime and `go/ast` reading them at CLI
time. The danger is obvious in hindsight and was not obvious at the time: they
drift.

They did here. For several releases the AST path silently dropped `index`,
`enum(...)` and `generated(...)` — so `pebble generate --models` produced
migrations with **no indexes at all**, and with `--db` the differ saw an
index-free code schema and generated `DROP INDEX` against production.

The fix was structural rather than more careful copying. Give the tag exactly
one interpretation and let the two paths differ *only* in how they gather
Go-type facts:

```go
type FieldMeta struct {
	GoField      string // Go struct field name
	TypeName     string // base Go type name, pointer and slice dereferenced
	Nullable     bool   // pointer or sql.Null*
	InferredType string // PostgreSQL type inferred from the Go type
	Position     int
}
```

Reflection fills that in from a `reflect.StructField`. The AST fills it in from
an `ast.Expr` with `astTypeName`, `astNullable` and `astInferPGType`. Both then
call the *same* `BuildColumn`. Adding a tag option means editing one function.

That is the same answer as course 10's `splitTag` and course 13's
`queryExecutor`: when two things must agree, do not write them twice — give
them one implementation and one narrow seam.

## The test that keeps them honest

Course 09 promised this test would save you here. It runs both readers over the
same model and asserts the output is identical:

```go
const paritySource = `package models
// table_name: memberships
type Membership struct {
	ID    int64  ` + "`po:\"id,primaryKey,identityAlways\"`" + `
	Email string ` + "`po:\"email,varchar(320),unique,notNull\"`" + `
	// ...
}
`
```

It writes that to a temp file (course 09's `t.TempDir()`), runs the AST loader
over it, registers the same struct by reflection, and compares.

What makes it valuable is that it checks the two paths **against each other**
rather than against a hand-written expectation. Nobody has to keep a list of
what the metadata should be. Add a tag option to one path and the test fails
until the other agrees.

And it is worth being precise about what it does not buy you. Look at how
`paritySource` builds its tags: string concatenation, producing **backticks
every time**. So it cannot catch the double-quoted tag from earlier in this
course, and it has no aliased import with a contradictory `notNull`, so it
cannot catch the nullability corner either. A parity test proves the paths agree
**on the inputs you gave it**. Both bugs in this course live in the gap between
that and "agree on all valid Go".

## Build something

Write the loader's core:

```go
func LoadModels(path string) ([]*TableMetadata, error)
```

Parse every `.go` file under `path` with `parser.ParseComments`, find each struct,
read its `po` tags, read its `// table_name:` doc comment, and return metadata in
the same shape course 10's parser produces.

Use `strconv.Unquote` on `f.Tag.Value`, not `strings.Trim`.

Then write the parity test, because it is the point of the exercise:

1. Build a source string with a model in it. Write it to `t.TempDir()`.
2. Run your AST loader over the file.
3. Register the **same struct**, declared normally in your test file, through
   course 11's reflection registry.
4. Assert the two sets of metadata are equal.

Then make it fail on purpose: add a tag option to one path only.

```bash
go test -race ./...
```

<details>
<summary>Check yourself</summary>

```go
func tagValue(f *ast.Field) string {
	if f.Tag == nil {
		return ""
	}
	unquoted, err := strconv.Unquote(f.Tag.Value)
	if err != nil {
		return strings.Trim(f.Tag.Value, "`") // malformed literal; do what we can
	}
	return reflect.StructTag(unquoted).Get("po")
}
```

**`reflect.StructTag` on a string from the AST.** The type is just a string with
a `Get` method, so you can use the standard library's own tag parser on text that
never came from a real struct. No reason to write a second one.

**The `Unquote` error falls back rather than failing.** A tag literal that will
not unquote is a syntax error the compiler will report far better than you can,
and refusing to generate a migration over it is worse than generating one.

Two things about comparing metadata in the parity test:

**Compare field by field, not with `reflect.DeepEqual` on the whole struct.**
`TableMetadata` carries a `GoType reflect.Type` that the AST path cannot possibly
fill in, so `DeepEqual` fails for a reason that is not a bug. Compare the fields
that both paths are responsible for.

**Sort before comparing anything map-derived.** Course 02: map iteration order is
not guaranteed, and the reflection path walks fields while some of the AST path's
collections come from maps. A parity test that fails one run in twenty teaches
people to re-run it.

</details>

## Next

The last course. Metadata from either reader, a live database, and the question
the whole ORM has been building toward: what is the difference between them, and
what SQL closes it. Introspect, diff, plan, generate.
