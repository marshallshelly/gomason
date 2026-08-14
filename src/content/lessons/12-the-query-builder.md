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
draft: true
---

The part people think of as "the ORM". Splitting `ToSQL()` from `All(ctx)` is the decision that makes the whole thing testable without a database.

> This course has not been written yet. The outline above is the contract:
> when it ships, it ends with working, tested code.
