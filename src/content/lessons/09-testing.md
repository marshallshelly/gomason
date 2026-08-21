---
title: "Testing"
part: tools
order: 9
summary: "Table-driven tests, helpers, benchmarks, and testing code that talks to a database."
topics:
  - go test
  - table-driven tests
  - t.Helper
  - fuzzing
  - testcontainers
minutes: 45
draft: false
---

Testing is in the toolchain — no framework, no assertion library, no config file.
`go test` and a `_test.go` file is the whole apparatus.

Halfway through this course you will have a function with **100% test coverage**
that crashes on a three-character input. You are going to try to find that input
by hand, fail, and then let a fuzzer find it in two hundredths of a second.

Here is the function. Put it in your `greet` module as `tags.go`:

```go
package main

import "strings"

type Tag struct {
	Name    string
	Options map[string]string
}

func Parse(s string) (*Tag, error) {
	parts := strings.Split(s, ",")
	t := &Tag{Name: parts[0], Options: map[string]string{}}
	for _, opt := range parts[1:] {
		if i := strings.Index(opt, "("); i != -1 {
			t.Options[opt[:i]] = opt[i+1 : len(opt)-1]
			continue
		}
		t.Options[opt] = ""
	}
	return t, nil
}
```

It parses `email,varchar(320),unique`. Keep it open.

## The shape of a test

A file ending `_test.go`, a function starting `Test`, one `*testing.T`:

```go
func TestParseName(t *testing.T) {
	got, err := Parse("email,unique")
	if err != nil {
		t.Fatalf("Parse() error = %v", err)
	}
	if got.Name != "emial" {
		t.Errorf("Name = %q, want %q", got.Name, "emial")
	}
}
```

The `want` is misspelled on purpose. Run it:

```text
--- FAIL: TestParseName (0.00s)
    tags_test.go:11: Name = "email", want "emial"
```

There is no `assertEqual` — you write an `if` and the message is whatever you
wrote. Which is why the convention is to always print **got and want**, in that
order, with `%q` so empty strings and stray whitespace are visible. A test that
prints only `"failed"` costs you the debugging session it was meant to save.

**`Errorf` marks the test failed and continues. `Fatalf` stops it.** Use `Fatalf`
when continuing is meaningless — a nil you are about to dereference. Use `Errorf`
for independent checks so one run reports all of them.

Fix the spelling and move on.

## Table-driven tests

Cases become data; the logic is written once. Write this against `Parse`:

```go
func TestParse(t *testing.T) {
	tests := []struct {
		name string
		tag  string
		want Tag
	}{
		{"name only", "email", Tag{Name: "email", Options: map[string]string{}}},
		{"boolean option", "id,primaryKey",
			Tag{Name: "id", Options: map[string]string{"primaryKey": ""}}},
		{"parenthesised", "email,varchar(320),unique",
			Tag{Name: "email", Options: map[string]string{"varchar": "320", "unique": ""}}},
		{"relationship", "-,hasMany",
			Tag{Name: "-", Options: map[string]string{"hasMany": ""}}},
		{"nested parens", "created_at,default(NOW())",
			Tag{Name: "created_at", Options: map[string]string{"default": "NOW()"}}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := Parse(tt.tag)
			if err != nil {
				t.Fatalf("Parse(%q) error = %v", tt.tag, err)
			}
			if got.Name != tt.want.Name {
				t.Errorf("Name = %q, want %q", got.Name, tt.want.Name)
			}
			if !maps.Equal(got.Options, tt.want.Options) {
				t.Errorf("Options = %v, want %v", got.Options, tt.want.Options)
			}
		})
	}
}
```

```bash
go test -v ./...
```

```text
--- PASS: TestParse (0.00s)
    --- PASS: TestParse/name_only (0.00s)
    --- PASS: TestParse/boolean_option (0.00s)
    --- PASS: TestParse/parenthesised (0.00s)
    --- PASS: TestParse/relationship (0.00s)
    --- PASS: TestParse/nested_parens (0.00s)
```

`t.Run` gives each case a name and its own `*testing.T`. A failure tells you
*which* input broke, and you can run one in isolation — note spaces become
underscores:

```bash
go test -v -run 'TestParse/nested_parens'
```

Adding a case is now one struct literal. That low cost is the real argument: when
a bug appears, the fix is a new row, and the row stays forever as a regression
test.

## t.Helper

Extract a repeated assertion and failures start pointing at the wrong line. Prove
it — write the same helper twice, once with `t.Helper()` as its first line and
once without, and make both fail:

```text
--- FAIL: TestWithoutHelper (0.00s)
    tags_test.go:11: Parse("email,unique").Name = "email", want "WRONG"
--- FAIL: TestWithHelper (0.00s)
    tags_test.go:31: Parse("email,unique").Name = "email", want "WRONG"
```

Line 11 is *inside the helper* — the same line for every caller, which tells you
nothing. Line 31 is the failing call. One line, and it is the difference between
a useful failure and a scavenger hunt.

Two more built-ins for anything touching disk: **`t.TempDir()`** creates a
directory unique to the test and deletes it automatically — no `defer
os.RemoveAll`, no leaked `/tmp` junk. **`t.Cleanup(func(){...})`** registers
teardown that runs when the test finishes, and unlike `defer` it works from
inside a helper, so a helper that opens a database can register its own teardown.
Course 14 uses both.

## Coverage says you are done

```bash
go test -cover ./...
```

```text
ok  example.com/greet  0.506s  coverage: 100.0% of statements
```

**100%.** Five cases, all passing, every statement executed.

Now find the bug. `Parse` crashes on some inputs — **spend two minutes trying to
find one by hand** before reading on. Look at the line that slices out the value
between parentheses.

Coverage measures **which lines ran**, not **which inputs you considered**. Every
line of a parser can execute while every interesting input goes untried. It is
useful for the opposite question — *what has no test at all* — and a bad target,
because it is trivially satisfied by tests that assert nothing.

## Let a fuzzer find it

A fuzz test states a **property** that must hold for every input, and Go
generates the inputs. Write this:

```go
func FuzzParse(f *testing.F) {
	f.Add("email")
	f.Add("id,primaryKey")
	f.Add("email,varchar(320),unique")

	f.Fuzz(func(t *testing.T, s string) {
		tag, err := Parse(s)
		if err != nil {
			return
		}
		if tag.Name == "" && s != "" {
			t.Errorf("Parse(%q) produced an empty name", s)
		}
	})
}
```

`f.Add` seeds the corpus; the fuzzer mutates from there. The property is
deliberately weak — *if it did not error, the name must not be empty* — plus the
one you get free: **it must not panic.**

```bash
go test -fuzz=FuzzParse -fuzztime=30s
```

```text
fuzz: elapsed: 0s, execs: 105 (4711/sec)
--- FAIL: FuzzParse (0.02s)
    fuzz_test.go:16: Parse(",0") produced an empty name
```

**105 executions.** A tag starting with a comma parses to an empty column name,
which would become `SELECT "" FROM users` downstream. Reject it — return an error
when `parts[0]` is empty — and run again:

```text
--- FAIL: FuzzParse (0.02s)
    testing.go:1927: panic: runtime error: slice bounds out of range [1:0]
        example.com/greet.Parse(...)
        	.../tags.go:21

    Failing input written to testdata/fuzz/FuzzParse/9718a8a790e1adf7
```

There it is — the panic in the function with 100% coverage. Open the file it
wrote:

```text
go test fuzz v1
string("0,(")
```

An option with an opening paren and no closing one. `opt[i+1 : len(opt)-1]` on
`"("` asks for `[2:0]`.

Now notice what the fuzzer did: **it wrote the failing input into `testdata/`**.
That file is source. Commit it, and from then on plain `go test` replays it — the
crasher is a permanent regression test that costs nothing to maintain.

Fix it the way the real ORM does — an option containing `(` must end with `)` or
it is a malformed tag and an error — then run the fuzzer again:

```text
fuzz: elapsed: 30s, execs: 13792038 (709555/sec), new interesting: 207
PASS
```

**13.8 million inputs, clean.**

Now re-run coverage on your fixed code:

```text
ok  example.com/greet  0.554s  coverage: 83.3% of statements
```

**The code got more correct and coverage went down**, because correct code has
error branches your five original cases never touch. Anyone managing to a
coverage number would read that as a regression. Add rows for the two error cases
and watch it climb back.

Fuzzing is not for everything. It fits code taking untrusted or weakly-structured
input that must never crash: parsers, decoders, anything splitting a string on
delimiters. Which is exactly what you write in course 10.

## Testing code that needs a database

Most of the ORM needs no database, and that is a design decision. The query
builders expose:

```go
func (q *SelectQuery[T]) ToSQL() (string, []any, error)
```

Building the SQL is separated from running it, so column quoting, placeholder
numbering and join ordering are a pure function from a query to a string — tested
table-driven, instantly, with nothing running.

**If testing something requires a database, that is often a hint that the logic
and the I/O are tangled.** Pulling them apart usually improves both.

Some things genuinely need Postgres. Two mechanisms keep them out of the fast
loop. **`testing.Short()`** lets a test opt out:

```go
if testing.Short() {
	t.Skip("skipping: needs a database")
}
```

```text
--- SKIP: TestSlowThing (0.00s)
    skipping: needs a database
```

**Build tags** exclude the file from compilation entirely — `//go:build
integration` as the first line, above `package`. Without `-tags=integration` the
file does not exist as far as the compiler is concerned, which beats `Short()`
when the file itself imports heavy dependencies.

The ORM uses [testcontainers](https://golang.testcontainers.org/), starting a
real PostgreSQL container per run and discarding it after. Slower than a mock and
worth it: **a mock of Postgres tests your beliefs about Postgres**, and the
migration bugs you will hit all live in the gap between those beliefs and the
real thing.

## What the ORM does

Three Makefile targets you will recognise:

```make
test:              go test -v -race ./...
test-unit:         go test -v -race -short ./...
test-integration:  go test -v -race -run Integration ./...
```

`-race` on all of them — course 07's detector, because a metadata cache read from
every goroutine is exactly what it exists to check.

One test file is worth calling out. The ORM reads struct tags **two ways** — by
reflection at runtime, and by parsing source with `go/ast` for the CLI, which
cannot import your models. Two implementations of one set of rules is a standing
invitation to drift, so a test runs both over the same input and asserts the
output is identical.

That test checks the two parsers against **each other**, not against a
hand-written expectation. When you write the AST loader in course 14, it is the
test that saves you.

## Build something

Take the `Columns` function from course 08 and give it the full treatment:

1. **Convert its tests to table-driven form** with `t.Run` subtests.
2. **Add a `t.Helper()` assertion** for "these columns, in this order".
3. **Write a fuzz test.** You will need a target taking a `string` rather than a
   `reflect.Type` — extract the tag-splitting into its own function.
4. **Check coverage before and after** handling the error cases, and watch the
   number move the wrong way.

```bash
go test -cover ./...
go test -fuzz=Fuzz -fuzztime=30s
```

Commit any `testdata/` file the fuzzer writes.

<details>
<summary>Check yourself</summary>

```go
func splitTag(tag string) (name string, opts []string) {
	parts := strings.Split(tag, ",")
	return parts[0], parts[1:]
}

func assertColumns(t *testing.T, v any, want []string) {
	t.Helper()
	got, err := Columns(v)
	if err != nil {
		t.Fatalf("Columns(%T) error = %v", v, err)
	}
	if !slices.Equal(got, want) {
		t.Errorf("Columns(%T) = %v, want %v", v, got, want)
	}
}

func TestColumnsErrors(t *testing.T) {
	for _, input := range []any{42, "x", nil, []User{}} {
		t.Run(fmt.Sprintf("%T", input), func(t *testing.T) {
			if _, err := Columns(input); err == nil {
				t.Errorf("Columns(%v) should error", input)
			}
		})
	}
}
```

**The error cases are a separate test.** The success cases share an assertion
helper and a `want`; the error cases share neither. Forcing both into one table
needs a `wantErr bool` and a branch at the top of the loop — the point where a
table stops being clearer than two tests.

**`t.Run(fmt.Sprintf("%T", input))`** names subtests by type, so a failure reads
`TestColumnsErrors/int` rather than `#2`.

**`splitTag` returning `(string, []string)` is what makes fuzzing possible.**
`Columns` takes an `any`, and the fuzzer cannot generate those — it produces
strings, bytes, ints and a few other basic types. Extracting the string handling
is what let it be fuzzed at all, which is the general lesson: **fuzzable code and
well-factored code are the same code.**

</details>

## Next

That is the last of the language. From here every course builds the ORM itself,
starting where it starts: turning a struct tag into a column definition, with
course 08's reflection and this course's tests.
