---
name: Bundled API throwaway scripts
description: Environment requirements for temporary esbuild CommonJS scripts that import API source.
---

Temporary CommonJS bundles that import API source must wrap top-level awaits in an async function and run with `NODE_ENV=production`.

**Why:** CommonJS output rejects top-level await, and development logging tries to resolve the `pino-pretty` transport from the temporary bundle location before the imported code can run.

**How to apply:** For uncommitted API verification scripts bundled with the API package's existing esbuild binary, use an async `main()` and invoke the generated bundle with `NODE_ENV=production node ...`.