---
name: Recommendation tool output
description: Provider-specific behavior when requesting structured AI recommendations through forced tool use.
---

The Anthropic integration can return a `tool_use` block while encoding the schema's `recommendations` array as a JSON string. That string may itself be malformed by unescaped quotes, so direct JSON parsing is not always sufficient.

**Why:** Repeated calls produced a mix of proper arrays, recoverable malformed strings, and strings too malformed for the existing object-by-object salvage parser. Forced tool selection alone therefore does not guarantee schema-conformant nested values.

**How to apply:** Preserve support for proper arrays, JSON-encoded strings, and the existing salvage parser, followed by strict field and tier validation. Keep source-specific item-count and head/tail diagnostics so unusable provider output remains visible.