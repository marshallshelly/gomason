---
title: "Setting up Go"
part: foundations
order: 1
summary: "Install Go, start a module, and learn the six CLI commands you will actually use."
topics:
  - go mod init
  - go run
  - go build
  - go test
  - gofmt
  - go vet
minutes: 25
draft: false
---

By the end of this page you will have a Go module on your disk with a passing
test in it. Everything after this course builds on that folder, so do it now
rather than reading ahead.

You need a terminal and a text editor. That is the whole setup.

## Install Go

Grab it from [go.dev/dl](https://go.dev/dl/), or use a package manager:

```bash
brew install go
```

Check it took:

```bash
go version
```

```text
go version go1.26.6 darwin/arm64
```

Any Go 1.22 or newer will work for this course. If the command is not found,
your shell cannot see Go's `bin` directory — the install page has the fix for
your platform.

## Start a module

Every Go project is a module, and a module is a folder with a `go.mod` in it:

```bash
mkdir greet && cd greet
go mod init example.com/greet
```

**Before you look — what do you think is in `go.mod`?** Most build tools would
have written a manifest with a version, a name, a licence, a scripts block.

```bash
cat go.mod
```

```text
module example.com/greet

go 1.26
```

Two lines. `example.com/greet` is the module path — the prefix other code would
use to import yours. Nothing on the internet is contacted and nothing is
downloaded. If you plan to publish, use the real location
(`github.com/yourname/greet`); otherwise `example.com/anything` is fine.

Keep this folder. Courses 02 through 09 all add files to it.

## Write something, run it

Create `main.go`:

```go
package main

import "fmt"

func Greet(name string) string {
	return fmt.Sprintf("Hello, %s!", name)
}

func main() {
	fmt.Println(Greet("Ada"))
}
```

```bash
go run .
```

```text
Hello, Ada!
```

`go run .` compiles the package in the current directory and runs it, leaving no
binary behind. The `.` matters — it means "this directory", and you will use it
constantly.

`package main` plus a `func main()` is what makes a package executable. Any other
package name produces a library instead, which is what course 02 onward will be
writing.

## Your turn: break it on purpose

Go's compiler is stricter than you expect, and its error messages are good. Find
out how strict. Add this function to `main.go` and run `go run .`:

```go
func broken() {
	var n int = "hello"
	unused := 5
}
```

**Predict how many errors you get.** There are two obvious problems — is the
unused variable one of them?

```text
./main.go:4:6:  declared and not used: n
./main.go:4:14: cannot use "hello" (untyped string constant) as int value
./main.go:5:2:  declared and not used: unused
```

Three. **An unused local variable is a compile error in Go, not a warning.** So
is an unused import. Coming from almost any other language this feels aggressive
for about a week, and then you notice you have stopped accumulating dead code.

Delete `broken` before moving on.

## Test it

Go has a test runner built in — no framework to install. Create `greet_test.go`:

```go
package main

import "testing"

func TestGreet(t *testing.T) {
	got := Greet("Ada")
	want := "Hi, Ada!"
	if got != want {
		t.Errorf("Greet(%q) = %q, want %q", "Ada", got, want)
	}
}
```

That `want` is deliberately wrong. **Run it and read the failure before you fix
it** — you will be reading these for the rest of the course:

```bash
go test ./...
```

```text
--- FAIL: TestGreet (0.00s)
    greet_test.go:9: Greet("Ada") = "Hello, Ada!", want "Hi, Ada!"
FAIL
```

The message is whatever you wrote in `t.Errorf`. Go ships no assertion library,
so the convention is to print **got and want** in that order, with `%q` so empty
strings and stray whitespace are visible.

Now change `want` to `"Hello, Ada!"` and run again:

```text
ok  	example.com/greet	0.471s
```

Red, then green. That loop is the one you will repeat in every remaining course.

## Format it

Go does not have a style debate. Mangle the spacing in `main.go` — put spaces
inside the parens, drop the indentation, remove the space after a comma:

```go
func Greet( name string ) string {
return fmt.Sprintf("Hello, %s!",name)
}
```

Ask which files are badly formatted, then fix them:

```bash
gofmt -l .     # lists files that need changing
gofmt -w .     # rewrites them in place
```

```go
func Greet(name string) string {
	return fmt.Sprintf("Hello, %s!", name)
}
```

Tabs, not spaces. Nobody chose that and nobody can change it, which is the
feature — every Go codebase you ever open is formatted identically. Set your
editor to run `gofmt` on save and forget it exists.

## Vet it

Add a deliberate mistake to `main`:

```go
fmt.Printf("%d\n", "not a number")
```

**Predict: does `go run .` fail?** A `%d` verb with a string argument.

```text
Hello, Ada!
%!d(string=not a number)
```

It compiles and runs, printing garbage. `Printf` takes `...any`, so the compiler
has nothing to object to. This is what `go vet` is for:

```bash
go vet ./...
```

```text
main.go:11:13: fmt.Printf format %d has arg "not a number" of wrong type string
```

**Vet catches what compiles but is probably wrong.** Format strings, unreachable
code, mutexes copied by value, lost context cancellations. It is fast, it has
almost no false positives, and `go test` runs a subset of it automatically. Run
the full thing before you commit.

Remove the bad `Printf` line.

## Build it

To ship a real binary:

```bash
go build -o greet .
./greet
```

```text
Hello, Ada!
```

One self-contained executable with the runtime baked in — around 2 MB, no
interpreter, no `node_modules`. Copy it to another machine of the same
OS and architecture and it runs.

## The six commands

That is the whole toolchain for this course:

| Command | What it does |
| --- | --- |
| `go mod init <path>` | Start a module |
| `go run .` | Compile and run the current package |
| `go build -o <name> .` | Produce a standalone binary |
| `go test ./...` | Run every test in the tree |
| `gofmt -w .` | Format code in place |
| `go vet ./...` | Report likely mistakes |

Two more for later: `go get` adds a dependency (course 13, when we add pgx), and
`go doc` prints documentation in your terminal — try `go doc fmt.Printf` now.

## Build something

Make `Greet("")` return `"Hello, stranger!"` instead of `"Hello, !"`.

Write the test **first**, watch it fail, then fix the function:

```bash
go test ./...   # red
go test ./...   # green
```

Then run `gofmt -l .` and `go vet ./...` over your work. Getting into that habit
now costs nothing; discovering it in course 09 costs you a rewrite.

<details>
<summary>Check yourself once it passes</summary>

```go
func Greet(name string) string {
	if name == "" {
		return "Hello, stranger!"
	}
	return fmt.Sprintf("Hello, %s!", name)
}
```

```go
func TestGreetEmpty(t *testing.T) {
	got := Greet("")
	want := "Hello, stranger!"
	if got != want {
		t.Errorf("Greet(%q) = %q, want %q", "", got, want)
	}
}
```

You now have two tests that are the same five lines with different values. That
duplication is the setup for course 09, where one table-driven test replaces
both — the idiom you will see throughout real Go code.

</details>

## Next

You have a module, a binary, a passing test, and a formatter that will never ask
your opinion. Next: Go's type system — starting with the fact that there is no
`null`, and what happens instead when you declare a variable and walk away.
