---
name: Staged AI routing migration
description: Why moving one AI flow to the central configured client does not authorize migrating other flows.
---

The migration away from the Replit AI proxy is intentionally staged. A transport-only migration for one flow does not authorize migrating other analyzers or removing the shared integration dependency.

**Why:** The user explicitly scoped the prefill migration separately from competitor and recommendation analysis, reserving those analyzers for later steps.

**How to apply:** Follow the scope of the next requested migration. Preserve prompts, parsing, fail-open behavior, provider/model settings, and source-selection settings unless that request explicitly changes them. Do not infer permission to rewrite stored data or remove dependencies from completing one flow.
