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

## Timing-sensitive verification

Before treating a small wall-clock budget fixture failure as a crawler regression, compare the committed and modified crawler with that fixture in isolation.

**Why:** Combined runs produced budget failures while isolated checks of both versions passed; a later complete serial suite also passed without changing production budgets.

**How to apply:** Use focused baseline/current comparisons and serial whole-suite verification when timing failures occur. Do not change reservations or timer origins just to accommodate test-process scheduling.

## Exclusion matching policy

The user chose component-based wildcard matching over exact legacy whole-URL regex behavior, explicitly accepting cross-component matches, extension/tracking matches in any component, and ignoring fragments.

**Why:** The user confirmed this choice after concrete legacy-equivalence conflicts were surfaced. These differences are deliberate, not regressions to undo.

**How to apply:** Preserve this policy in future exclusion-rule management work. Surface any new behavior difference outside the explicitly approved equivalence classes rather than silently widening the exceptions.

## Rule-change cache timing

Keep the 60-second rule cache and invalidate only the editing server immediately. Explain that changes affect new analyses on that server immediately, other servers (including Live) within about a minute, and running analyses retain their rules.

**Why:** The user explicitly chose this behavior instead of adding cross-process invalidation when the immediate-Dev-and-Live wording conflicted with independent process caches.

**How to apply:** Keep admin help text and future change-timing promises consistent with this decision; do not introduce cross-process invalidation without a new request.

## Legacy crawl-card translation boundary

The existing hard-coded crawl-card texts in the HTML export are a separate backlog item, outside scoped crawl fixes.

**Why:** The user explicitly separated the legacy copy from the new reliability hints and retry-credit texts.

**How to apply:** Use label keys and the caller's translator for new text in results and exports; leave the legacy crawl-card copy unchanged unless its translation is explicitly requested.

## Retry cost and evaluated-page coverage

Do not optimize retries solely for more attempts at persistently failing subpages; preserve full homepage retries while containing the effect on evaluated-page coverage.

**Why:** The user observed a live comparison in which persistent per-URL server failures consumed the crawl's page time and reduced evaluated pages despite retries working as designed.

**How to apply:** When changing retry policy, compare both elapsed time and evaluated pages, especially under persistent subpage failures. Keep the existing homepage and language-variant recovery paths available.

## Redirect-duplicate allowance overflow

After the redirect-duplicate allowance is exhausted, an unexpected redirect from a previously unseen category consumes the normal attempt budget.

**Why:** The user explicitly chose this edge-case policy to keep total logical page fetches bounded by the normal attempt limit plus the redirect allowance, while continuing other categories.

**How to apply:** Preserve this bound and test the first redirect from a new category after allowance exhaustion. Previously observed redirect categories are skipped once the allowance is exhausted.
