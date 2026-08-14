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

By the end of this course you will have a Go module on disk, a program that runs,
a test that passes, and a working understanding of the six commands you will type
for the rest of the series. No ORM yet. Just the ground.

The Go toolchain is unusually small. There is no separate build tool, no
formatter to choose, no test runner to install, no linter config to argue about.
That is the whole point, and it is worth ten minutes to see the shape of it
before we build anything.

## Install Go

Download it from [go.dev/dl](https://go.dev/dl/), or use a package manager:

```bash
# macOS
brew install go

# Debian / Ubuntu
sudo apt install golang-go

# Windows
winget install GoLang.Go
```

Check it worked:

```bash
go version
```

```text
go version go1.26.5 darwin/arm64
```

Anything from 1.22 onwards will do for this course. We use generics heavily from
course 06 onwards, which landed in 1.18.

You do **not** need to set `GOPATH`. You may find blog posts insisting that you
put all your code in `~/go/src` — those predate modules, which arrived in Go 1.11
and became the default in 1.16. Your code can live anywhere now.

## Start a module

Make a directory and initialise a module in it:

```bash
mkdir greet && cd greet
go mod init example.com/greet
```

```text
go: creating new go.mod: module example.com/greet
```

That created one file:

```text
module example.com/greet

go 1.26.5
```

A **module** is a collection of packages versioned together. The line
`module example.com/greet` is the module path, and it is the prefix other code
uses to import yours.

The module path is not a URL that gets fetched — nothing dials
`example.com` — but it should be one you could own, because if you ever publish
the module, that is where Go will look. For real projects use the repository
you will push to:

```bash
go mod init github.com/yourname/greet
```

For throwaway work, `example.com/anything` is conventional and deliberately
unownable.

## Write something

Create `main.go`:

```go
package main

import "fmt"

func main() {
	fmt.Println(Greet("world"))
}

func Greet(name string) string {
	return fmt.Sprintf("Hello, %s!", name)
}
```

Three things are already worth naming.

`package main` is special: it tells Go this package builds into an executable
rather than a library, and that executable starts at `func main()`. Every other
package you write in this course will have a different name and will not have a
`main` function.

`Greet` is capitalised, and that is not a style choice. In Go, an identifier
starting with an uppercase letter is **exported** — visible outside its package.
Lowercase means package-private. There is no `public` or `private` keyword;
the case of the first letter is the access control. We will lean on this hard
when designing the ORM's packages.

The tab indentation is not a preference either. We will get to that in a moment.

## Run it

```bash
go run .
```

```text
Hello, world!
```

`go run .` compiles the package in the current directory to a temporary location
and executes it. The `.` matters: `go run main.go` also works here, but it only
compiles the files you name, so it breaks the moment your package spans several
files. Get in the habit of `go run .` now.

## Build it

```bash
go build -o greet .
./greet
```

```text
Hello, world!
```

`go build` produces a real binary in your directory. Note the size:

```bash
ls -lh greet
```

That binary is around 2.5 MB, and it has no dependencies — not even a C library
in most cases. You can copy it to another machine of the same OS and
architecture and it runs. This is a large part of why Go is used for
command-line tools and servers, and it is why the `pebble` CLI you build later
ships as a single file.

## Test it

Go has a test runner built in. Create `greet_test.go`:

```go
package main

import "testing"

func TestGreet(t *testing.T) {
	got := Greet("Ada")
	want := "Hello, Ada!"
	if got != want {
		t.Errorf("Greet(%q) = %q, want %q", "Ada", got, want)
	}
}
```

The rules are conventions, enforced by the tool:

- the file must end in `_test.go`
- the function must start with `Test` and take `*testing.T`

Run it:

```bash
go test ./...
```

```text
ok  	example.com/greet	0.471s
```

The `./...` means "this directory and everything under it". You will type it
constantly.

Break it on purpose — change `want` to `"Hi, Ada!"` — and look at the failure:

```text
--- FAIL: TestGreet (0.00s)
    greet_test.go:9: Greet("Ada") = "Hello, Ada!", want "Hi, Ada!"
FAIL
FAIL	example.com/greet	0.447s
FAIL
```

There is no assertion library here and you will not need one. `t.Errorf` with
`%q` — which quotes strings and makes trailing whitespace visible — covers most
of what an assertion library would give you. Course 09 goes deeper on testing;
this is enough to check your own work until then.

Put `want` back.

## Format it

Go ships one formatter and there is nothing to configure. Write something ugly:

```go
package main

func messy(  a int,b string ) string {
if a>0 {
return b
}
return ""
}
```

Then:

```bash
gofmt -w messy.go
```

```go
package main

func messy(a int, b string) string {
	if a > 0 {
		return b
	}
	return ""
}
```

Tabs for indentation, spaces around binary operators, no space inside
parentheses. You do not get a vote, and that is the feature: no Go project has
ever had a formatting argument in code review.

`gofmt -l .` lists files that need formatting without changing them, which is
what you would run in CI:

```bash
gofmt -l .
```

```text
messy.go
```

Set your editor to run `gofmt` on save and then forget it exists.

## Vet it

`go vet` catches mistakes the compiler allows but which are almost certainly
wrong. The classic example is a format string that does not match its arguments:

```go
name := "Ada"
fmt.Printf("Hello, %d!\n", name)
```

This compiles — `Printf` takes `...any`, so the compiler has nothing to object
to. It just prints garbage. `go vet` knows better:

```bash
go vet ./...
```

```text
vetbug.go:7:21: fmt.Printf format %d has arg name of wrong type string
```

Run `go vet ./...` before you commit. It is fast, it has almost no false
positives, and it is already installed.

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

Two more worth knowing when you meet them: `go get` adds a dependency (course
13, when we add pgx), and `go doc <pkg>` prints documentation in your terminal
without opening a browser — try `go doc fmt.Printf`.

## Exercise

Extend `Greet` so that an empty name produces `"Hello, stranger!"` rather than
`"Hello, !"`. Add a second test case for it.

Then, deliberately, write the test **first** and watch it fail before you make
it pass. Every course from here ends with tests, and getting used to reading a
red failure now will save you time later.

<details>
<summary>One way to do it</summary>

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

Course 09 shows how to collapse these two near-identical tests into one
table-driven test, which is the idiom you will see in real Go code.

</details>

## Next

You have a module, a binary, a passing test, and a formatter that will never
ask your opinion. Next we look at Go's type system — starting with the fact
that Go has no `null`, and what it does instead.
