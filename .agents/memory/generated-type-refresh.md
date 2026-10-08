---
name: Generated type refresh
description: Distinguishing stale generated declarations from real consumer type errors when a shared-library check is blocked.
---

Code generation updates source, not necessarily the declarations consumed through TypeScript project references. An unrelated shared-library error can prevent declaration emission and make consumers falsely report missing newly generated fields.

**Why:** A known library export collision was explicitly outside the crawl-change scope; the normal library check consequently left its emitted declarations stale.

**How to apply:** When generated fields exist in source but consumer checks cannot see them, check declaration freshness first. If the library blocker is intentionally deferred, refresh declaration emission without changing that source, then run normal consumer type checks. An emission-only or `noCheck` run is not a passing type check; report the original shared-library error separately.
