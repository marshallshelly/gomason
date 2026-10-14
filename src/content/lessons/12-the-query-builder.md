---
title: "The query builder"
part: orm
order: 12
summary: "Write Select[T] with a fluent API, and make it testable by separating SQL from execution."
topics:
  - generics
  - fluent APIs
  - method chaining
  - SQL placeholders
minutes: 60
draft: false
---

This is the part people mean when they say "the ORM". You have metadata keyed by
type (course 11) and a generic entry point (course 06). Now they meet.

The whole course rests on one decision: **building the SQL is a separate step
from running it.** Everything here is a pure function from a query to a string
and a list of arguments, which means every test in this course runs in
microseconds with no database at all.

Two things will go wrong along the way. One is a numbering bug that this ORM
actually shipped. The other let a search box read every row in the table.

## A query that builds itself

In your `greet` module, using course 11's registry:

```go
type SelectQuery[T any] struct {
	table   string
	columns []string
	limit   int
}

func Select[T any](r *Registry) *SelectQuery[T] {
	meta, _ := r.GetOrRegister(*new(T))
	return &SelectQuery[T]{table: meta.Name, columns: meta.Columns}
}

func (q *SelectQuery[T]) Limit(n int) *SelectQuery[T] {
	q.limit = n
	return q
}

func (q *SelectQuery[T]) ToSQL() (string, []any, error) {
	sql := "SELECT " + strings.Join(q.columns, ", ") + " FROM " + q.table
	if q.limit > 0 {
		sql += fmt.Sprintf(" LIMIT %d", q.limit)
	}
	return sql, nil, nil
}
```

```go
sql, _, _ := Select[User](r).Limit(10).ToSQL()
fmt.Println(sql)
```

```text
SELECT id, email FROM user LIMIT 10
```

Three things from earlier courses are load-bearing in those twenty lines.

`Select[T any](r *Registry)` is a **package function**, not a method, because
until Go 1.27 a method could not introduce its own type parameter — course 06.
`Limit` has a **pointer receiver** and returns `q`, so the chain accumulates
state instead of discarding it — course 03. And the column list came from the
registry rather than from reflection at the call site, so this costs a map
lookup — course 11.

`ToSQL` returning `(string, []any, error)` is the decision the whole course rests
on. No `ctx`, no connection, nothing to mock.

## Predict: add a WHERE, then a HAVING

Conditions need bound parameters. Here is a builder that numbers them, used
twice — once for `WHERE`, once for `HAVING`:

```go
func buildConditions(conds []Condition) (string, []any) {
	var parts []string
	var args []any
	for i, c := range conds {
		parts = append(parts, fmt.Sprintf("%s %s $%d", c.Column, c.Op, i+1))
		args = append(args, c.Value)
	}
	return strings.Join(parts, " AND "), args
}
```

Build `WHERE age > 18 ... HAVING COUNT(*) > 1` with it. **Predict the SQL, and
predict whether Postgres accepts it.**

```text
select role, count(*) from emp where age > $1 group by role having count(*) > $1
args: [18, 1]
```

```text
ERROR: expected 1 arguments, got 2
```

Both clauses restarted at `$1`. The query now references **one** placeholder
while you supply **two** arguments, and pgx rejects it before it ever reaches
the server.

Notice how this fails. Not a syntax error, not wrong rows — an arity complaint
that says nothing about `HAVING`. And it only appears when a query has *two*
arg-bearing clauses, so every test with a lone `WHERE` passes. That is precisely
why it shipped: it was fixed in v1.17.4, after surviving several releases.

## Thread the number through

The fix is that the parameter number is not local to a clause. It is state that
flows through the whole statement:

```go
paramNum := 1

whereSQL, whereArgs := buildConditionsFrom(conds, paramNum)
paramNum += len(whereArgs)

havingSQL, havingArgs := buildConditionsFrom(having, paramNum)
paramNum += len(havingArgs)
```

```text
select role, count(*) from emp where age > $1 group by role having count(*) > $2
args: [18, 1]   -> 1 rows
```

Two rules fall out of this, and both are easy to get wrong:

**Advance by the number of arguments, not the number of conditions.** They are
usually the same and sometimes not. `IN ($1, $2, $3)` is one condition and three
arguments. `IS NULL` is one condition and *zero*. An empty `IN` renders as
`FALSE` and binds nothing at all. Count args.

**Order of clauses is order of parameters.** The number must flow in the order
the placeholders appear in the final string — JOIN, then WHERE, then HAVING. Get
the order wrong and the SQL is valid, the arity is right, and the values are
bound to the wrong columns. That is the worst failure mode in this course,
because nothing errors.

### Your turn: the fragment you did not number

Some clauses arrive as raw SQL that already contains placeholders — a join
condition, or a subquery handed in by the caller:

```go
qb.InnerJoin("orders", "orders.user_id = users.id AND orders.total > $1", 100)
```

That `$1` was written relative to the fragment, not to the finished statement.
If the fragment lands after two WHERE parameters, it needs to be `$3`.

Write a `shiftPlaceholders(sql string, offset int) string` that renumbers every
`$n` in a string by an offset, then prove it with a test: a fragment containing
`$1` and `$2`, shifted by 2, must become `$3` and `$4`.

The trap is in the obvious implementation. Try the loop version — walk `i` from
1 upward calling `strings.ReplaceAll(sql, "$"+i, "$"+(i+offset))` — and shift
`a > $1 AND b < $2` by 2. Predict the answer before you run it; it is not
`$3` and `$4`.

<details>
<summary>How the ORM does it</summary>

```go
var placeholderRe = regexp.MustCompile(`\$(\d+)`)

func shiftPlaceholders(sql string, offset int) string {
	if offset == 0 {
		return sql
	}
	return placeholderRe.ReplaceAllStringFunc(sql, func(m string) string {
		n, _ := strconv.Atoi(m[1:])
		return "$" + strconv.Itoa(n+offset)
	})
}
```

One pass, every match rewritten from the original string, so nothing a
replacement produces can be matched again. Here is what the loop version does
instead:

```text
a > $1 AND b < $2   regex+2 = a > $3 AND b < $4    loop+2 = a > $13 AND b < $12
a = $1 OR z = $11   regex+2 = a = $3 OR z = $13    loop+2 = a = $13 OR z = $131
```

It corrupts in two separate ways. It **re-matches its own output** — the pass for
`i=1` writes `$3`, and the pass for `i=3` then rewrites that to `$5`, and so on
up the loop. And `$1` is a **prefix of `$11`**, so a multi-digit placeholder gets
mangled from the inside.

`\$(\d+)` avoids both. It is greedy on the digits, so `$11` is one match rather
than `$1` followed by a `1`, and `ReplaceAllStringFunc` reads only from the
original string.

The `offset == 0` early return is not an optimisation worth much on its own —
it is there because the common case is a fragment at position zero, and skipping
the regex entirely keeps `ToSQL` allocation-free for simple queries.

</details>

## The bug that read every row

Some conditions need the value inside a function call rather than next to an
operator. Full-text search is the usual one:

```sql
to_tsvector(body) @@ to_tsquery(<the search terms>)
```

The tempting implementation builds the literal:

```go
fmt.Sprintf("to_tsvector(%s) @@ to_tsquery('%s')", column, query)
```

That is what this ORM did in v1.17.0. **Type it, feed it a search box, and
predict the result:**

```go
userInput := "go') OR true --"
```

```text
select count(*) from doc where to_tsvector(body) @@ to_tsquery('go') OR true --')
  -> returned 2 of 2 rows  (2 means the filter was bypassed)
```

The quote closed the literal, `OR true` replaced the filter, and `--` commented
out the wreckage. Every row in the table, through a search box. It was reachable
from the helper's most natural use and it shipped.

Now bind it instead:

```go
fmt.Sprintf("to_tsvector(%s) @@ to_tsquery($%d)", column, paramNum)
```

```text
parameterized -> ERROR: syntax error in tsquery: "go') OR true --"
```

The entire string arrives as **one value**, Postgres tries to parse it as a
tsquery, and rejects it. There is no quote to escape because there is no literal
— which is the whole point of a bound parameter.

The ORM's fix generalises this. A condition can carry a `ValueSQL` template that
wraps the placeholder:

```go
Condition{Column: "body", Operator: "@@", Value: userInput, ValueSQL: "to_tsquery(%s)"}
```

so the operand stays parameterised while still sitting inside a function call.
The rule to take away: **a value never becomes text in your SQL string.** If you
find yourself reaching for `%s` with user data, the answer is a placeholder and
a template, not better escaping.

## Reserved words

One more thing the string has to survive. **Predict which of these Postgres
accepts:**

```sql
create temp table user(id int)
create temp table "user"(id int)
```

```text
create temp table user(id int)    ERROR: syntax error at or near "user"
create temp table "user"(id int)  -> ok
```

`user` is reserved. So are `order`, `group`, `desc` and about ninety others — all
perfectly reasonable names for a table or a column.

The fix is to quote reserved identifiers at every point where SQL is emitted. Not
*all* identifiers: quoting is case-sensitive, so blanket-quoting changes how
mixed-case names resolve and breaks existing schemas. The ORM keeps a reserved
list and quotes only those.

## What you just built

The real builder, with the numbering threaded exactly as above:

```go
paramNum := 1

sql.WriteString(shiftPlaceholders(join.Condition, paramNum-1))
paramNum++

wb := NewWhereBuilderWithStart(paramNum)
// ...
paramNum += len(whereArgs)

hb := NewWhereBuilderWithStart(paramNum)
// ...
paramNum += len(havingArgs)
```

That is `buildSelectSQL`, and it is shared by **all eight builders** — the four
pool ones and the four `Tx` ones, behind a three-method `queryExecutor`
interface that course 05's lesson on small interfaces would recognise.

They were separate once, each carrying its own copy of the `ToSQL` body, and
they drifted: the transaction path silently lost `LATERAL` join support for
several releases because the fix landed in one copy and not the other. Two
implementations of one grammar is the same trap as course 10's two tag readers,
and it has the same answer.

## Build something

Extend your builder until this produces correct SQL and correct arguments:

```go
sql, args, err := Select[User](r).
	Where(Gt("age", 18)).
	And(Like("email", "%@example.com")).
	OrderByDesc("created_at").
	Limit(10).
	ToSQL()
```

Then make these table cases pass — they are the ones that catch the bugs in this
course:

| case | what it catches |
|---|---|
| `Where` + `Having`, both with args | restarted numbering |
| a condition with `IN` of three values | advancing by conditions, not args |
| a condition with `IS NULL` | advancing when a condition binds nothing |
| a join fragment containing `$1` | unshifted raw fragments |
| a column named `order` | unquoted reserved words |

Every one of these is a `ToSQL()` test. No database, no container, no `ctx`.

<details>
<summary>Check yourself</summary>

The shape that matters is the signature, not the string building:

```go
func (q *SelectQuery[T]) ToSQL() (string, []any, error) {
```

**Return the error.** It is tempting to panic on an unknown operator, because a
bad operator is a programmer mistake and the call site has no `err` to check.
Resist it: this is a library, and course 04's rule applies — a library that
panics takes down its caller's process.

**Assert on args as well as SQL.** A test that only compares the SQL string
passes while the values are bound to the wrong columns, which is the one failure
mode in this course that produces no error at all. Compare both, every time.

**Keep `ToSQL` free of `ctx`.** The moment it takes a context it is pretending to
do I/O, and the next person will put a query in it. Course 13 adds execution as a
separate method that calls this one.

A worked numbering case, so you can check yours:

```go
Select[User](r).
    InnerJoin("orders", "orders.user_id = users.id AND orders.total > $1", 100).
    Where(Gt("age", 18)).
    Having(Gt("COUNT(*)", 5))
```

```text
... JOIN orders ON orders.user_id = users.id AND orders.total > $1
    WHERE age > $2
    HAVING COUNT(*) > $3
args: [100, 18, 5]
```

The join fragment keeps `$1` because it is first and the offset is zero. Shift
the chain by adding a second join and its `$1` becomes `$2`.

</details>

## Next

A string and a list of arguments, with no idea how to reach a database. Course 13
connects it to PostgreSQL through pgx: the pool, scanning rows back into `[]T`,
and why this ORM skips `database/sql` entirely.
