---
title: "Values and types"
part: foundations
order: 2
summary: "Zero values, the difference between a string, a rune and a byte, and why slices are not arrays."
topics:
  - zero values
  - slices vs arrays
  - maps
  - strings, runes, bytes
minutes: 35
draft: false
---

Go has no `null`, no `undefined`, and no constructors. A variable that has been
declared always holds a usable value, whether or not you gave it one. That single
decision shapes a lot of what follows — including, eventually, how the ORM
decides which columns to leave out of an `INSERT`.

Work in the `greet` module from course 01, or start a fresh one. Everything here
runs with `go run .`.

## Every type has a zero value

Declare a variable without assigning it and Go fills it in:

```go
package main

import "fmt"

type User struct {
	Name  string
	Age   int
	Admin bool
	Tags  []string
}

func main() {
	var (
		i  int
		f  float64
		b  bool
		s  string
		p  *User
		sl []string
		m  map[string]int
	)
	fmt.Printf("int      %v\n", i)
	fmt.Printf("float64  %v\n", f)
	fmt.Printf("bool     %v\n", b)
	fmt.Printf("string   %q\n", s)
	fmt.Printf("*User    %v\n", p)
	fmt.Printf("[]string %v (nil? %t)\n", sl, sl == nil)
	fmt.Printf("map      %v (nil? %t)\n", m, m == nil)

	var u User
	fmt.Printf("\nstruct   %+v\n", u)
}
```

```text
int      0
float64  0
bool     false
string   ""
*User    <nil>
[]string [] (nil? true)
map      map[] (nil? true)

struct   {Name: Age:0 Admin:false Tags:[]}
```

Numbers are `0`, booleans are `false`, strings are `""`, and anything
pointer-shaped — pointers, slices, maps, channels, functions, interfaces — is
`nil`. A struct's zero value is a struct whose every field is *its* zero value,
all the way down. No constructor ran.

This is why you see `var buf bytes.Buffer` in real Go and never
`bytes.NewBuffer()`. A useful zero value is something library authors design for
deliberately, and you should too.

Note the two `%v` outputs that look like something but are not: an empty slice
prints as `[]` and an empty map as `map[]`, yet both are `nil`. Printing is not
a reliable way to tell.

## Strings are bytes, not characters

A Go string is an immutable sequence of **bytes**, conventionally UTF-8. It is
not a sequence of characters, and forgetting that is one of the most common
sources of wrong code:

```go
package main

import (
	"fmt"
	"unicode/utf8"
)

func main() {
	s := "héllo"
	fmt.Printf("len(%q)                = %d\n", s, len(s))
	fmt.Printf("utf8.RuneCountInString = %d\n", utf8.RuneCountInString(s))
	fmt.Printf("s[1]                   = %v (a byte)\n", s[1])

	for i, r := range s {
		fmt.Printf("  i=%d  r=%q  (%d bytes)\n", i, r, utf8.RuneLen(r))
	}
}
```

```text
len("héllo")                = 6
utf8.RuneCountInString = 5
s[1]                   = 195 (a byte)
  i=0  r='h'  (1 bytes)
  i=1  r='é'  (2 bytes)
  i=3  r='l'  (1 bytes)
  i=4  r='l'  (1 bytes)
  i=5  r='o'  (1 bytes)
```

Five characters, six bytes. `é` takes two.

Three things worth pinning down:

- `len(s)` counts **bytes**. For characters, use `utf8.RuneCountInString`.
- `s[1]` gives you a **byte** (`195`), not a character. Indexing into a string
  mid-character produces nonsense.
- `for i, r := range s` gives you **runes** — but `i` is still a *byte* offset,
  which is why it jumps from 1 to 3.

A **rune** is Go's name for a Unicode code point. It is an alias for `int32`,
which is why `%q` prints `'é'` rather than a number.

When you genuinely need to index by character, convert once:

```go
r := []rune(s)   // len 5
b := []byte(s)   // len 6
```

That conversion allocates, so do it once rather than in a loop.

## Arrays are values. Slices are not.

An array has a fixed length that is part of its type: `[3]int` and `[4]int` are
different types. Arrays are **values** — assigning one copies it:

```go
a := [3]int{1, 2, 3}
b := a
b[0] = 99
fmt.Printf("array  a=%v  b=%v\n", a, b)
```

```text
array  a=[1 2 3]  b=[99 2 3]
```

A slice is a small header — a pointer to a backing array, a length, and a
capacity. Copying a slice copies the *header*, so both copies point at the same
storage:

```go
x := []int{1, 2, 3}
y := x
y[0] = 99
fmt.Printf("slice  x=%v  y=%v\n", x, y)
```

```text
slice  x=[99 2 3]  y=[99 2 3]
```

You will use slices for almost everything. Arrays show up mostly as the backing
store behind a slice, or for fixed-size things like a `[16]byte` UUID — which
you will meet again in course 13.

### append, and the trap underneath it

`append` adds to a slice, growing the backing array when it runs out of room:

```go
var s []int
for i := 0; i < 9; i++ {
	s = append(s, i)
}
```

```text
len=1 cap=4
len=5 cap=8
len=9 cap=16
```

Capacity roughly doubles. The exact numbers are an implementation detail that
has changed between Go releases — never write code that depends on them.

Note that `append` **returns** a slice. It has to: if it reallocates, the new
header points somewhere else entirely. Always write `s = append(s, v)`.

Now the trap. When there *is* spare capacity, `append` writes into the existing
backing array:

```go
base := make([]int, 3, 8)
base[0], base[1], base[2] = 1, 2, 3

first := append(base, 100)
second := append(base, 200)

fmt.Printf("  base   = %v\n", base)
fmt.Printf("  first  = %v\n", first)
fmt.Printf("  second = %v\n", second)
```

```text
  base   = [1 2 3]
  first  = [1 2 3 200]
  second = [1 2 3 200]
```

`first` was silently overwritten. Both appends had room in `base`'s backing
array, so both wrote to index 3, and `second` won.

This is not a Go wart so much as the cost of slices being cheap. The fix, when
you need an independent copy, is to make one:

```go
independent := make([]int, len(base))
copy(independent, base)
```

If this feels like a footgun: it is, and it is the single most common source of
surprising bugs in Go code. You will see the ORM take exactly this precaution
when it builds column lists in course 12.

## Maps

A map is an unordered collection of key–value pairs:

```go
ages := map[string]int{"ada": 36}
```

Reading a key that is not present returns the value type's **zero value**, not
an error and not a panic:

```go
fmt.Printf("ages[\"nobody\"] = %d\n", ages["nobody"])
```

```text
ages["nobody"] = 0
```

Which means `ages["nobody"] == 0` cannot tell you whether the key was missing or
genuinely stored as zero. For that, use the two-value form, universally called
**comma-ok**:

```go
if v, ok := ages["ada"]; ok {
	fmt.Printf("ada -> %d\n", v)
}

v, ok := ages["nobody"]
fmt.Printf("nobody -> %d (ok=%t)\n", v, ok)
```

```text
ada -> 36
nobody -> 0 (ok=false)
```

The zero value of a map is `nil`, and a nil map is **readable**:

```go
var nilMap map[string]int
fmt.Println(nilMap["x"], len(nilMap))
```

```text
0 0
```

But writing to one panics:

```go
var m map[string]int
m["boom"] = 1
```

```text
panic: assignment to entry in nil map
```

So a nil map is a fine empty map to read from, and useless to write to. Create
one with `make(map[string]int)` or a literal before you assign.

Map iteration order is **deliberately randomised** — Go shuffles it so you cannot
accidentally depend on an order that was never guaranteed. If you need stable
output, collect the keys and sort them.

## Why this matters for the ORM

Zero values are elegant right up to the moment they are ambiguous, and an ORM
lives at exactly that boundary.

Consider a settings row. The user has a `Notify` flag and a `Limit`:

```go
type Settings struct {
	Notify bool // false: off, or never set?
	Limit  *int // nil: never set. non-nil: set, even to 0.
}
```

```text
Notify = false  -- cannot tell 'off' from 'unset'
Limit  = <nil>  -- nil means unset
Limit  = 0 (set explicitly to zero, and we can tell)
```

When you hand a struct to an ORM and say "save this", it has to decide what
`Notify: false` means. Did you turn notifications off, or did you simply not
set that field, in which case the column's database default should win?

Go gives you no way to tell from the value alone. The way out is the pointer:
`*int` has an extra state — `nil` — that `int` does not, so "unset" and
"explicitly zero" become distinguishable.

The ORM you build takes exactly this position: a zero-valued field on a column
with a database default is **omitted** from the `INSERT`, so the default
applies. If you want to store an explicit zero, you make the field a pointer.
That rule will feel arbitrary when you meet it in course 12. It is not — it
falls directly out of the fact that `int` has no spare state to encode "absent".

## Exercise

In your module, write a function with this signature:

```go
func Initials(name string) string
```

It should return the uppercase first letter of each space-separated word:
`"ada lovelace"` becomes `"AL"`.

Then make it survive input that is not plain ASCII. Test it with `"émile zola"`
and confirm you get `"ÉZ"` rather than a mangled byte.

```bash
cd greet
go test ./...
```

<details>
<summary>One way to do it</summary>

```go
package main

import (
	"strings"
	"unicode"
)

func Initials(name string) string {
	var out []rune
	for _, word := range strings.Fields(name) {
		r := []rune(word)
		if len(r) > 0 {
			out = append(out, unicode.ToUpper(r[0]))
		}
	}
	return string(out)
}
```

The important line is `[]rune(word)`. Writing `word[0]` would give you the first
*byte*, which for `"émile"` is half of `é` — and `unicode.ToUpper` on half a
character produces garbage.

`strings.Fields` splits on any run of whitespace and discards empties, which is
almost always what you want over `strings.Split(name, " ")`.

</details>

## Next

You can now reason about what a Go value *is*. Next we give values behaviour:
structs, methods, and the receiver decision that trips up everyone at least once.
