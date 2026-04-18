import json
from typing import List, Dict, Any, Optional
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
            model="claude-sonnet-4-20250514",
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
                model="claude-sonnet-4-20250514",
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


async def analyze_llm_discoverability(results: List[CrawlResult], questionnaire: Dict,
                                       client: Anthropic) -> Dict[str, Any]:
    pages_content = [extract_text_content(r.html, 2000) for r in results if r.html]
    combined = "\n\n".join(pages_content[:4])[:6000]

    company = questionnaire.get("company_name", "Unbekanntes Unternehmen")
    industry = questionnaire.get("personas", "")

    # Step 1: Generate likely buyer questions
    q_prompt = f"""You are analyzing a B2B industrial website.
Company: {company}
Industry/personas context: {industry}
Website content: {combined[:3000]}

Generate exactly 8 realistic questions that a potential B2B buyer or researcher 
would ask an AI assistant about this company. Mix question types: 
product specs, use cases, certifications, pricing indicators, comparisons, support.
Return ONLY valid JSON:
{{"questions": ["<question>", "<question>", "<question>", "<question>", "<question>", "<question>", "<question>", "<question>"]}}"""

    questions = []
    try:
        resp = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=600,
            messages=[{"role": "user", "content": q_prompt}]
        )
        raw = resp.content[0].text.strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        questions = json.loads(raw.strip()).get("questions", [])
    except Exception:
        questions = [
            f"Was sind die Hauptprodukte von {company}?",
            f"Welche Branchen bedient {company}?",
            f"Welche Zertifizierungen hat {company}?",
            f"Wie ist der Support bei {company}?",
            f"Was unterscheidet {company} von Wettbewerbern?",
            f"Welche technischen Spezifikationen bietet {company}?",
            f"Hat {company} internationale Niederlassungen?",
            f"Wie lauten die typischen Lieferzeiten bei {company}?",
        ]

    # Step 2: Rate answerability per question
    qa_prompt = f"""Using ONLY this website content as your knowledge source, 
rate how completely you could answer each question (1=cannot answer, 5=fully answerable).

Website content:
{combined[:4000]}

Questions to rate:
{json.dumps(questions, ensure_ascii=False)}

Return ONLY valid JSON:
{{"ratings": [
  {{"question": "<q>", "rating": <1-5>, "gap": "<short German explanation of what info is missing>"}},
  ...
]}}"""

    ratings = []
    try:
        resp = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=1200,
            messages=[{"role": "user", "content": qa_prompt}]
        )
        raw = resp.content[0].text.strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        ratings = json.loads(raw.strip()).get("ratings", [])
    except Exception:
        ratings = [{"question": q, "rating": 3, "gap": "Analyse nicht verfügbar"}
                   for q in questions]

    avg_rating = round(sum(r.get("rating", 3) for r in ratings) / len(ratings), 2) if ratings else 3
    score = round(avg_rating / 5 * 100)

    return {
        "score": score,
        "avg_rating": avg_rating,
        "questions_rated": ratings,
    }
