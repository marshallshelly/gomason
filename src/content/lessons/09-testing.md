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

Testing is in the toolchain. There is no framework to choose, no assertion
library to argue about, and no configuration file — `go test` and a `_test.go`
file is the whole apparatus.

That minimalism is the point of this course, but not the interesting part. The
interesting part is the middle section, where a function with **100% test
coverage** turns out to crash on a three-character input, and the fuzzer finds
it in two hundredths of a second.

Every course from here builds part of the ORM, and every one ends with tests.
This is where you learn what those tests are actually worth.

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

```text
--- FAIL: TestParseName (0.00s)
    tags_test.go:11: Name = "email", want "emial"
FAIL
```

There is no `assertEqual`. You write an `if` and call `t.Errorf`, and the failure
message is whatever you wrote — which is why the Go convention is to always print
**got and want**, in that order, with `%q` for strings so empty and whitespace
values are visible. A message that says only `"test failed"` costs you the debug
session it was supposed to save.

**`Errorf` marks the test failed and keeps going. `Fatalf` stops it.** Use
`Fatalf` when continuing would be meaningless — a nil result you are about to
dereference, an error where you expected none. Use `Errorf` for independent
checks, so one run tells you about all of them.

## Table-driven tests

This is *the* Go testing idiom. Cases are data; the logic is written once:

```go
func TestParse(t *testing.T) {
	tests := []struct {
		name string
		tag  string
		want Tag
	}{
		{
			name: "boolean option",
			tag:  "id,primaryKey",
			want: Tag{Name: "id", Options: map[string]string{"primaryKey": ""}},
		},
		{
			name: "parenthesised value",
			tag:  "email,varchar(320),unique",
			want: Tag{Name: "email", Options: map[string]string{"varchar": "320", "unique": ""}},
		},
		// ...
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := Parse(tt.tag)
			if err != nil {
				t.Fatalf("Parse(%q) error = %v", tt.tag, err)
			}
			if !maps.Equal(got.Options, tt.want.Options) {
				t.Errorf("Options = %v, want %v", got.Options, tt.want.Options)
			}
		})
	}
}
```

`t.Run` gives each case its own name and its own `*testing.T`:

```text
--- PASS: TestParse (0.00s)
    --- PASS: TestParse/name_only (0.00s)
    --- PASS: TestParse/boolean_option (0.00s)
    --- PASS: TestParse/parenthesised_value (0.00s)
    --- PASS: TestParse/relationship_marker (0.00s)
    --- PASS: TestParse/nested_parens (0.00s)
```

Two payoffs. A failure names the case, so you know *which* input broke without
counting rows. And you can run one case in isolation — note that spaces in the
name become underscores:

```bash
go test -v -run 'TestParse/nested_parens'
```

Adding a case is now one struct literal. That low cost is the real argument: when
a bug shows up, the fix is a new row and a one-line change, and the row stays
forever as a regression test.

## t.Helper

Extract a repeated assertion into a function and failures start pointing at the
wrong line. Here are two identical helpers, one with `t.Helper()` and one
without, both failing:

```text
--- FAIL: TestWithoutHelper (0.00s)
    tags_test.go:11: Parse("email,unique").Name = "email", want "WRONG"
--- FAIL: TestWithHelper (0.00s)
    tags_test.go:31: Parse("email,unique").Name = "email", want "WRONG"
```

Line 11 is *inside the helper* — the same line for every caller, which tells you
nothing. Line 31 is the call in the failing test, which is what you wanted.

`t.Helper()` is one line at the top of any test function that takes a
`*testing.T` and can fail. Cheap, and it makes the difference between a useful
failure and a scavenger hunt.

## Temp files and cleanup

Two more built-ins worth knowing before you test anything that touches disk:

```go
func tempSchema(t *testing.T, body string) string {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "schema.go")
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	return path
}
```

`t.TempDir()` creates a directory unique to the test and **deletes it
automatically**, so no `defer os.RemoveAll` and no leaked `/tmp` junk:

```text
created  /var/folders/.../TestTempDir769640098/001/schema.go
```

`t.Cleanup(func(){ ... })` registers work to run when the test finishes,
last-registered-first. It beats `defer` because it also runs from inside
helpers — a helper that opens a database can register its own teardown, and the
test never has to know.

You will use both in course 14, which parses Go source files from disk.

## Coverage, and why it lies

Run the table-driven suite above with coverage:

```bash
go test -cover ./...
```

```text
ok  example.com/tags  0.506s  coverage: 100.0% of statements
```

**100.0%.** Five cases, all passing, every statement executed. By the usual
metric this function is done.

It crashes on a three-character input.

Coverage measures **which lines ran**, not **which inputs you thought about**.
Every line of a parser can execute while every interesting input goes untried.
It is a genuinely useful tool for the opposite question — *what has no test at
all* — and a bad target, because it is trivially satisfiable by tests that assert
nothing.

Here is the sharpest version of that. After fixing the crash below, coverage on
the same test suite:

```text
ok  example.com/tags  0.554s  coverage: 83.3% of statements
```

The code got **more correct** and coverage went **down**, because correct code
has error branches and the old tests do not exercise them. Anyone managing to a
coverage number would read that as a regression.

## Fuzzing

A fuzz test states a **property** that must hold for *every* input, and Go
generates the inputs:

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

`f.Add` seeds the corpus with known-good inputs; the fuzzer mutates them. The
property here is deliberately weak — *if it did not return an error, the name
must not be empty* — plus the one you get for free: **it must not panic.**

```bash
go test -fuzz=FuzzParse -fuzztime=30s
```

```text
fuzz: elapsed: 0s, execs: 105 (4711/sec), new interesting: 0 (total: 3)
--- FAIL: FuzzParse (0.02s)
    fuzz_test.go:16: Parse(",0") produced an empty name
```

**105 executions.** A tag starting with a comma parses to an empty column name —
which would produce `SELECT "" FROM users` further down the line. Fixed by
rejecting it, then run again:

```text
--- FAIL: FuzzParse (0.02s)
    testing.go:1927: panic: runtime error: slice bounds out of range [1:0]
        example.com/tags.Parse({0x1f25f3ba6885, 0x3})
        	.../tags.go:21

    Failing input written to testdata/fuzz/FuzzParse/9718a8a790e1adf7
```

The panic, in the function with 100% coverage. The input:

```text
go test fuzz v1
string("0,(")
```

An option with an opening paren and no closing one. The code does
`opt[i+1 : len(opt)-1]`, which for `"("` asks for `[2:0]`.

Look at what the fuzzer did with it: **it wrote the failing input into
`testdata/`**. That file is source, you commit it, and from then on plain
`go test` replays it — the crasher is now a permanent regression test that costs
nothing to maintain. Fuzzing found the bug; the corpus keeps it dead.

The fix is the guard the real ORM uses — an option containing `(` must end with
`)`, or it is a malformed tag and an error. Then:

```text
fuzz: elapsed: 30s, execs: 13792038 (709555/sec), new interesting: 207
PASS
```

**13.8 million inputs in 30 seconds**, clean.

Fuzzing is not for everything. It fits code that takes untrusted or
weakly-structured input and must never crash on it: parsers, decoders, anything
splitting a string on delimiters. That is exactly what a struct-tag parser is,
which is why this course sits immediately before you write one.

## Testing code that needs a database

Most of the ORM can be tested with no database at all, and that is a design
decision rather than a lucky accident — the query builders expose:

```go
func (q *SelectQuery[T]) ToSQL() (string, []interface{}, error)
```

Building the SQL is separated from running it, so the interesting logic — column
quoting, placeholder numbering, join ordering — is a pure function from a query
to a string. Its tests are table-driven, instant, and need nothing running:

```go
sql, args, err := query.ToSQL()
```

**If testing something requires a database, that is often a hint the logic and
the I/O are tangled.** Pulling them apart usually makes both better. Course 12
leans on this heavily.

Some things genuinely need Postgres, though — you cannot unit-test whether your
migration actually applies. Two mechanisms keep those out of the fast loop.

**`testing.Short()`** lets a test opt out:

```go
if testing.Short() {
	t.Skip("skipping: needs a database")
}
```

```text
--- SKIP: TestSlowThing (0.00s)
    skipping: needs a database
```

**Build tags** exclude the file from compilation entirely:

```go
//go:build integration
```

That line must be the first thing in the file, above `package`. Without
`-tags=integration` the file does not exist as far as the compiler is concerned —
better than `Short()` when the test file itself imports heavy dependencies.

The ORM uses [testcontainers](https://golang.testcontainers.org/), which starts a
real PostgreSQL container per run and throws it away after. Slower than a mock
and worth it: a mock of Postgres tests your beliefs about Postgres, and the
migration bugs you will hit are all in the gap between those beliefs and the real
thing.

## Why this matters for the ORM

The ORM's Makefile is three lines you will recognise:

```make
test:              go test -v -race ./...
test-unit:         go test -v -race -short ./...
test-integration:  go test -v -race -run Integration ./...
```

`-race` on all of them — course 07's detector, because a metadata cache read from
every goroutine is exactly what it exists to check. `-short` for the fast loop
you run constantly. The integration target for the slow one you run before
pushing.

Fifty test files across the packages, and the pattern is consistent: table-driven
tests over `ToSQL()` output for the builders, table-driven tests over parsed tags
for the schema package, and a small number of container-backed tests for
migrations.

One of those files is worth calling out now, because it is a shape you may not
have seen. The ORM reads struct tags **two different ways** — by reflection at
runtime, and by parsing the source with `go/ast` for the CLI, which cannot import
your models. Two implementations of the same rules is a standing invitation for
drift, so there is a test that runs both over the same input and asserts the
output is identical.

That test does not check either parser against a hand-written expectation. It
checks them against **each other**. When you write the AST loader in course 14,
it is the test that will save you.

## Exercise

Take the `Columns` function you wrote in course 08 and give it the treatment:

1. **Convert its tests to table-driven form** with `t.Run` subtests — the
   pointer, unexported, untagged, `-`, and non-struct cases as rows.
2. **Add a `t.Helper()`-based assertion** for "these columns, in this order".
3. **Write a fuzz test.** The property: for any string, building a struct tag
   from it and parsing must never panic. You will need a target that takes a
   `string` rather than a `reflect.Type` — extract the tag-splitting into its own
   function, which is worth doing anyway.
4. **Check coverage before and after** you handle the error cases, and see the
   number move the wrong way.

```bash
go test -cover ./...
go test -fuzz=Fuzz -fuzztime=30s
```

If the fuzzer finds something, commit the `testdata/` file it writes.

<details>
<summary>One way to do it</summary>

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

func TestColumns(t *testing.T) {
	want := []string{"id", "email"}

	tests := []struct {
		name  string
		input any
	}{
		{"value", User{}},
		{"pointer", &User{}},
		{"populated", User{ID: "u1"}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assertColumns(t, tt.input, want)
		})
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

func FuzzSplitTag(f *testing.F) {
	f.Add("id,primaryKey")
	f.Add("email,varchar(320),unique")
	f.Add("-,hasMany")

	f.Fuzz(func(t *testing.T, tag string) {
		name, opts := splitTag(tag)
		if name == "" && len(opts) == 0 && tag != "" {
			t.Errorf("splitTag(%q) dropped everything", tag)
		}
	})
}
```

Three things worth noticing.

**The error table is a separate test.** The success cases share an assertion
helper and a `want`; the error cases share neither. Forcing both into one table
means a `wantErr bool` field and an `if` at the top of the loop body, which is
the point where a table stops being clearer than two tests.

**`t.Run(fmt.Sprintf("%T", input))`** names subtests by type, so a failure says
`TestColumnsErrors/int` rather than `#2`. Subtest names should identify the case
without you counting.

**`splitTag` returning `(string, []string)` is what makes the fuzz test
possible.** `Columns` takes an `any` and the fuzzer cannot generate those — it
produces strings, bytes, ints, and a handful of other basic types. Extracting the
string-handling into its own function is what let it be fuzzed at all, and that
is the general lesson: **fuzzable code and well-factored code are the same
code.**

</details>

## Next

That is the last of the language. From here every course builds the ORM itself,
starting where it starts: turning a struct tag into a column definition, with
reflection from course 08 and the tests from this one.
