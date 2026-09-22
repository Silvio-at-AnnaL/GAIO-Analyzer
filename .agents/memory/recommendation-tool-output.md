---
name: Recommendation output protocol
description: Why AI recommendations use a delimiter-based plain-text protocol instead of tool use.
---

Tool use was abandoned for AI recommendations: nested arrays became malformed JSON strings, while flat tools consistently returned only one item.

**Why:** The provider did not reliably honor either structured schema, but it reliably returns 5–10 delimiter-formatted plain-text recommendations without escaping problems.

**How to apply:** Keep the delimiter protocol as the primary parser and retain strict/salvage JSON parsing only as fallback.