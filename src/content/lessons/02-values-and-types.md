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
draft: true
---

Go has no `null` and no constructors. Every type has a zero value, and leaning on that is idiomatic rather than lazy — a fact the ORM will depend on later when it decides which columns to leave out of an INSERT.

> This course has not been written yet. The outline above is the contract:
> when it ships, it ends with working, tested code.
