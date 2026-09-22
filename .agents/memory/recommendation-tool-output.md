---
name: Recommendation tool output
description: Provider-specific behavior of nested and flat forced tool calls for AI recommendations.
---

The Anthropic integration can return a nested `recommendations` array as a malformed JSON string. A flat `add_recommendation` tool avoids malformed fields, but repeated verification returned exactly one tool block per response despite an explicit 5–10-call system instruction and parallel tool use remaining enabled.

**Why:** Nested-tool calls produced a mix of proper arrays, recoverable strings, and unrecoverable strings. Five direct flat-tool calls each returned one valid block; a full run and its allowed retry also returned one block each. Forced tool selection does not guarantee multiple parallel calls.

**How to apply:** Keep the flat tool as the primary path and retain nested/text compatibility fallbacks with strict validation and source diagnostics. Do not assume one response can provide 5–10 flat items; any future expansion needs an explicit multi-request collection strategy.