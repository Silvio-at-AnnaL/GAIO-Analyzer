import asyncio
import json
from typing import List, Dict, Any
from anthropic import Anthropic
import httpx
from bs4 import BeautifulSoup

from .crawler import fetch_page, CrawlResult
from .technical_seo import analyze_technical_seo
from .schema_analysis import analyze_schema
from .heading_analysis import analyze_headings
from .llm_analysis import extract_text_content
import asyncio


async def analyze_single_competitor(url: str, client: Anthropic) -> Dict[str, Any]:
    """Lightweight single-page competitor analysis."""
    headers = {"User-Agent": "GAIOAnalyzer/1.0"}
    try:
        async with httpx.AsyncClient(headers=headers, follow_redirects=True) as http_client:
            result = await fetch_page(http_client, url)
    except Exception as e:
        return {"url": url, "error": str(e), "score": 0}

    if not result or not result.html:
        return {"url": url, "error": "Seite nicht erreichbar", "score": 0}

    results = [result]
    tech = analyze_technical_seo(results, url)
    schema = analyze_schema(results)
    headings = analyze_headings(results)

    # Content score (simplified, no LLM for speed)
    text = extract_text_content(result.html, 2000)
    content_score = min(100, max(10, len(text) // 20))

    faq_score = 40 if schema.get("has_faq_schema") else 0

    composite = round(
        tech["score"] * 0.25 +
        schema["score"] * 0.25 +
        headings["score"] * 0.15 +
        content_score * 0.25 +
        faq_score * 0.10
    )

    return {
        "url": url,
        "pages_analyzed": 1,
        "scores": {
            "technical_seo": tech["score"],
            "schema": schema["score"],
            "headings": headings["score"],
            "content": content_score,
            "faq": faq_score,
        },
        "composite": composite,
        "is_https": tech["is_https"],
        "avg_response_ms": tech["avg_response_ms"],
        "has_product_schema": schema["has_product_schema"],
        "has_org_schema": schema["has_org_schema"],
        "has_faq_schema": schema["has_faq_schema"],
        "schema_types": list(schema["types_found"].keys()),
    }


async def generate_competitor_insights(main_domain: str, main_scores: Dict,
                                        competitor: Dict, client: Anthropic) -> Dict:
    """Generate comparative insights using LLM."""
    prompt = f"""Compare these two B2B websites and provide insights in German.

Main site ({main_domain}):
- Technical SEO: {main_scores.get('technical_seo', 0)}
- Schema: {main_scores.get('schema', 0)}
- Content: {main_scores.get('content', 0)}
- FAQ: {main_scores.get('faq', 0)}
- Headings: {main_scores.get('headings', 0)}

Competitor ({competitor['url']}):
- Technical SEO: {competitor['scores'].get('technical_seo', 0)}
- Schema: {competitor['scores'].get('schema', 0)}
- Content: {competitor['scores'].get('content', 0)}
- FAQ: {competitor['scores'].get('faq', 0)}
- Headings: {competitor['scores'].get('headings', 0)}

Return ONLY valid JSON:
{{
  "competitor_advantages": "<what competitor does better (German, 1-2 sentences)>",
  "main_advantages": "<where main site leads (German, 1-2 sentences)>",
  "recommendation": "<one concrete action for main site (German, 1 sentence)>"
}}"""

    try:
        resp = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=400,
            messages=[{"role": "user", "content": prompt}]
        )
        raw = resp.content[0].text.strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        return json.loads(raw.strip())
    except Exception:
        return {
            "competitor_advantages": "Keine automatische Auswertung verfügbar.",
            "main_advantages": "Keine automatische Auswertung verfügbar.",
            "recommendation": "Manuelle Überprüfung empfohlen.",
        }


async def analyze_competitors(competitor_urls: List[str], main_domain: str,
                               main_scores: Dict, client: Anthropic) -> List[Dict]:
    if not competitor_urls:
        return []

    # Analyse all competitors in parallel (max 6), then generate insights sequentially
    analysis_tasks = [
        analyze_single_competitor(url, client)
        for url in competitor_urls[:6]
    ]
    raw_results = await asyncio.gather(*analysis_tasks, return_exceptions=True)

    results = []
    for comp_data in raw_results:
        if isinstance(comp_data, Exception):
            results.append({"url": "unknown", "error": str(comp_data), "score": 0, "composite": 0})
            continue
        if "error" not in comp_data:
            # Small delay to avoid hammering Anthropic API
            await asyncio.sleep(0.3)
            insights = await generate_competitor_insights(
                main_domain, main_scores, comp_data, client
            )
            comp_data["insights"] = insights
        results.append(comp_data)

    results.sort(key=lambda x: x.get("composite", 0), reverse=True)
    return results
