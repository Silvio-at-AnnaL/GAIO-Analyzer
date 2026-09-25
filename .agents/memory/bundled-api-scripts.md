---
name: Bundled API throwaway scripts
description: Environment requirements for temporary esbuild scripts that import API source.
---

Temporary CommonJS bundles that import API source must wrap top-level awaits in an async function and run with `NODE_ENV=production`.

**Why:** CommonJS output rejects top-level await, and development logging tries to resolve the `pino-pretty` transport from the temporary bundle location before the imported code can run.

**How to apply:** For uncommitted API verification scripts bundled with the API package's existing esbuild binary, use an async `main()` and invoke the generated bundle with `NODE_ENV=production node ...`.

For ESM bundles that replace an imported module through an esbuild plugin, give the plugin-loaded module a `resolveDir`, and bundle local workspace packages rather than using `packages: "external"` for everything.

**Why:** Without `resolveDir`, imports inside the virtual module cannot be resolved; externalizing workspace packages leaves their uncompiled TypeScript extensionless imports for Node to resolve at runtime.

**How to apply:** Externalize only npm packages that need Node's own runtime resolution, while allowing local workspace sources to be bundled into the temporary verification script.

For temporary bundles emitted outside the workspace, externalized dependencies resolve relative to the output directory, not the package being tested. Include the relevant workspace package `node_modules` directories in `NODE_PATH` when executing the bundle. Esbuild plugins require its asynchronous build API.

**Why:** A private-function test bundle succeeded but could not load an externalized transitive package from `/tmp`; a synchronous build also rejected the source-injection plugin.

**How to apply:** When a temporary test needs source injection, use async esbuild and supply runtime dependency search paths rather than changing project dependencies.