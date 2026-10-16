---
name: Shared preparation accounting
description: Product requirement distinguishing per-analysis attribution from global usage totals.
---

Preparation work can be shared by multiple analyses. Each linked analysis intentionally includes the shared preparation usage in its snapshot; global totals must count that preparation only once.

**Why:** The product owner explicitly requires both per-analysis attribution and non-duplicated total usage. Adding analysis snapshots together would overstate spend.

**How to apply:** Preserve shared preparation attribution when changing analysis history or building the later cost UI. Calculate global usage from individual events, not by summing per-analysis snapshots.
