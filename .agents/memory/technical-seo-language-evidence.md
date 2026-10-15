---
name: Shared language-path policy
description: The user's explicit correction of the earlier broad language-prefix scoring policy.
---

Crawler and technical SEO must share the requested curated web-language-code recognizer, with optional regions. Ordinary short paths such as sc, mc, nxp, bom, faq and new must not count as language versions.

**Why:** The user explicitly replaced the previous bare-regex policy after identifying false language branches on Farnell. Farnell's hreflang component is now expected to be non-evaluable when only these ordinary paths are present. The old score target of 86 is not a reason to restore false-positive detection.

**How to apply:** Keep language-path recognition consistent across crawling and technical SEO; do not reintroduce separate broader regexes or preserve historical scores by treating product/category paths as languages.
