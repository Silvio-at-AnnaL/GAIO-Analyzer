---
name: Browser verification fallback
description: Environment-specific fallback when the documented testing subagent cannot start.
---

The documented testing subagent configuration returned `Unknown config kind: testing` in this workspace. Local Playwright was usable with the preinstalled `/repl/tools/bin/chromium`.

**Why:** Explicit browser verification still needed to exercise actual UI requests and downloads; API-only checks would not meet the user's request.

**How to apply:** Try the current testing skill first, since capabilities can change. If the same rejection occurs, install temporary browser automation dependencies under `/tmp`, not in the app packages. Use the existing auth system without changing accounts or exposing session tokens.

For long-running jobs, wait for the completed UI rather than using an async `waitForFunction` predicate. The local browser stack returned a handle containing `false` immediately from that predicate instead of continuing to wait. Await JSON parsing explicitly inside browser evaluations. Keep the browser available for focused recovery so a selector failure does not require repeating paid AI work.

React test doubles for effect dependencies must retain stable function and object identities, or they can produce artificial render loops.
