---
name: Express 5 params typing
description: req.params values are typed string | string[] in Express 5; must cast before use.
---

In Express 5, `req.params.foo` has type `string | string[]`, not just `string`.

**Rule:** Always cast: `const foo = req.params.foo as string;` before passing to:
- SQLite `.get()` / `.run()` / `.all()`
- `Map.get()`
- Any function expecting `string`

**Why:** TypeScript strict mode rejects `string | string[]` where `string` is expected. The runtime value is always a string for named route params, but the type definition is broader in Express 5.

**How to apply:** Any new route handler with `:param` segments in admin.ts (or any Express route file) needs this cast.
