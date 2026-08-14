---
title: "The AST loader"
part: orm
order: 14
summary: "Read struct tags out of source files with go/ast \u2014 no compilation required."
topics:
  - go/ast
  - go/parser
  - file walking
minutes: 50
draft: true
---

The trick that lets the CLI read half-finished models that do not compile yet. Two paths now produce the same metadata, so a parity test keeps them honest.

> This course has not been written yet. The outline above is the contract:
> when it ships, it ends with working, tested code.
