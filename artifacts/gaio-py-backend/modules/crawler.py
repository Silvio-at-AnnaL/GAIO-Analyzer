import asyncio
import time
from urllib.parse import urljoin, urlparse
from urllib.robotparser import RobotFileParser
from typing import List, Tuple, Optional
import httpx
from bs4 import BeautifulSoup


class CrawlResult:
    def __init__(self, url: str, html: str, status_code: int, response_time_ms: float):
        self.url = url
        self.html = html
        self.status_code = status_code
        self.response_time_ms = response_time_ms


async def fetch_page(client: httpx.AsyncClient, url: str) -> Optional[CrawlResult]:
    for attempt in range(2):  # one retry
        try:
            start = time.time()
            resp = await client.get(url, timeout=15, follow_redirects=True)
            elapsed = (time.time() - start) * 1000
            ct = resp.headers.get("content-type", "")
            if "text/html" in ct:
                return CrawlResult(str(resp.url), resp.text, resp.status_code, round(elapsed, 1))
            # Non-HTML (PDF, image, etc.) — return status only, no body
            return CrawlResult(str(resp.url), "", resp.status_code, round(elapsed, 1))
        except httpx.TimeoutException:
            if attempt == 0:
                await asyncio.sleep(1)
                continue
            return None
        except Exception:
            return None
    return None


def is_same_domain(base: str, url: str) -> bool:
    base_host = urlparse(base).netloc.replace("www.", "")
    url_host = urlparse(url).netloc.replace("www.", "")
    return base_host == url_host


def extract_internal_links(base_url: str, html: str) -> List[str]:
    soup = BeautifulSoup(html, "lxml")
    links = set()
    for a in soup.find_all("a", href=True):
        href = a["href"].strip()
        if href.startswith(("#", "mailto:", "tel:", "javascript:")):
            continue
        full = urljoin(base_url, href).split("#")[0].split("?")[0]
        if is_same_domain(base_url, full) and full.startswith("http"):
            links.add(full.rstrip("/"))
    return list(links)


async def fetch_sitemap_urls(client: httpx.AsyncClient, base_url: str) -> List[str]:
    parsed = urlparse(base_url)
    sitemap_url = f"{parsed.scheme}://{parsed.netloc}/sitemap.xml"
    try:
        resp = await client.get(sitemap_url, timeout=10, follow_redirects=True)
        if resp.status_code == 200:
            soup = BeautifulSoup(resp.text, "lxml-xml")
            locs = [loc.text.strip() for loc in soup.find_all("loc")]
            # filter to same domain, html-likely URLs
            return [u for u in locs if is_same_domain(base_url, u) and not u.endswith((".xml", ".jpg", ".png", ".pdf"))][:30]
    except Exception:
        pass
    return []


def check_robots(base_url: str, user_agent: str = "*") -> bool:
    """Returns True if crawling is allowed."""
    parsed = urlparse(base_url)
    robots_url = f"{parsed.scheme}://{parsed.netloc}/robots.txt"
    rp = RobotFileParser()
    rp.set_url(robots_url)
    try:
        rp.read()
        return rp.can_fetch(user_agent, base_url)
    except Exception:
        return True


async def crawl(base_url: str, max_pages: int = 15, explicit_urls: Optional[List[str]] = None) -> List[CrawlResult]:
    """
    Crawl a domain and return up to max_pages results.
    If explicit_urls is provided, fetch exactly those URLs (skip auto-discovery).
    """
    headers = {
        "User-Agent": "GAIOAnalyzer/1.0 (website analysis tool; contact: gaio@agency.com)"
    }

    async with httpx.AsyncClient(headers=headers, follow_redirects=True) as client:
        if explicit_urls:
            tasks = [fetch_page(client, u) for u in explicit_urls[:max_pages]]
            results = await asyncio.gather(*tasks)
            return [r for r in results if r is not None]

        # Auto-discover
        homepage = await fetch_page(client, base_url)
        if not homepage or not homepage.html:
            return [homepage] if homepage else []

        results = [homepage]
        visited = {homepage.url, base_url}

        # Try sitemap first
        sitemap_urls = await fetch_sitemap_urls(client, base_url)
        candidate_urls = sitemap_urls if sitemap_urls else extract_internal_links(base_url, homepage.html)

        # Deduplicate and limit
        to_fetch = []
        for u in candidate_urls:
            if u not in visited and len(to_fetch) < max_pages - 1:
                to_fetch.append(u)
                visited.add(u)

        # Fetch in batches of 5
        for i in range(0, len(to_fetch), 5):
            batch = to_fetch[i:i+5]
            tasks = [fetch_page(client, u) for u in batch]
            batch_results = await asyncio.gather(*tasks)
            for r in batch_results:
                if r is not None:
                    results.append(r)

        return results
