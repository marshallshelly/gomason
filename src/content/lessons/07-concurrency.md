---
title: "Goroutines and concurrency"
part: tools
order: 7
summary: "Goroutines, channels, select, and the mutex that guards a shared cache."
topics:
  - goroutines
  - channels
  - select
  - sync.RWMutex
  - context
minutes: 50
draft: true
---

Concurrency is Go's headline feature and its sharpest edge. The ORM keeps a metadata cache that many goroutines read at once, so you will meet `sync.RWMutex` for a real reason rather than a toy one.

> This course has not been written yet. The outline above is the contract:
> when it ships, it ends with working, tested code.
