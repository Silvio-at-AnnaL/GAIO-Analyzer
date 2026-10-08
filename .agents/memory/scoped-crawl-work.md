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

## Competitor page-phase reservation

Keep the existing page-phase reservation when adding hreflang switching; do not replace it with a hard overall deadline.

**Why:** The user explicitly chose to retain the reservation after being told that it can extend total runtime beyond the overall deadline.

**How to apply:** Preserve the existing budget calculation and original timer origins; a language-variant switch must not restart the crawl or allocate a second reservation.

## Reproducible manual comparisons

Manual selection means exactly the selected pages by default. Filling remaining slots must be an explicit opt-in and must never restore deselected pages.

**Why:** The user uses manual selections for reproducible comparison runs.

**How to apply:** Preserve exact-selection defaults when extending crawling, selection controls or report imports.
