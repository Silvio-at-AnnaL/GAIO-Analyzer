import asyncio
import json
import os
import uuid
from typing import Dict, Any, List, Optional

import httpx
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from dotenv import load_dotenv
from anthropic import Anthropic

# ── Replit AI Integrations → Anthropic SDK env mapping ────────────────────────
# The Replit AI Integrations proxy sets AI_INTEGRATIONS_ANTHROPIC_* env vars.
# The Anthropic SDK reads ANTHROPIC_API_KEY and ANTHROPIC_BASE_URL natively.
if not os.getenv("ANTHROPIC_API_KEY"):
    _key = os.getenv("AI_INTEGRATIONS_ANTHROPIC_API_KEY")
    if _key:
        os.environ["ANTHROPIC_API_KEY"] = _key
if not os.getenv("ANTHROPIC_BASE_URL"):
    _base = os.getenv("AI_INTEGRATIONS_ANTHROPIC_BASE_URL")
    if _base:
        os.environ["ANTHROPIC_BASE_URL"] = _base

from modules.crawler import crawl, CrawlResult
from modules.technical_seo import analyze_technical_seo
from modules.schema_analysis import analyze_schema
from modules.heading_analysis import analyze_headings
from modules.llm_analysis import analyze_content, analyze_faq, analyze_llm_discoverability
from modules.competitor import analyze_competitors
from modules.scoring import compute_gaio_score, generate_recommendations, generate_executive_summary, WEIGHTS

load_dotenv()

MAX_CRAWL_PAGES = int(os.getenv("MAX_CRAWL_PAGES", "15"))

# In-memory task store
tasks: Dict[str, Dict] = {}

app = FastAPI(title="GAIO Analyzer API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Models ────────────────────────────────────────────────────────────────────

class Questionnaire(BaseModel):
    company_name: str = ""
    url: str = ""
    competitor_urls: List[str] = []
    social_media: Dict[str, str] = {}
    personas: str = ""
    differentiators: str = ""
    brand_terms: List[str] = []

class DomainAnalysisRequest(BaseModel):
    questionnaire: Questionnaire
    explicit_urls: Optional[List[str]] = None  # if user selected specific subpages

class HtmlAnalysisRequest(BaseModel):
    html_content: str
    questionnaire: Questionnaire


# ── Background analysis runner ────────────────────────────────────────────────

def send_event(task_id: str, event: str, data: dict):
    if task_id in tasks:
        tasks[task_id]["events"].append({"event": event, "data": data})


async def run_domain_analysis(task_id: str, request: DomainAnalysisRequest):
    tasks[task_id]["status"] = "running"
    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    client = Anthropic(api_key=api_key) if api_key else None
    q = request.questionnaire.dict()

    try:
        # Module 1: Crawl
        send_event(task_id, "progress", {"module": "Crawler", "status": "running", "step": 1})
        crawl_results: List[CrawlResult] = await crawl(
            request.questionnaire.url,
            max_pages=MAX_CRAWL_PAGES,
            explicit_urls=request.explicit_urls
        )
        crawled_urls = [r.url for r in crawl_results]
        send_event(task_id, "progress", {
            "module": "Crawler", "status": "done", "step": 1,
            "crawled_urls": crawled_urls
        })

        # Module 2: Technical SEO
        send_event(task_id, "progress", {"module": "Technische SEO", "status": "running", "step": 2})
        tech = analyze_technical_seo(crawl_results, request.questionnaire.url)
        send_event(task_id, "progress", {"module": "Technische SEO", "status": "done", "step": 2})

        # Module 3: Schema
        send_event(task_id, "progress", {"module": "Strukturierte Daten (Schema.org)", "status": "running", "step": 3})
        schema = analyze_schema(crawl_results)
        send_event(task_id, "progress", {"module": "Strukturierte Daten (Schema.org)", "status": "done", "step": 3})

        # Module 4: Headings
        send_event(task_id, "progress", {"module": "Heading-Struktur", "status": "running", "step": 4})
        brand_terms = q.get("brand_terms", []) + [q.get("company_name", "")]
        headings = analyze_headings(crawl_results, brand_terms)
        send_event(task_id, "progress", {"module": "Heading-Struktur", "status": "done", "step": 4})

        # Module 5: Content (LLM)
        if client:
            send_event(task_id, "progress", {"module": "Inhaltliche Relevanz (KI)", "status": "running", "step": 5})
            content = await analyze_content(crawl_results, q, client)
            send_event(task_id, "progress", {"module": "Inhaltliche Relevanz (KI)", "status": "done", "step": 5})

            # Module 6: FAQ
            send_event(task_id, "progress", {"module": "FAQ-Analyse", "status": "running", "step": 6})
            faq = await analyze_faq(crawl_results, schema.get("has_faq_schema", False), client)
            send_event(task_id, "progress", {"module": "FAQ-Analyse", "status": "done", "step": 6})

            # Module 7: LLM Discoverability
            send_event(task_id, "progress", {"module": "LLM-Sichtbarkeits-Simulation", "status": "running", "step": 7})
            llm = await analyze_llm_discoverability(crawl_results, q, client)
            send_event(task_id, "progress", {"module": "LLM-Sichtbarkeits-Simulation", "status": "done", "step": 7})

            # Module 8: Competitors
            comp_urls = q.get("competitor_urls", [])
            competitors = []
            if comp_urls:
                send_event(task_id, "progress", {"module": "Wettbewerbsvergleich", "status": "running", "step": 8})
                main_scores = {
                    "technical_seo": tech["score"],
                    "schema": schema["score"],
                    "content": content["score"],
                    "faq": faq["score"],
                    "headings": headings["score"],
                }
                competitors = await analyze_competitors(
                    comp_urls, request.questionnaire.url, main_scores, client
                )
                send_event(task_id, "progress", {"module": "Wettbewerbsvergleich", "status": "done", "step": 8})

            # Scoring & Recommendations
            send_event(task_id, "progress", {"module": "Empfehlungen", "status": "running", "step": 9})
            all_scores = {
                "technical_seo": tech["score"],
                "schema": schema["score"],
                "headings": headings["score"],
                "content": content["score"],
                "faq": faq["score"],
                "llm_discoverability": llm["score"],
            }
            gaio_score = compute_gaio_score(all_scores)
            all_data = {
                "technical_seo": tech, "schema": schema, "headings": headings,
                "content": content, "faq": faq, "llm": llm
            }
            recommendations = await generate_recommendations(all_data, client)
            all_data["recommendations_preview"] = recommendations
            executive_summary = await generate_executive_summary(
                all_data, gaio_score,
                q.get("company_name") or q.get("url", ""),
                client
            )
            send_event(task_id, "progress", {"module": "Empfehlungen", "status": "done", "step": 9})
        else:
            # No API key — run without LLM modules
            content = {"score": 0, "error": "Kein Anthropic API Key konfiguriert"}
            faq = {"score": 0, "faq_count": 0, "pages_with_faq": 0,
                   "has_faq_schema": False, "quality_score": 0,
                   "quality_findings": [], "sample_faqs": []}
            llm = {"score": 0, "avg_rating": 0, "questions_rated": []}
            competitors = []
            all_scores = {
                "technical_seo": tech["score"], "schema": schema["score"],
                "headings": headings["score"], "content": 0, "faq": 0, "llm_discoverability": 0,
            }
            gaio_score = compute_gaio_score(all_scores)
            recommendations = {"critical": [], "high_leverage": [], "secondary": [],
                                "error": "API Key erforderlich für KI-Empfehlungen"}
            executive_summary = ""

        # Store complete results
        tasks[task_id]["result"] = {
            "gaio_score": gaio_score,
            "scores": all_scores,
            "crawled_urls": crawled_urls,
            "technical_seo": tech,
            "schema": schema,
            "headings": headings,
            "content": content,
            "faq": faq,
            "llm": llm,
            "competitors": competitors,
            "recommendations": recommendations,
            "executive_summary": executive_summary,
            "questionnaire": q,
        }
        tasks[task_id]["status"] = "done"
        send_event(task_id, "complete", {"status": "done"})

    except Exception as e:
        tasks[task_id]["status"] = "error"
        tasks[task_id]["error"] = str(e)
        send_event(task_id, "error", {"message": str(e)})


async def run_html_analysis(task_id: str, request: HtmlAnalysisRequest):
    tasks[task_id]["status"] = "running"
    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    client = Anthropic(api_key=api_key) if api_key else None
    q = request.questionnaire.dict()

    try:
        fake_result = CrawlResult("html-upload", request.html_content, 200, 0)
        crawl_results = [fake_result]

        send_event(task_id, "progress", {"module": "Technische SEO", "status": "running", "step": 1})
        tech = analyze_technical_seo(crawl_results, "html-upload")
        send_event(task_id, "progress", {"module": "Technische SEO", "status": "done", "step": 1})

        send_event(task_id, "progress", {"module": "Strukturierte Daten (Schema.org)", "status": "running", "step": 2})
        schema = analyze_schema(crawl_results)
        send_event(task_id, "progress", {"module": "Strukturierte Daten (Schema.org)", "status": "done", "step": 2})

        send_event(task_id, "progress", {"module": "Heading-Struktur", "status": "running", "step": 3})
        headings = analyze_headings(crawl_results)
        send_event(task_id, "progress", {"module": "Heading-Struktur", "status": "done", "step": 3})

        if client:
            send_event(task_id, "progress", {"module": "Inhaltliche Relevanz (KI)", "status": "running", "step": 4})
            content = await analyze_content(crawl_results, q, client)
            send_event(task_id, "progress", {"module": "Inhaltliche Relevanz (KI)", "status": "done", "step": 4})

            send_event(task_id, "progress", {"module": "FAQ-Analyse", "status": "running", "step": 5})
            faq = await analyze_faq(crawl_results, schema.get("has_faq_schema", False), client)
            send_event(task_id, "progress", {"module": "FAQ-Analyse", "status": "done", "step": 5})

            send_event(task_id, "progress", {"module": "LLM-Sichtbarkeits-Simulation", "status": "running", "step": 6})
            llm = await analyze_llm_discoverability(crawl_results, q, client)
            send_event(task_id, "progress", {"module": "LLM-Sichtbarkeits-Simulation", "status": "done", "step": 6})

            send_event(task_id, "progress", {"module": "Empfehlungen", "status": "running", "step": 7})
            all_scores = {
                "technical_seo": tech["score"], "schema": schema["score"],
                "headings": headings["score"], "content": content["score"],
                "faq": faq["score"], "llm_discoverability": llm["score"],
            }
            gaio_score = compute_gaio_score(all_scores)
            all_data = {"technical_seo": tech, "schema": schema, "headings": headings,
                        "content": content, "faq": faq, "llm": llm}
            recommendations = await generate_recommendations(all_data, client)
            all_data["recommendations_preview"] = recommendations
            executive_summary = await generate_executive_summary(
                all_data, gaio_score,
                q.get("company_name") or "HTML-Upload",
                client
            )
            send_event(task_id, "progress", {"module": "Empfehlungen", "status": "done", "step": 7})
        else:
            content = {"score": 0}; faq = {"score": 0, "faq_count": 0, "pages_with_faq": 0,
                "has_faq_schema": False, "quality_score": 0, "quality_findings": [], "sample_faqs": []}
            llm = {"score": 0, "avg_rating": 0, "questions_rated": []}
            all_scores = {"technical_seo": tech["score"], "schema": schema["score"],
                          "headings": headings["score"], "content": 0, "faq": 0, "llm_discoverability": 0}
            gaio_score = compute_gaio_score(all_scores)
            recommendations = {"critical": [], "high_leverage": [], "secondary": []}
            executive_summary = ""

        tasks[task_id]["result"] = {
            "gaio_score": gaio_score, "scores": all_scores, "crawled_urls": ["html-upload"],
            "technical_seo": tech, "schema": schema, "headings": headings,
            "content": content, "faq": faq, "llm": llm,
            "competitors": [], "recommendations": recommendations,
            "executive_summary": executive_summary,
            "questionnaire": q, "html_mode": True,
        }
        tasks[task_id]["status"] = "done"
        send_event(task_id, "complete", {"status": "done"})

    except Exception as e:
        tasks[task_id]["status"] = "error"
        tasks[task_id]["error"] = str(e)
        send_event(task_id, "error", {"message": str(e)})


# ── API Routes ─────────────────────────────────────────────────────────────────

@app.post("/api/analyze/domain")
async def start_domain_analysis(request: DomainAnalysisRequest, background_tasks: BackgroundTasks):
    task_id = str(uuid.uuid4())
    tasks[task_id] = {"status": "queued", "events": [], "result": None}
    background_tasks.add_task(run_domain_analysis, task_id, request)
    return {"task_id": task_id}


@app.post("/api/analyze/html")
async def start_html_analysis(request: HtmlAnalysisRequest, background_tasks: BackgroundTasks):
    task_id = str(uuid.uuid4())
    tasks[task_id] = {"status": "queued", "events": [], "result": None}
    background_tasks.add_task(run_html_analysis, task_id, request)
    return {"task_id": task_id}


@app.get("/api/analysis/{task_id}/stream")
async def stream_progress(task_id: str):
    if task_id not in tasks:
        raise HTTPException(status_code=404, detail="Task not found")

    async def event_generator():
        last_index = 0
        while True:
            if task_id in tasks:
                events = tasks[task_id]["events"]
                while last_index < len(events):
                    ev = events[last_index]
                    yield f"event: {ev['event']}\ndata: {json.dumps(ev['data'])}\n\n"
                    last_index += 1
                if tasks[task_id]["status"] in ("done", "error"):
                    break
            await asyncio.sleep(0.3)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/api/analysis/{task_id}/results")
async def get_results(task_id: str):
    if task_id not in tasks:
        raise HTTPException(status_code=404, detail="Task not found")
    task = tasks[task_id]
    if task["status"] == "error":
        raise HTTPException(status_code=500, detail=task.get("error", "Unknown error"))
    if task["status"] != "done" or task["result"] is None:
        raise HTTPException(status_code=202, detail="Analysis still running")
    return task["result"]


@app.get("/api/health")
async def health():
    return {"status": "ok", "api_key_configured": bool(os.getenv("ANTHROPIC_API_KEY"))}


@app.get("/api/check-sitemap")
async def check_sitemap(url: str):
    """Check whether sitemap.xml and robots.txt exist for a domain."""
    from urllib.parse import urlparse
    parsed = urlparse(url if url.startswith("http") else "https://" + url)
    base = f"{parsed.scheme}://{parsed.netloc}"
    results: Dict[str, bool] = {}
    async with httpx.AsyncClient(follow_redirects=True, timeout=8) as client:
        for path in ["/robots.txt", "/sitemap.xml", "/sitemap_index.xml"]:
            target = base + path
            try:
                r = await client.head(target)
                if r.status_code == 405:   # HEAD not allowed — fallback to GET
                    r = await client.get(target, headers={"Range": "bytes=0-0"})
                results[path] = r.status_code in (200, 206)
            except Exception:
                results[path] = False
    return results


# ── Production: Serve React frontend ─────────────────────────────────────────
# Vite build output is at ../gaio-py/dist/public
_STATIC_DIR = os.path.join(os.path.dirname(__file__), "..", "gaio-py", "dist", "public")
if os.path.isdir(_STATIC_DIR):
    from fastapi.responses import FileResponse

    app.mount("/assets", StaticFiles(directory=os.path.join(_STATIC_DIR, "assets")), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa_fallback(full_path: str):
        index = os.path.join(_STATIC_DIR, "index.html")
        return FileResponse(index)
