import json
from typing import List, Dict, Any, Optional
from urllib.parse import urlparse
from bs4 import BeautifulSoup
from anthropic import Anthropic
from .crawler import CrawlResult


def extract_text_content(html: str, max_chars: int = 4000) -> str:
    soup = BeautifulSoup(html, "lxml")
    for tag in soup(["script", "style", "nav", "footer", "header"]):
        tag.decompose()
    text = " ".join(soup.get_text(separator=" ", strip=True).split())
    return text[:max_chars]


def detect_faq_sections(html: str) -> List[Dict[str, str]]:
    """Detect FAQ items from HTML without schema."""
    soup = BeautifulSoup(html, "lxml")
    faqs = []
    seen_questions = set()

    def add_faq(q: str, a: str):
        q = q.strip()
        if q and q not in seen_questions and len(q) > 5:
            seen_questions.add(q)
            faqs.append({"question": q, "answer": a.strip()[:300]})

    # Pattern 1: <details>/<summary>
    for details in soup.find_all("details"):
        summary = details.find("summary")
        if summary:
            answer_parts = [t for t in details.find_all(string=True, recursive=True)
                           if t.parent.name != "summary"]
            answer = " ".join(answer_parts).strip()[:300]
            if answer:
                add_faq(summary.get_text(strip=True), answer)

    # Pattern 2: Question-like headings followed by paragraphs (always run)
    for heading in soup.find_all(["h2", "h3", "h4", "dt"]):
        text = heading.get_text(strip=True)
        if "?" in text or any(text.lower().startswith(w) for w in
                               ["was ", "wie ", "warum ", "wann ", "wo ", "wer ",
                                "what ", "how ", "why ", "when ", "where ", "who ",
                                "kann ", "können ", "darf ", "haben ", "ist ", "sind "]):
            next_el = heading.find_next_sibling()
            if next_el and next_el.name in ["p", "dd", "div", "ul"]:
                add_faq(text, next_el.get_text(strip=True)[:300])

    # Pattern 3: elements with aria-expanded or FAQ-class hints
    for el in soup.find_all(class_=lambda c: c and any(
            kw in " ".join(c if isinstance(c, list) else [c]).lower()
            for kw in ["faq", "accordion", "question", "collapsible"])):
        heading = el.find(["h2", "h3", "h4", "strong", "b"])
        body = el.find(["p", "div", "span"])
        if heading and body:
            add_faq(heading.get_text(strip=True), body.get_text(strip=True)[:300])

    return faqs[:20]


async def analyze_content(results: List[CrawlResult], questionnaire: Dict,
                           client: Anthropic) -> Dict[str, Any]:
    # Gather representative content (up to 3 most content-rich pages)
    pages_with_content = [(r, extract_text_content(r.html, 3000))
                          for r in results if r.html]
    pages_with_content.sort(key=lambda x: len(x[1]), reverse=True)
    sample_pages = pages_with_content[:3]

    combined_content = "\n\n---PAGE BREAK---\n\n".join(
        f"URL: {p[0].url}\n{p[1]}" for p in sample_pages
    )[:8000]

    company = questionnaire.get("company_name", "")
    personas = questionnaire.get("personas", "")
    differentiators = questionnaire.get("differentiators", "")

    prompt = f"""Analyze this B2B industrial website content and return ONLY valid JSON.

Company: {company}
Target personas: {personas}
Key differentiators: {differentiators}

Website content sample:
{combined_content}

Return this exact JSON structure (scores 0-10, findings as short German bullet points):
{{
  "use_cases": {{
    "score": <0-10>,
    "findings": ["<finding>", "<finding>", "<finding>"]
  }},
  "buyer_questions": {{
    "score": <0-10>,
    "findings": ["<finding>", "<finding>", "<finding>"]
  }},
  "technical_depth": {{
    "score": <0-10>,
    "findings": ["<finding>", "<finding>", "<finding>"]
  }},
  "content_gaps": {{
    "score": <0-10>,
    "findings": ["<finding>", "<finding>", "<finding>"]
  }},
  "overall_summary": "<2-3 sentence German summary>"
}}"""

    try:
        response = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=1500,
            messages=[{"role": "user", "content": prompt}]
        )
        raw = response.content[0].text.strip()
        # Strip markdown code fences if present
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        data = json.loads(raw.strip())
        avg_score = round(
            (data["use_cases"]["score"] + data["buyer_questions"]["score"] +
             data["technical_depth"]["score"] + (10 - data["content_gaps"]["score"])) / 4 * 10
        )
        data["score"] = max(0, min(100, avg_score))
        return data
    except Exception as e:
        return {
            "score": 50,
            "use_cases": {"score": 5, "findings": ["Analyse nicht verfügbar"]},
            "buyer_questions": {"score": 5, "findings": ["Analyse nicht verfügbar"]},
            "technical_depth": {"score": 5, "findings": ["Analyse nicht verfügbar"]},
            "content_gaps": {"score": 5, "findings": [str(e)[:100]]},
            "overall_summary": "Inhaltsanalyse konnte nicht vollständig durchgeführt werden.",
        }


async def analyze_faq(results: List[CrawlResult], has_faq_schema: bool,
                      client: Anthropic) -> Dict[str, Any]:
    all_faqs = []
    pages_with_faq = 0

    for result in results:
        if result.html:
            page_faqs = detect_faq_sections(result.html)
            if page_faqs:
                pages_with_faq += 1
                all_faqs.extend(page_faqs)

    faq_count = len(all_faqs)

    # LLM quality assessment
    quality_score = 5
    quality_findings = []

    if all_faqs:
        faq_sample = json.dumps(all_faqs[:6], ensure_ascii=False)
        prompt = f"""Rate the quality of these FAQ items from a B2B industrial website.
Return ONLY valid JSON:
{{
  "quality_score": <1-10>,
  "findings": ["<German bullet>", "<German bullet>", "<German bullet>"]
}}

FAQs: {faq_sample}"""
        try:
            resp = client.messages.create(
                model="claude-sonnet-4-6",
                max_tokens=500,
                messages=[{"role": "user", "content": prompt}]
            )
            raw = resp.content[0].text.strip()
            if raw.startswith("```"):
                raw = raw.split("```")[1]
                if raw.startswith("json"):
                    raw = raw[4:]
            q_data = json.loads(raw.strip())
            quality_score = q_data.get("quality_score", 5)
            quality_findings = q_data.get("findings", [])
        except Exception:
            pass

    # Score
    score = 0
    if has_faq_schema:
        score += 40
    if faq_count > 0:
        score += min(30, faq_count * 5)
    score += quality_score * 3
    score = min(100, score)

    return {
        "score": score,
        "faq_count": faq_count,
        "pages_with_faq": pages_with_faq,
        "has_faq_schema": has_faq_schema,
        "quality_score": quality_score,
        "quality_findings": quality_findings,
        "sample_faqs": all_faqs[:5],
    }


def _parse_json_response(raw: str) -> Any:
    """Strip markdown fences (anywhere) and parse JSON. Falls back to
    extracting the first balanced { ... } or [ ... ] block."""
    raw = raw.strip()
    # Try fenced block first (json or anything)
    if "```" in raw:
        parts = raw.split("```")
        for chunk in parts:
            chunk = chunk.strip()
            if chunk.startswith("json"):
                chunk = chunk[4:].strip()
            if chunk.startswith("{") or chunk.startswith("["):
                try:
                    return json.loads(chunk)
                except Exception:
                    pass
    # Try the whole thing
    try:
        return json.loads(raw)
    except Exception:
        pass
    # Last resort: find first JSON object/array by bracket matching
    for opener, closer in (("{", "}"), ("[", "]")):
        start = raw.find(opener)
        if start == -1:
            continue
        depth = 0
        for i in range(start, len(raw)):
            if raw[i] == opener:
                depth += 1
            elif raw[i] == closer:
                depth -= 1
                if depth == 0:
                    try:
                        return json.loads(raw[start:i + 1])
                    except Exception:
                        break
    raise ValueError(f"Could not parse JSON from response: {raw[:200]}")


async def _generate_problem_questions(combined_content: str, industry: str,
                                       client: Anthropic) -> List[str]:
    """Part A: 6 problem-first questions WITHOUT the company name."""
    prompt = f"""You are simulating a B2B buyer in early research mode who does NOT yet know any specific vendor.
Based on the website content below, infer the product category, industry, and key use cases.

Industry/persona context: {industry}

Website content sample:
{combined_content[:4000]}

Generate exactly 6 realistic German-language questions that such a buyer would ask an AI assistant.
Each question MUST:
- Describe the problem, product category, technical need, or use case
- NOT mention any company name, brand, product line, or domain
- Sound like "Welcher Hersteller bietet X?", "Wie kann ich Y automatisieren?", "Welche Unternehmen liefern Z?"

The goal is: if this vendor has strong LLM visibility, an AI should naturally recommend them in answers to these questions.

Return ONLY valid JSON:
{{"questions": ["<q1>", "<q2>", "<q3>", "<q4>", "<q5>", "<q6>"]}}"""

    try:
        resp = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=700,
            messages=[{"role": "user", "content": prompt}]
        )
        return _parse_json_response(resp.content[0].text).get("questions", [])[:6]
    except Exception as e:
        print(f"[llm_analysis] Part A generation failed: {e}", flush=True)
        return []


async def _generate_brand_questions(combined_content: str, company: str, domain: str,
                                     client: Anthropic) -> List[str]:
    """Part B: 4 brand-verification questions WITH the company name."""
    prompt = f"""You are simulating a B2B buyer who already knows the company "{company}" (domain: {domain}) 
and wants to verify specific information before contacting them.

Website content sample:
{combined_content[:4000]}

Generate exactly 4 realistic German-language questions that explicitly mention "{company}".
Mix categories like: certifications, product specs, delivery times, support, comparisons, use-case fit.

Examples of the right framing:
- "Welche Zertifizierungen hat {company} für [specific industry]?"
- "Welche Lieferzeiten bietet {company} für [product]?"

Return ONLY valid JSON:
{{"questions": ["<q1>", "<q2>", "<q3>", "<q4>"]}}"""

    try:
        resp = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=600,
            messages=[{"role": "user", "content": prompt}]
        )
        return _parse_json_response(resp.content[0].text).get("questions", [])[:4]
    except Exception:
        return [
            f"Welche Zertifizierungen hat {company}?",
            f"Welche Produkte bietet {company} an?",
            f"Wie ist der Support bei {company}?",
            f"Welche typischen Lieferzeiten bietet {company}?",
        ]


async def _rate_questions_with_sources(questions: List[str],
                                        page_blocks: List[Dict[str, str]],
                                        client: Anthropic) -> List[Dict[str, Any]]:
    """Rate each question 1-5 and identify the best source URL from crawled pages."""
    if not questions:
        return []

    # Build a labelled content document so the model can reference URLs.
    pages_doc = "\n\n".join(
        f"[PAGE {i+1}] URL: {p['url']}\n{p['text']}"
        for i, p in enumerate(page_blocks)
    )[:8000]

    url_list = [p["url"] for p in page_blocks]

    prompt = f"""Using ONLY the crawled website pages below as your knowledge source,
rate how completely you could answer each question (1=cannot answer at all, 5=fully and specifically answerable).

For each question, also identify the SINGLE best-matching page URL that supports the answer.
If no page covers the question adequately (rating 1 or 2), set "source_url" to null.
The source_url MUST be one of the exact URLs listed in the pages, or null.

Crawled pages:
{pages_doc}

Available URLs (must pick exactly one of these or null):
{json.dumps(url_list, ensure_ascii=False)}

Questions to rate:
{json.dumps(questions, ensure_ascii=False)}

Return ONLY valid JSON:
{{"ratings": [
  {{"question": "<q>", "rating": <1-5>, "gap": "<short German explanation of what info is missing or why the rating>", "source_url": <"url" or null>}},
  ...
]}}"""

    try:
        resp = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=1500,
            messages=[{"role": "user", "content": prompt}]
        )
        ratings = _parse_json_response(resp.content[0].text).get("ratings", [])
        # Validate source_url against actual list
        valid_urls = set(url_list)
        for r in ratings:
            src = r.get("source_url")
            if src and src not in valid_urls:
                r["source_url"] = None
            elif "source_url" not in r:
                r["source_url"] = None
        return ratings
    except Exception:
        return [{"question": q, "rating": 3, "gap": "Analyse nicht verfügbar",
                 "source_url": None} for q in questions]


async def analyze_llm_discoverability(results: List[CrawlResult], questionnaire: Dict,
                                       client: Anthropic) -> Dict[str, Any]:
    # Build per-page text blocks with their URL preserved for source attribution
    page_blocks = [
        {"url": r.url, "text": extract_text_content(r.html, 1800)}
        for r in results if r.html
    ][:6]
    combined = "\n\n".join(p["text"] for p in page_blocks)[:6000]

    company = questionnaire.get("company_name", "Unbekanntes Unternehmen")
    industry = questionnaire.get("personas", "")
    url = questionnaire.get("url", "")
    domain = ""
    try:
        domain = urlparse(url if url.startswith("http") else "https://" + url).hostname or url
    except Exception:
        domain = url

    # Step 1a: Generate problem-first questions (Part A)
    questions_a = await _generate_problem_questions(combined, industry, client)

    # Step 1b: Generate brand-verification questions (Part B)
    questions_b = await _generate_brand_questions(combined, company, domain, client)

    # Step 2: Rate both sets, with source URL attribution
    ratings_a = await _rate_questions_with_sources(questions_a, page_blocks, client)
    ratings_b = await _rate_questions_with_sources(questions_b, page_blocks, client)

    avg_a = round(sum(r.get("rating", 3) for r in ratings_a) / len(ratings_a), 2) if ratings_a else 0
    avg_b = round(sum(r.get("rating", 3) for r in ratings_b) / len(ratings_b), 2) if ratings_b else 0

    score_a = round(avg_a * 20)  # 1-5 → 20-100
    score_b = round(avg_b * 20)

    # Weighted overall: Part A 70%, Part B 30%
    if ratings_a and ratings_b:
        composite = round(score_a * 0.7 + score_b * 0.3)
    elif ratings_a:
        composite = score_a
    elif ratings_b:
        composite = score_b
    else:
        composite = 0

    # Also build a flat list for backward compatibility
    combined_ratings = ratings_a + ratings_b
    overall_avg = (round(sum(r.get("rating", 3) for r in combined_ratings) /
                          len(combined_ratings), 2)
                   if combined_ratings else 0)

    return {
        "score": composite,
        "avg_rating": overall_avg,
        # Backward-compat flat list
        "questions_rated": combined_ratings,
        # New two-part structure
        "part_a": {
            "label": "Auffindbarkeit ohne Markenbezug",
            "weight": 0.7,
            "avg_rating": avg_a,
            "score": score_a,
            "questions_rated": ratings_a,
        },
        "part_b": {
            "label": "Marken- & Produktverifikation",
            "weight": 0.3,
            "avg_rating": avg_b,
            "score": score_b,
            "questions_rated": ratings_b,
        },
    }
