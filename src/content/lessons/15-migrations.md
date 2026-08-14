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
minutes: 75
draft: true
---

The hardest and most satisfying course. Diffing is where the real bugs live — Postgres rewrites what you give it, so `lower(email)` comes back as `lower((email)::text)` and a naive comparison drops the index on every run.

> This course has not been written yet. The outline above is the contract:
> when it ships, it ends with working, tested code.
