---
title: "Migrations: introspect, diff, plan"
part: orm
order: 15
summary: "Read the live schema, diff it against your structs, and emit ordered SQL both ways."
topics:
  - information_schema
  - diffing
  - topological sort
  - idempotency
minutes: 85
draft: false
---

The last course, and the one where the real bugs live.

Everything so far had a right answer you could check by reading. This does not.
A migration generator is judged by one property, and you cannot verify it by
inspection:

> **Generate, apply, then generate again. The second run must produce nothing.**

That sentence is the whole course. Every bug below is a way of failing it.

## The pipeline

Five stages, and the shape matters more than the code:

```
introspect  →  diff  →  plan  →  generate  →  execute
```

**Introspect** reads the live database into the same `TableMetadata` your structs
produce (course 10). **Diff** compares the two and produces a set of changes.
**Plan** turns those changes into ordered SQL. **Generate** writes the `.up.sql`
and `.down.sql`. **Execute** applies them under a lock.

The important design decision is the first one: introspection produces **the same
type** as the parser. Two sources, one representation, so the diff is a pure
function over two values of one type — testable with no database at all, the way
course 12's `ToSQL` was.

## Predict: generate twice

Set up a table the way any real schema does — a partial index, a functional
index, a CHECK:

```sql
CREATE TABLE users (id int primary key, email varchar(320), status text, read boolean default false);
CREATE INDEX idx_lower_email ON users (lower(email));
CREATE INDEX idx_unread ON users (read) WHERE read = false;
ALTER TABLE users ADD CONSTRAINT users_status_check CHECK (status IN ('free','premium'));
```

Apply that, then ask the database what it stored. **Predict whether you get back
what you wrote.**

```text
CREATE INDEX idx_lower_email ON public.users USING btree (lower((email)::text))
CREATE INDEX idx_unread      ON public.users USING btree (read) WHERE (read = false)
CHECK ((status = ANY (ARRAY['free'::text, 'premium'::text])))
```

Not one of the three survived intact.

- `lower(email)` became `lower((email)::text)` — a cast appeared, because `email`
  is a `varchar` and `lower` takes `text`. Declare it `text` instead and the cast
  does not appear, which makes this delightful to debug.
- `WHERE read = false` became `WHERE (read = false)` — parentheses.
- `CHECK (status IN (...))` became `CHECK ((status = ANY (ARRAY['free'::text, 'premium'::text])))`
  — Postgres **rewrote `IN` into `= ANY(ARRAY[...])`**, added casts, and wrapped
  it twice.

PostgreSQL does not store your SQL. It parses it into a tree, throws your text
away, and reconstructs text from the tree when you ask. What comes back is
semantically identical and textually unrecognisable.

So a differ that compares strings reports a change on every run. It drops and
recreates every functional index, every partial index, every CHECK, forever. The
second `generate` is never empty.

## Canonicalize, do not compare

You cannot make Postgres give your text back, so you normalise both sides into a
form where the comparison is meaningful:

```go
func normalizeIndexSQL(s string) string {
	s = reIndexCast.ReplaceAllString(s, "")          // drop ::text, ::character varying, …
	s = strings.NewReplacer("(", " ", ")", " ").Replace(s)
	return strings.ToLower(strings.Join(strings.Fields(s), " "))
}
```

Strip casts, replace **all** parentheses, collapse whitespace, lowercase.
Applied to both the authored and stored forms, `WHERE read = false` and
`WHERE (read = false)` become the same string.

Replace each paren with a **space**, not with nothing. Delete them and
`lower(email)` collapses to `loweremail`, which happily compares equal to a
different expression that also loses its separator. With a space it becomes
`lower email`, and the whitespace collapse tidies up after you.

Note what that costs. Removing every parenthesis means a predicate whose meaning
depends *only* on grouping compares equal to one that differs — `a AND (b OR c)`
versus `(a AND b) OR c`. That is a real loss of precision, accepted knowingly,
because the alternative is phantom-diffing every functional index in every
schema. **Write that trade-off down where the next person will find it**, because
it looks like a bug until you know why.

The multi-word types are the detail that bites: your cast regex must try
`::character varying` before `::character`, or you strip half a type name and
leave the word `varying` in the string.

## Your turn: the change that never shows up

Normalising makes the second `generate` empty. Now make sure the first one is
not. Take the CHECK from above, apply it, then add a value in the struct tag:

```go
Status string `po:"status,text,check(status IN ('free','premium','trial'))"`
```

**Predict what `generate` emits.**

```text
✓ No schema changes detected. Models are already in sync.
```

Nothing. The CHECK is still called `users_status_check`, and a differ that keys
CHECKs by name finds that name on both sides and stops looking. The new value
never reaches the database, and the first sign is an insert failing in
production.

Notice that every empty-diff test still passes. A differ that never compares a
CHECK's body *cannot* phantom-diff one. The name is how you find the pair; it is
not proof the pair is the same.

So compare the body as well. When it differs, the constraint appears in the diff
as both a drop and an add, exactly like a modified index. And your normaliser now
needs more than parentheses, because of what Postgres stores for a CHECK. Write
these and run them; every right-hand side is real `pg_get_constraintdef` output
from Postgres 18, with the leading `CHECK` removed (`kind` and `e` are `varchar`,
`n` is `integer`):

```text
kind IN ('a','b')     (((kind)::text = ANY ((ARRAY['a'::character varying, 'b'::character varying])::text[])))
kind IN ('only')      (((kind)::text = 'only'::text))
n BETWEEN 1 AND 5     (((n >= 1) AND (n <= 5)))
e LIKE '%@%'          (((e)::text ~~ '%@%'::text))
n != 0                ((n <> 0))
n > -1                ((n > '-1'::integer))
```

A one-element `IN` turns into `=`, not `= ANY`. `LIKE` becomes the operator
`~~`. A negative number gets quoted. **Each of these is a phantom diff against a
live database until your normaliser undoes it.**

One trap applies to all of them: **set the string literals aside before you
lowercase anything.** Lowercase the whole expression and `IN ('Active')` versus
`IN ('active')` compares equal, which is the bug you started with in a smaller
form. Pull every `'...'` out first, normalise what is left, and compare the
literals exactly.

## Your turn: the bug that only appears on a big schema

Here is one that passes every unit test and fails on a real database.

```go
Name: fmt.Sprintf("fk_%s_%s_%s", tableName, columnName, refTable)
```

A perfectly reasonable constraint name. Now apply it to a table called
`client_schedule_blocks` with a column `generation_id` referencing
`client_schedule_generations`, and **count the characters**.

```text
fk_client_schedule_blocks_generation_id_client_schedule_generations   67 bytes
```

Then ask the database what it stored:

```text
fk_client_schedule_blocks_generation_id_client_schedule_generat       63 bytes
```

**PostgreSQL truncates every identifier to 63 bytes** — `NAMEDATALEN - 1` — and
does it silently. The code's name never matches the stored one, so the differ
emits `DROP CONSTRAINT` and `ADD CONSTRAINT` on every single `generate`, forever.

Write a `TruncateIdent` that caps a name the way the server does, then check
yourself against the server rather than against your reasoning:

```sql
ALTER TABLE t ADD CONSTRAINT "<a 71-character name>" CHECK (id > 0);
SELECT conname, octet_length(conname) FROM pg_constraint WHERE conrelid = 't'::regclass;
```

Try it with a multi-byte name — 71 Greek characters, say. A plain 63-byte slice
is wrong, and the server will tell you why.

<details>
<summary>What the server actually does</summary>

```text
71 Greek chars (142 bytes) -> stored as 31 chars (62 bytes)
```

62, not 63. Postgres truncates to at most 63 bytes but **backs off to a
character boundary**, and 32 two-byte characters would be 64. So:

```go
func TruncateIdent(name string) string {
	if len(name) <= 63 {
		return name
	}
	cut := 63
	for cut > 0 && !utf8.RuneStart(name[cut]) {
		cut--
	}
	return name[:cut]
}
```

Verified against the server for 1-, 2-, 3- and 4-byte runes. A 120-byte name of
3-byte runes truncates to 63; one of 4-byte runes truncates to 60.

Truncation can make two long names collide. That is fine, and worth
understanding why: the server would have collided identically, and it says so
clearly — `constraint "..." for relation "..." already exists`. Matching the
server's behaviour exactly means you inherit its error messages instead of
inventing new failure modes.

</details>

### Now fix the other side

Truncating the names you generate fixes the live path. Then someone upgrades,
runs `generate` without a database, and **the same drop/add comes back**.

Offline `generate` reads the old `*.up.sql` files. Those were written before the
fix, so they spell the full 67-byte name. Your models now produce the 63-byte
one. The server holds the 63-byte one too, because it cut the name when that old
migration ran. Two of the three agree, and the differ is looking at the third.

It is worse than noise:

```text
ERROR:  constraint "fk_client_schedule_blocks_generation_id_client_schedule_generat"
        for relation "client_schedule_blocks" already exists
```

The `ADD` uses a name the server already holds, so the generated migration does
not even apply.

A name comparison has two inputs, and you fixed one. **Compare names the way
the server stores them**: put both sides through `TruncateIdent` when you build
the lookup key, and do the same for names in `DROP CONSTRAINT` and `DROP INDEX`.
Fix the comparison, not the inputs, and every input is covered, including one
you have not met yet.

## Order is not a detail

Plan has to emit statements in an order the database will accept. **Predict what
this does:**

```sql
CREATE TABLE posts (id int primary key, author_id int REFERENCES authors(id));
```

with `authors` not yet created.

```text
ERROR:  relation "authors" does not exist
```

So tables must be **topologically sorted** by their foreign keys: a table comes
after everything it references. The rest of the ordering follows the same logic —
extensions first (a type or index may need one), then enums, then domains (whose
base type may be an enum), then tables, then indexes, then constraints.

Topological sort is not sufficient on its own. **Predict what happens with a
circular reference** — `a.b_id` references `b`, and `b.a_id` references `a`:

No ordering exists. The answer is to break the cycle by emitting the FK
separately:

```sql
CREATE TABLE a (id int primary key, b_id int);
CREATE TABLE b (id int primary key, a_id int REFERENCES a(id));
ALTER TABLE a ADD CONSTRAINT a_b_fk FOREIGN KEY (b_id) REFERENCES b(id);
```

Which is why a planner needs `ALTER TABLE ADD CONSTRAINT` even though inline
`REFERENCES` is shorter.

### Drops before adds

One more ordering rule, and this one cost this ORM a release. A **modified**
index appears in the diff as both a drop and an add — same name, different
definition. Emit the add first and the drop deletes the index you just created.

```text
IndexesDropped: [idx_unread]   IndexesAdded: [idx_unread]
```

Drops before adds in the up migration. And in the down migration, the mirror:
drop what you added, then recreate what you dropped. Getting one of the four
orderings wrong produces a migration that applies cleanly and leaves the schema
wrong.

The same rule applies to every object that can be modified in place, not just
indexes. When the differ learned to replace a changed CHECK, the planner was
still emitting constraint adds before drops, and the result was:

```sql
ALTER TABLE users ADD CONSTRAINT users_status_check CHECK (...);   -- already exists
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_status_check;
```

Order was never wrong before, because before that change a constraint could not
appear on both sides. **Adding a new kind of change can break an ordering that
used to be safe.**

## Your turn: one constraint, two doors

A column can be made unique two ways. The tag, which lets Postgres name the
constraint, and a table directive, which names it yourself:

```go
// table_name: invoices
// unique: uq_invoices_seq (seq)
type Invoice struct {
	ID     int    `po:"id,primaryKey,integer"`
	Number string `po:"number,varchar(40),notNull,unique"`
	Seq    *int   `po:"seq,integer"`
}
```

Generate into an empty directory. **Predict where each UNIQUE ends up.**

```sql
CREATE TABLE IF NOT EXISTS invoices (
    id integer NOT NULL PRIMARY KEY,
    number varchar(40) NOT NULL UNIQUE,
    seq integer
);
```

`number` is there, inline. `uq_invoices_seq` is nowhere. Generate again:

```text
~ invoices (modified)
ALTER TABLE invoices ADD CONSTRAINT uq_invoices_seq UNIQUE (seq);
```

So the constraint *can* be emitted: the `ALTER` path writes it correctly. Only
`CREATE TABLE` drops it, and it will be "added" again on every generate, forever.

Here is the line in the `CREATE TABLE` path:

```go
case schema.UniqueConstraint:
	if len(constraint.Columns) > 1 {
		parts = append(parts, fmt.Sprintf("    CONSTRAINT %s UNIQUE (%s)", ...))
	}
```

**Read the condition as an assumption.** A tag-unique column gets `UNIQUE` inline,
so its constraint must not be declared a second time, and the author encoded
that as "skip every one-column UNIQUE". That was true when the tag was the only
way to get one. The directive opened a second door, and the rule was still
checking the *shape* of the constraint instead of *where it came from*.

The fix asks the real question: is this the constraint the column's own `UNIQUE`
already creates? That means one column, the tag's default name
(`invoices_number_key`), and the column flagged unique. Everything else is
declared by name:

```sql
CREATE TABLE IF NOT EXISTS invoices (
    id integer NOT NULL PRIMARY KEY,
    number varchar(40) NOT NULL UNIQUE,
    seq integer,
    CONSTRAINT uq_invoices_seq UNIQUE (seq)
);
```

That forced a second, quieter fix. Replaying `ADD CONSTRAINT uq_x UNIQUE (seq)`
offline used to flag `seq` as unique, so **one boolean meant two things**: "the
tag is on" to the parser, "some one-column UNIQUE exists" to the replay. With the
new rule, a flagged `seq` gets an extra unnamed inline `UNIQUE`, and the name
`uq_x` is lost whenever the table is recreated. Pin the flag to one meaning, the
tag's default-named constraint, and make every reader agree.

**Whenever two code paths emit the same object, test both.** Here the diff path
had been right all along. Only a migration generated from nothing goes through
`CREATE TABLE`, and that is exactly the migration nobody regenerates.

## The test that is the only real test

Unit tests cannot catch most of this course. Every bug above passes a
hand-written expectation, because the expectation was written by the same person
who wrote the bug.

The test that works is the round trip:

1. Generate from your models into an empty directory.
2. Apply it to a real database.
3. **Generate again. Assert the output is empty.**
4. Change one thing. **Assert the generate is not empty**, apply it, then
   generate again and assert empty.

Step 3 needs no expected output. The assertion is just "nothing", which nobody
can accidentally write to match a bug. Step 4's first assertion is its partner:
a differ that never looks passes step 3, and only a real change catches it. Do
step 4 once for every kind of object, including a CHECK, a default and an index
predicate, not just a column.

Run it on a schema big enough to contain the inputs you did not think of. The
four bugs in this course were found that way, on 79 tables with 87 foreign keys,
102 indexes and a domain:

```text
generate offline        79 tables
apply                   ok
regenerate vs live DB    no schema changes detected
regenerate offline       no schema changes detected
```

Two of those four bugs needed a table name long enough to overflow 63 bytes, and
one needed a column called `checked_on` — a name that began with `CHECK` and so
got mistaken for a constraint clause and silently dropped. No hand-written test
fixture was ever going to contain either.

The same schema then passed that round trip and still had two bugs. Both turned
up when its team added one value to a CHECK. The CHECK change was missing,
because that round trip never changed a CHECK. The drop/add pairs were bogus,
because the migrations it replayed were all written by the fixed generator and
none spelled a long name in full. A round trip only tests the history you give
it. **Replay real, old migrations, not just ones your current code wrote.**

It also only tests the shapes your schema contains. The same schema passed
again, and then gained their first one-column `// unique:` directive, and the
next baseline silently left it out. Nothing about the test was wrong; the input
simply had not existed yet. When you add a feature, add one model that uses it
to the round-trip fixture.

There is a second round trip worth asserting, and it is easy to forget: the
**offline** path. `pebble generate` with no `--db` replays your existing
`*.up.sql` files to reconstruct the baseline, which is a second, independent
reader of your schema — a third, counting course 14's AST loader. It drifts from
the live path exactly the way those two drift from each other, and the fix is the
same shape: one round-trip assertion per reader.

## Applying it safely

Two things the executor must get right.

**Hold a lock.** Two deploys running `migrate up` at once will both see the same
pending migration. A session-scoped advisory lock serialises them:

```go
pg_advisory_lock(1234567890)
```

Session-scoped means it must be held on **one connection** for its whole
lifetime. Take it from a pool and the unlock can land on a different connection,
which fails with "lock was not held" while the lock leaks on an idle one. This
ORM shipped that bug; the fix was a dedicated connection.

**Know what cannot be transactional.** Most migrations should run inside a
transaction so a failure rolls back. `CREATE INDEX CONCURRENTLY` cannot — Postgres
rejects it inside a transaction block. So the executor detects those statements
and applies that migration in autocommit, which means **that migration is not
atomic**: a failure halfway leaves earlier statements applied. There is no way
around it, so the right move is to document it rather than pretend.

## Build something

Write the diff, which is the part that needs no database:

```go
func Diff(code, db map[string]*TableMetadata) SchemaDiff
```

`SchemaDiff` carries tables added and dropped, and per table, columns added,
dropped and modified. Pure function, two maps in, one value out.

Then write the tests that matter, which are the ones asserting **nothing**:

| case | assertion |
|---|---|
| identical schemas | `Diff` is empty |
| the same partial index, one side parenthesised | empty |
| the same CHECK, one side rewritten as `= ANY (ARRAY[...])` | empty |
| an FK named in full on one side and truncated to 63 bytes on the other | empty |
| a column genuinely added | exactly one `ColumnsAdded` |
| the same CHECK name with a value added to its `IN` list | one drop and one add |
| a CHECK literal changed from `'Active'` to `'active'` | one drop and one add |

The first four are phantom-diff tests. Write them before the canonicalizer and
watch all four fail. The last three are their partners: write them, comment out
the body comparison, and watch the CHECK ones pass with an empty diff they
should have failed.

Then one test the diff alone cannot cover, because it goes through the planner:
plan a table with a tag-unique column and a one-column `// unique:` directive
from nothing, replay that SQL, and assert the diff against the models is empty.
It fails if `CREATE TABLE` drops either constraint, or declares the tag's twice.

If you have Docker, do the full round trip too. It is twenty lines and it is
worth more than every other test in this course combined.

<details>
<summary>Check yourself</summary>

The shape that matters is that the diff never sees raw text:

```go
func (d *Differ) isSameIndex(code, db IndexMetadata) bool {
	if code.Name != db.Name || !slices.Equal(code.Columns, db.Columns) {
		return false
	}
	return normalizeIndexSQL(code.Expression) == normalizeIndexSQL(db.Expression) &&
		normalizeIndexSQL(code.Where) == normalizeIndexSQL(db.Where)
}
```

**Normalise both sides, always.** It is tempting to normalise only the database
side, since that is the one being rewritten. Do not: the authored side has its
own variation — whitespace, case, parentheses someone typed by hand — and a
one-sided normaliser is a phantom diff waiting for the first person who formats
their tag differently.

**Pair by a stable key, then compare the body.** UNIQUE is keyed by columns,
because its *name* is often generated by the database and keying on it
phantom-diffs. A CHECK is keyed by name, because its columns are not knowable
from the stored text without parsing SQL. Every name goes through
`TruncateIdent` before it becomes a key. But a key only says which two things to
compare. If the key is all you check, editing a CHECK under the same name is
invisible.

**Decide by identity, not by shape.** "One column" is a shape; "the constraint
the tag creates" is an identity. The planner skips a UNIQUE in `CREATE TABLE`
only when it is the second:

```go
func inlineUnique(table *TableMetadata, c ConstraintMetadata) bool {
	if len(c.Columns) != 1 || c.Name != ColumnUniqueName(table.Name, c.Columns[0]) {
		return false
	}
	for _, col := range table.Columns {
		if col.Name == c.Columns[0] {
			return col.Unique
		}
	}
	return false
}
```

**You need both kinds of test.** A test asserting a specific change passes
against a differ that reports everything. A test asserting *nothing* passes
against a differ that never looks. Each catches the failure the other cannot.

</details>

## That is the course

You started at `go mod init` with no Go. You now have a tag parser, a concurrent
metadata cache, a generic query builder that produces parameterised SQL, a pgx
execution layer, a second schema reader built on `go/ast`, and a migration
pipeline that diffs your structs against a live database.

The thing worth keeping is not the ORM. It is the habit the last six courses kept
insisting on: **the interesting bugs are not the ones that crash.** They are the
quiet disagreements — two readers of one grammar, two representations of one
schema, a name the database silently shortened — and you find them by making the
system tell you about itself. Run it twice and assert nothing changed. Benchmark
the thing everyone repeats. Generate the SQL and read it.

The ORM you built this on is open source, and every bug in these courses is real
and in its history. Go find the next one.
