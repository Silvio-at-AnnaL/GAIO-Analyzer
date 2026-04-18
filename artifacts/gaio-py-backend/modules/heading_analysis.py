from typing import List, Dict, Any
from bs4 import BeautifulSoup
from .crawler import CrawlResult


def analyze_headings(results: List[CrawlResult], brand_terms: List[str] = None) -> Dict[str, Any]:
    brand_terms = [t.lower() for t in (brand_terms or [])]
    pages = []
    h1_missing = 0
    h1_multiple = 0
    hierarchy_errors = 0
    brand_in_h1 = 0
    brand_in_h2 = 0
    total_h1 = 0
    total_h2 = 0
    total_h3 = 0

    for result in results:
        if not result.html:
            continue
        soup = BeautifulSoup(result.html, "lxml")

        h1s = [h.get_text(strip=True) for h in soup.find_all("h1")]
        h2s = [h.get_text(strip=True) for h in soup.find_all("h2")]
        h3s = [h.get_text(strip=True) for h in soup.find_all("h3")]
        total_h1 += len(h1s)
        total_h2 += len(h2s)
        total_h3 += len(h3s)

        page_errors = []
        if len(h1s) == 0:
            h1_missing += 1
            page_errors.append("Kein H1 vorhanden")
        elif len(h1s) > 1:
            h1_multiple += 1
            page_errors.append(f"{len(h1s)}× H1 vorhanden (sollte genau 1 sein)")

        # Check H3 without H2 parent (simplified: if h3s but no h2s)
        if h3s and not h2s:
            hierarchy_errors += 1
            page_errors.append("H3 ohne übergeordnetes H2")

        # Brand term check
        if brand_terms:
            for h1 in h1s:
                if any(t in h1.lower() for t in brand_terms):
                    brand_in_h1 += 1
                    break
            for h2 in h2s:
                if any(t in h2.lower() for t in brand_terms):
                    brand_in_h2 += 1
                    break

        pages.append({
            "url": result.url,
            "h1": h1s,
            "h2": h2s[:8],  # limit to first 8
            "h3": h3s[:6],
            "errors": page_errors,
        })

    total_pages = len(pages)
    score = 100
    if h1_missing > 0:
        score -= min(30, h1_missing * 10)
    if h1_multiple > 0:
        score -= min(15, h1_multiple * 5)
    if hierarchy_errors > 0:
        score -= min(20, hierarchy_errors * 7)
    # Brand in headings bonus (only if brand terms provided)
    if brand_terms and total_pages > 0:
        brand_coverage = (brand_in_h1 + brand_in_h2) / total_pages
        if brand_coverage < 0.3:
            score -= 10
    score = max(0, score)

    return {
        "score": score,
        "total_pages": total_pages,
        "h1_missing_pages": h1_missing,
        "h1_multiple_pages": h1_multiple,
        "hierarchy_errors": hierarchy_errors,
        "total_h1": total_h1,
        "total_h2": total_h2,
        "total_h3": total_h3,
        "pages": pages,
    }
