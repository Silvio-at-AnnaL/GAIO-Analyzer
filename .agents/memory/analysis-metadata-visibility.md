---
name: Analysis metadata visibility
description: Product boundary for exposing AI provider and model metadata.
---

Provider/model may appear in the admin analysis log and invisible report data block. Do not show them in the customer-facing report, live results view, or PDF. Setup import ignores this diagnostic metadata.

**Why:** The user explicitly separated operational metadata from customer report content.

**How to apply:** Preserve this boundary when extending report exports or analysis history; metadata additions do not authorize visible report changes.
