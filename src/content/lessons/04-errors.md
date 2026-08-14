---
title: "Errors are values"
part: foundations
order: 4
summary: "Multiple returns, wrapping with %w, defer, and when panic is genuinely correct."
topics:
  - error interface
  - errors.Is / errors.As
  - defer
  - panic and recover
minutes: 35
draft: true
---

Go makes you handle errors in the open. That is more typing and far less guessing. The ORM returns a custom error type, and this is where you learn how to build one that callers can actually inspect.

> This course has not been written yet. The outline above is the contract:
> when it ships, it ends with working, tested code.
