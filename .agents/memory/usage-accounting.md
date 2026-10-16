---
name: Shared preparation accounting
description: Product requirement distinguishing per-analysis attribution from global usage totals.
---

Preparation work can be shared by multiple analyses. Each linked analysis intentionally includes the shared preparation usage in its snapshot; global totals must count that preparation only once.

**Why:** The product owner explicitly requires both per-analysis attribution and non-duplicated total usage. Adding analysis snapshots together would overstate spend.

**How to apply:** Preserve shared preparation attribution when changing analysis history or building the later cost UI. Calculate global usage from individual events, not by summing per-analysis snapshots.

## Tavily production baseline

The correct production values are the Free plan with 1,000 included credits per month.

**Why:** The product owner explicitly identified these as the correct production values and authorized leaving them saved during admin-UI verification. Development and production share these settings.

**How to apply:** Leave Free / 1,000 in place after verification; do not leave test tariff changes in the shared settings.
