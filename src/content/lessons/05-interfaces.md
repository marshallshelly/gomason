---
title: "Interfaces"
part: tools
order: 5
summary: "Implicit satisfaction, why small interfaces win, and how io.Reader got everywhere."
topics:
  - implicit satisfaction
  - small interfaces
  - io.Reader
  - type assertions
minutes: 40
draft: true
---

Nothing declares `implements` in Go. That single decision changes how you design packages. Later, one small interface is what lets the ORM run the same query against a pool or a transaction without duplicating a line.

> This course has not been written yet. The outline above is the contract:
> when it ships, it ends with working, tested code.
