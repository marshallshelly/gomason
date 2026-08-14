---
title: "From struct tags to a schema"
part: orm
order: 10
summary: "Parse `po:\"id,primaryKey\"` into typed metadata, with the tricky nested-parens case handled."
topics:
  - reflection
  - parsing
  - table-driven tests
minutes: 50
draft: true
---

The first real piece of the ORM. A parser that turns a tag string into a column definition — including `default(gen_random_uuid())`, where a naive split on commas gets it wrong.

> This course has not been written yet. The outline above is the contract:
> when it ships, it ends with working, tested code.
