---
name: Technical SEO language evidence
description: Why technical scoring must not silently adopt the crawler's stricter language-code validation.
---

For technical SEO's hreflang applicability, preserve the specified same-site language-path-prefix regex evidence. Do not add a known-language-code whitelist without asking the user.

**Why:** The score specification names the existing prefix regex as evidence. Adding stricter known-code validation changed the Farnell comparison from the supplied target of 86 to 91 by dropping hreflang from the evaluated weights. This is a scoring-policy change, not a harmless parser cleanup.

**How to apply:** Keep this score's evidence rule separate from the crawler's stricter page-selection language helpers. Do not change page selection when changing technical scoring.
