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

Open a terminal. You will be running code every few minutes in this course, and
most of it is designed to surprise you — the point is to guess wrong, then find
out why.

In the `greet` module from course 01, replace `main.go` with this:

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
	var u User
	fmt.Printf("%+v\n", u)
}
```

**Before you run it — what does an unassigned `User` print?** Write down your
guess. Then:

```bash
go run .
```

```text
{Name: Age:0 Admin:false Tags:[]}
```

No `null`, no `undefined`, no crash. Go has no constructors and no uninitialised
memory: **every type has a zero value, and a declared variable always holds it.**
Numbers are `0`, strings are `""`, booleans are `false`, pointers, slices and
maps are `nil`.

That one decision will come back in course 10, when the ORM has to work out which
columns to leave out of an `INSERT`.

## Your turn: make it crash

`Tags` printed as `[]`, which looks like an empty slice. Add these two lines to
`main` and run again:

```go
fmt.Println("nil?", u.Tags == nil, "len:", len(u.Tags))
u.Tags = append(u.Tags, "admin")
fmt.Println(u.Tags)
```

It works — `append` to a nil slice is fine. Now try the same thing with a map:

```go
var m map[string]int
fmt.Println("read:", m["missing"])
m["id"] = 1
```

**Predict: which of those two lines fails?**

```text
read: 0
panic: assignment to entry in nil map
```

Reading a nil map is fine and gives you the zero value. *Writing* to one panics.
This is the single most common Go beginner crash, and the fix is to make the map
before you use it:

```go
m := map[string]int{}
```

The asymmetry is worth holding onto: **a nil slice is usable, a nil map is
read-only.** You will hit this again in course 08 when reflection hands you a
struct whose map field was never initialised.

## Strings are bytes

Replace the body of `main` with:

```go
s := "héllo"
fmt.Println(len(s))
```

**Predict the number.** It is a five-character word.

```text
6
```

`len` on a string counts **bytes, not characters.** The `é` is two bytes in
UTF-8. Go source is UTF-8 and strings are just byte slices with a type on top —
so indexing gives you a byte, not a letter:

```go
fmt.Println(s[1])          // 195 — half of the é
fmt.Println(string(s[1]))  // Ã   — nonsense
```

To walk actual characters, range over the string. Add this and run:

```go
for i, r := range "hé" {
	fmt.Printf("index %d rune %q\n", i, r)
}
```

```text
index 0 rune 'h'
index 1 rune 'é'
```

Ranging yields **runes** — Unicode code points — and the index jumps by however
many bytes each one took. A `rune` is an `int32`; a `byte` is a `uint8`. Both are
aliases, and choosing the wrong one is how you end up truncating someone's name.

**Your turn.** Write a function `CountChars(s string) int` that returns the
number of *characters*, so `CountChars("héllo")` is 5. Two ways to do it —
`utf8.RuneCountInString` from the standard library, or a range loop with a
counter. Try the loop first, then look up the stdlib version and notice you did
not need to write it.

## The trap under append

This is the one that bites everybody. Type it exactly:

```go
all := []string{"id", "email", "age"}
first := all[:2]
first = append(first, "OVERWRITTEN")
fmt.Println("all:  ", all)
fmt.Println("first:", first)
```

**Predict both lines before you run it.** Most people expect `all` to be
untouched.

```text
all:   [id email OVERWRITTEN]
first: [id email OVERWRITTEN]
```

`append` overwrote `all[2]`. A slice is a **view** — a pointer, a length, and a
capacity — over an array it does not own. `all[:2]` has length 2 but capacity 3,
because it still points at the original array with room to spare. `append` saw
spare capacity and wrote in place.

Check it yourself:

```go
fmt.Println(len(first), cap(first))  // 2 3
```

Compare that to an array, which is a *value*:

```go
a := [3]int{1, 2, 3}
b := a
b[0] = 99
fmt.Println(a, b)
```

```text
[1 2 3] [99 2 3]
```

`b := a` copied all three elements. Do the same with a slice and both names see
the change, because you copied the view and not the data.

**Your turn.** Make `first` independent so that appending to it leaves `all`
alone. Two fixes: `slices.Clone`, or the three-index slice `all[:2:2]` which caps
the capacity at 2 and forces `append` to allocate. Try both and print
`cap(first)` for each.

## Maps do not keep order

Build a map and range over it:

```go
m := map[string]int{"id": 1, "email": 2, "age": 3, "city": 4}
for k := range m {
	fmt.Print(k, " ")
}
fmt.Println()
```

Run it about eight times.

```text
id email age city
id email age city
email age city id
id email age city
```

**Mostly stable, occasionally rotated.** Now change it to twelve keys and run it
five times — the order is different every single run.

That gap is the trap. Go deliberately does not guarantee map order, and small
maps happen to *look* consistent, so a test written against a three-key map
passes for months and then fails in CI the day someone adds a fourth field.
**Never depend on it.** When you need order, sort:

```go
for _, k := range slices.Sorted(maps.Keys(m)) {
	fmt.Println(k, m[k])
}
```

The other thing to know about maps is the comma-ok form, which separates
"missing" from "present but zero":

```go
count, ok := m["nope"]   // 0, false
```

You will need that distinction in course 10 — a struct tag that is absent means
something different from one that is empty.

## Build something

Add this to your `greet` module as `columns.go`, and a test alongside it:

```go
func ColumnNames(cols []string) string
```

It takes column names and returns them comma-separated and sorted — `["email",
"id"]` becomes `"email, id"` — with two rules: it must return `""` for an empty
or nil slice, and it must not modify the caller's slice.

That second rule is the whole course in one line. Write the test first, using
what you now know: pass in a slice, call the function, then check the *original*
slice is unchanged. Get it to fail, then make it pass.

<details>
<summary>Check yourself once you have written it</summary>

```go
func ColumnNames(cols []string) string {
	if len(cols) == 0 {
		return ""
	}
	sorted := slices.Clone(cols)
	slices.Sort(sorted)
	return strings.Join(sorted, ", ")
}
```

`len(cols) == 0` covers nil and empty together — no separate nil check needed,
because `len` of a nil slice is 0.

`slices.Clone` is the point. `slices.Sort` sorts **in place**, so without the
clone this function would silently reorder the caller's slice — the append trap
wearing a different hat. A function that quietly mutates its argument is the kind
of bug that takes a day to find.

Your test should prove it:

```go
input := []string{"id", "email"}
ColumnNames(input)
if input[0] != "id" {
	t.Errorf("ColumnNames modified its input: %v", input)
}
```

If you wrote `sort.Strings(cols)` directly, that test is what catches you.

</details>

## Next

Structs and methods — giving these values behaviour, and the pointer-versus-value
receiver decision that trips up everyone coming from another language. You will
meet the same copying rules from this course, one level up.
