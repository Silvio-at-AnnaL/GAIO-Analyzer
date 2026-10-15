---
name: Workspace dependency relinking
description: Missing existing dependencies after a filtered pnpm package addition.
---

If adding a dependency with a filtered pnpm command leaves another workspace's declared dependency unresolved, run a root `pnpm install --frozen-lockfile` before changing application code or dependency declarations.

**Why:** A filtered test-dependency installation left an existing runtime dependency's symlink dangling even though its manifest and lockfile entries were correct. A root frozen install restored it without code or manifest changes.

**How to apply:** Distinguish a broken workspace installation from a genuinely missing declaration when typechecking fails immediately after a filtered package operation.
