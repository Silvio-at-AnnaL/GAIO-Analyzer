---
name: Prefill competitor context policy
description: User-confirmed provenance boundary and successful-crawl fallback requirement for competitor sourcing.
---

Keep website-derived summaries separate from company knowledge. General company knowledge may support competitor search and relevance when crawling fails, but must never be presented or stored as website content.

**Why:** The user explicitly reserves `content_summary` for website content; a blocked website provides no basis for such a summary.

**How to apply:** Keep general-knowledge context internal to competitor sourcing. Do not add it to website-summary responses, stored analysis inputs, or website-content UI.

Preserve the existing crawled-text fallback when a successful crawl produces no AI summary.

**Why:** The user corrected the initially incomplete context formula and explicitly required successful crawls to behave exactly as before.

**How to apply:** Prefer non-empty website summary, then the first 1600 characters of crawled content, then company knowledge for failed crawls only. Without context, skip search, keep AI suggestions, and use company name plus personas for relevance.
