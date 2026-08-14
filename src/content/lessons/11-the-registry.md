---
title: "The registry"
part: orm
order: 11
summary: "Cache table metadata once, read it from many goroutines, and never parse the same struct twice."
topics:
  - sync.RWMutex
  - package design
  - lazy initialisation
minutes: 40
draft: true
---

Reflection is expensive, so you do it once per type and keep the result. This is a small package with a big constraint: it has to be safe to read concurrently.

> This course has not been written yet. The outline above is the contract:
> when it ships, it ends with working, tested code.
