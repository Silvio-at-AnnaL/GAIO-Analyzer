---
name: Shared language-path policy
description: The user's explicit correction of the earlier broad language-prefix scoring policy.
---

Crawler and technical SEO must share the requested curated web-language-code recognizer, with optional regions. Ordinary short paths such as sc, mc, nxp, bom, faq and new must not count as language versions.

**Why:** The user explicitly replaced the previous bare-regex policy after identifying false language branches on Farnell, then corrected their expectation of a non-evaluable component: genuine `/en-DE/` language links without hreflang correctly score 0/5. Only ordinary product/category paths alone make the component non-evaluable. Neither a historical score target nor a domain-specific expectation should override the evidence.

**How to apply:** Keep language-path recognition consistent across crawling and technical SEO; do not reintroduce separate broader regexes, force Farnell to be non-evaluable, or preserve historical scores by treating product/category paths as languages.
