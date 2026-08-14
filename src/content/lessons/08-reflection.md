---
title: "Reflection and struct tags"
part: tools
order: 8
summary: "Read a type at runtime, pull values out of it, and parse the tags on its fields."
topics:
  - reflect.Type
  - reflect.Value
  - struct tags
  - performance costs
minutes: 45
draft: true
---

Reflection is how an ORM learns the shape of your data. It is also slow and easy to get wrong, so you will cache what you learn — which is exactly what the registry does two courses from now.

> This course has not been written yet. The outline above is the contract:
> when it ships, it ends with working, tested code.
