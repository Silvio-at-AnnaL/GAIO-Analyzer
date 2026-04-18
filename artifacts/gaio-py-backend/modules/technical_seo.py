import time
from typing import List, Dict, Any
from urllib.parse import urlparse
import httpx
from bs4 import BeautifulSoup
from .crawler import CrawlResult


def analyze_technical_seo(results: List[CrawlResult], base_url: str) -> Dict[str, Any]:
    parsed_base = urlparse(base_url)
    is_https = parsed_base.scheme == "https"

    response_times = [r.response_time_ms for r in results if r.response_time_ms > 0]
    avg_response_ms = round(sum(response_times) / len(response_times), 1) if response_times else 0
    ttfb_rating = "gut" if avg_response_ms < 500 else ("mittel" if avg_response_ms < 1500 else "schlecht")

    # Check robots.txt + sitemap (derive from crawler behavior — approximate)
    robots_present = True  # Crawler already checked; assume checked
    sitemap_present = False  # Will be updated if sitemap URLs were found

    pages_detail = []
    meta_title_lengths = []
    meta_desc_lengths = []
    missing_meta_title = 0
    missing_meta_desc = 0
    total_images = 0
    images_with_alt = 0
    canonical_count = 0
    hreflang_langs = set()
    h1_missing = 0
    h1_multiple = 0
    viewport_missing = 0

    for result in results:
        if not result.html:
            continue
        soup = BeautifulSoup(result.html, "lxml")

        # Meta title
        title_tag = soup.find("title")
        title_text = title_tag.get_text(strip=True) if title_tag else ""
        if title_text:
            meta_title_lengths.append(len(title_text))
        else:
            missing_meta_title += 1

        # Meta description
        meta_desc = soup.find("meta", attrs={"name": "description"})
        desc_text = meta_desc.get("content", "").strip() if meta_desc else ""
        if desc_text:
            meta_desc_lengths.append(len(desc_text))
        else:
            missing_meta_desc += 1

        # Canonical
        canonical = soup.find("link", rel="canonical")
        if canonical:
            canonical_count += 1

        # hreflang
        for hl in soup.find_all("link", rel="alternate"):
            lang = hl.get("hreflang", "")
            if lang:
                hreflang_langs.add(lang)

        # Images
        imgs = soup.find_all("img")
        total_images += len(imgs)
        images_with_alt += sum(1 for img in imgs if img.get("alt", "").strip())

        # Viewport
        viewport = soup.find("meta", attrs={"name": "viewport"})
        if not viewport:
            viewport_missing += 1

        # H1
        h1s = soup.find_all("h1")
        if len(h1s) == 0:
            h1_missing += 1
        elif len(h1s) > 1:
            h1_multiple += 1

        pages_detail.append({
            "url": result.url,
            "status": result.status_code,
            "response_ms": result.response_time_ms,
            "title": title_text[:80] if title_text else "(fehlt)",
            "title_len": len(title_text),
            "desc_len": len(desc_text),
            "h1_count": len(h1s),
            "has_canonical": canonical is not None,
        })

    total_pages = len(results)
    avg_title_len = round(sum(meta_title_lengths) / len(meta_title_lengths), 1) if meta_title_lengths else 0
    avg_desc_len = round(sum(meta_desc_lengths) / len(meta_desc_lengths), 1) if meta_desc_lengths else 0
    alt_coverage = round(images_with_alt / total_images * 100, 1) if total_images > 0 else 100

    # Title length issues
    title_too_short = sum(1 for l in meta_title_lengths if l < 30)
    title_too_long = sum(1 for l in meta_title_lengths if l > 60)
    desc_too_short = sum(1 for l in meta_desc_lengths if l < 70)
    desc_too_long = sum(1 for l in meta_desc_lengths if l > 160)

    # Scoring (0–100)
    score = 100
    if not is_https:
        score -= 25
    if avg_response_ms > 1500:
        score -= 15
    elif avg_response_ms > 800:
        score -= 7
    if missing_meta_title > 0:
        score -= min(20, missing_meta_title * 5)
    if missing_meta_desc > 0:
        score -= min(15, missing_meta_desc * 4)
    if alt_coverage < 50:
        score -= 10
    elif alt_coverage < 80:
        score -= 5
    if h1_missing > 0:
        score -= min(15, h1_missing * 5)
    if canonical_count == 0 and total_pages > 3:
        score -= 10
    if viewport_missing > 0:
        score -= 5
    score = max(0, score)

    return {
        "score": score,
        "is_https": is_https,
        "avg_response_ms": avg_response_ms,
        "ttfb_rating": ttfb_rating,
        "total_pages_crawled": total_pages,
        "missing_meta_title": missing_meta_title,
        "missing_meta_desc": missing_meta_desc,
        "avg_title_len": avg_title_len,
        "avg_desc_len": avg_desc_len,
        "title_too_short": title_too_short,
        "title_too_long": title_too_long,
        "desc_too_short": desc_too_short,
        "desc_too_long": desc_too_long,
        "alt_coverage_pct": alt_coverage,
        "total_images": total_images,
        "canonical_count": canonical_count,
        "hreflang_langs": list(hreflang_langs),
        "h1_missing_pages": h1_missing,
        "h1_multiple_pages": h1_multiple,
        "viewport_missing_pages": viewport_missing,
        "pages_detail": pages_detail,
        "crawled_urls": [r.url for r in results],
    }
