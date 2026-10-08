---
name: Scoped crawl work
description: The user's repeated operational boundaries for scoped crawl fixes.
---

For scoped crawl fixes, the user repeatedly specifies:
- Commit on the currently checked-out branch. Do not switch, create, or merge branches.
- Do not run a full analysis.
- Do not publish; report back.

**Why:** The user repeats these boundaries in their crawl-change specifications.

**How to apply:** Check the current branch before editing or committing, verify using local synthetic fixtures and the requested checks, and report the commit without running a full analysis or publishing.
