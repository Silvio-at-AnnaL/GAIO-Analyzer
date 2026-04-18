import json
from typing import Dict, Any, List
from anthropic import Anthropic

async def generate_executive_summary(all_data: Dict, gaio_score: int,
                                      company: str, client: Anthropic) -> str:
    """4-sentence executive summary for client-facing use."""
    scores = {
        "technical_seo": all_data["technical_seo"]["score"],
        "schema": all_data["schema"]["score"],
        "content": all_data["content"].get("score", 0),
        "faq": all_data["faq"]["faq_count"],
        "llm": all_data["llm"].get("avg_rating", 0),
    }
    strongest = max(scores, key=lambda k: scores[k])
    weakest   = min(scores, key=lambda k: scores[k])

    label_map = {
        "technical_seo": "die technische SEO-Basis",
        "schema": "strukturierte Daten (Schema.org)",
        "content": "die inhaltliche Substanz",
        "faq": "FAQ-Content",
        "llm": "die LLM-Auffindbarkeit",
    }

    prompt = f"""Write a 4-sentence executive summary in German for a B2B website analysis.
Company: {company}
Overall GAIO Score: {gaio_score}/100
Strongest area: {label_map.get(strongest, strongest)} ({scores[strongest]})
Weakest area: {label_map.get(weakest, weakest)} ({scores[weakest]})
Recommendations available: critical={len(all_data.get("recommendations_preview", {}).get("critical",[]))}, high_leverage={len(all_data.get("recommendations_preview", {}).get("high_leverage",[]))}

Rules:
- Sentence 1: Overall assessment (score + what it means in practice)
- Sentence 2: Biggest strength (specific, not generic)
- Sentence 3: Most urgent gap (concrete, actionable)
- Sentence 4: Expected benefit if top recommendations are implemented
- Tone: professional, direct, no marketing language
- Output: ONLY the 4 sentences, no intro, no bullet points"""

    try:
        resp = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=300,
            messages=[{"role": "user", "content": prompt}]
        )
        return resp.content[0].text.strip()
    except Exception:
        return ""


WEIGHTS = {
    "technical_seo": 0.15,
    "schema": 0.20,
    "headings": 0.10,
    "content": 0.20,
    "faq": 0.15,
    "llm_discoverability": 0.20,
}


def compute_gaio_score(scores: Dict[str, int]) -> int:
    total = 0
    for key, weight in WEIGHTS.items():
        total += scores.get(key, 0) * weight
    return round(total)


async def generate_recommendations(all_data: Dict, client: Anthropic) -> Dict[str, List]:
    """Use LLM to generate prioritized recommendations."""
    summary = json.dumps({
        "technical_seo": {
            "score": all_data["technical_seo"]["score"],
            "is_https": all_data["technical_seo"]["is_https"],
            "missing_meta_title": all_data["technical_seo"]["missing_meta_title"],
            "missing_meta_desc": all_data["technical_seo"]["missing_meta_desc"],
            "h1_missing_pages": all_data["technical_seo"]["h1_missing_pages"],
            "alt_coverage_pct": all_data["technical_seo"]["alt_coverage_pct"],
            "canonical_count": all_data["technical_seo"]["canonical_count"],
            "hreflang_langs": all_data["technical_seo"]["hreflang_langs"],
        },
        "schema": {
            "score": all_data["schema"]["score"],
            "has_product_schema": all_data["schema"]["has_product_schema"],
            "has_org_schema": all_data["schema"]["has_org_schema"],
            "has_faq_schema": all_data["schema"]["has_faq_schema"],
            "product_props_missing": all_data["schema"]["product_props_missing"],
            "org_props_missing": all_data["schema"]["org_props_missing"],
            "missing_important_types": all_data["schema"]["missing_important_types"],
        },
        "headings": {
            "score": all_data["headings"]["score"],
            "h1_missing_pages": all_data["headings"]["h1_missing_pages"],
            "hierarchy_errors": all_data["headings"]["hierarchy_errors"],
        },
        "content": {
            "score": all_data["content"]["score"],
            "gaps": all_data["content"].get("content_gaps", {}).get("findings", []),
        },
        "faq": {
            "score": all_data["faq"]["score"],
            "faq_count": all_data["faq"]["faq_count"],
            "has_faq_schema": all_data["faq"]["has_faq_schema"],
        },
        "llm": {
            "score": all_data["llm"]["score"],
            "avg_rating": all_data["llm"]["avg_rating"],
        },
    }, ensure_ascii=False, indent=2)

    prompt = f"""Based on this B2B website analysis data, generate prioritized recommendations in German.

Analysis data:
{summary}

Return ONLY valid JSON with exactly this structure:
{{
  "critical": [
    {{
      "title": "<short German title>",
      "problem": "<what is wrong>",
      "why_matters": "<why this matters for LLM visibility and SEO>",
      "fix": "<concrete fix instruction>"
    }}
  ],
  "high_leverage": [
    {{
      "title": "<short German title>",
      "problem": "<what is wrong>",
      "why_matters": "<why this matters>",
      "fix": "<concrete fix instruction>"
    }}
  ],
  "secondary": [
    {{
      "title": "<short German title>",
      "problem": "<what is wrong>",
      "why_matters": "<why this matters>",
      "fix": "<concrete fix instruction>"
    }}
  ]
}}

Rules:
- critical: only truly broken fundamentals (no HTTPS, missing H1 on most pages, 0 structured data)
- high_leverage: items with biggest potential impact on LLM visibility
- secondary: refinements for later
- Maximum 4 items per tier
- Be specific to the actual data, not generic
- All text in German"""

    try:
        resp = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=2000,
            messages=[{"role": "user", "content": prompt}]
        )
        raw = resp.content[0].text.strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        return json.loads(raw.strip())
    except Exception as e:
        return {
            "critical": [{"title": "Analysefehler", "problem": str(e)[:100],
                          "why_matters": "", "fix": ""}],
            "high_leverage": [],
            "secondary": [],
        }
