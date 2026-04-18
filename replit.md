# GAIO Analyzer

## Overview

GAIO Analyzer is a B2B industrial website audit tool that evaluates LLM discoverability and classic SEO readiness. It features a multi-step workflow: questionnaire, input mode selection (URL or HTML), analysis with 7 modules, and a visual report with charts and recommendations.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Frontend**: React + Vite + Tailwind CSS
- **Charts**: Recharts (radar, donut, bar charts)
- **HTML parsing**: cheerio (Node.js)
- **AI/LLM**: Anthropic via Replit AI Integrations (claude-sonnet-4-6)
- **Database**: PostgreSQL + Drizzle ORM (not currently used for analysis storage)
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Architecture

### Frontend (artifacts/gaio-analyzer)
- Single-page app with 4-step flow: Questionnaire → Input Mode → Analysis Progress → Report
- All UI text in German
- Dark Bloomberg-terminal-inspired theme
- Uses Recharts for radar/spider charts, donut charts, bar charts
- Report export as self-contained HTML

### Backend (artifacts/api-server)
- POST /api/analyze — Start analysis (returns analysis ID)
- GET /api/analyze/:id — Get analysis status/report (poll for progress)
- GET /api/analyze/:id/events — SSE stream for real-time progress

### Analysis Modules
1. **Technical SEO** — Response time, TTFB, meta tags, alt text, HTTPS, robots.txt, sitemap.xml
2. **Schema.org** — JSON-LD extraction, type detection, Product schema validation
3. **Heading Structure** — H1 count, hierarchy issues, keyword presence
4. **Content Relevance** (LLM) — Use cases, buyer questions, technical depth, content gaps
5. **FAQ Quality** (LLM) — FAQ detection via schema and HTML patterns, quality assessment
6. **LLM Discoverability** (LLM) — Question generation and answer quality prediction
7. **Competitor Comparison** — Lightweight analysis of competitor URLs from questionnaire

### Scoring
- Technical SEO: 15%
- Schema/Structured Data: 20%
- Heading Structure: 10%
- Content Relevance: 20%
- FAQ Quality: 15%
- LLM Discoverability: 20%

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/api-server run dev` — run API server locally
- `pnpm --filter @workspace/gaio-analyzer run dev` — run frontend dev server

## Key Files

- `lib/api-spec/openapi.yaml` — OpenAPI spec (source of truth for API contracts)
- `artifacts/api-server/src/lib/analysis-engine.ts` — Main analysis orchestration
- `artifacts/api-server/src/lib/crawler.ts` — Website crawler
- `artifacts/api-server/src/lib/analyzers/` — Individual analysis modules
- `artifacts/api-server/src/routes/analyze.ts` — Analysis API endpoints
- `artifacts/gaio-analyzer/src/components/` — Frontend components (QuestionnaireForm, InputModeSelection, AnalysisProgress, ReportDashboard)
- `lib/integrations-anthropic-ai/` — Anthropic AI integration package

## Environment Variables

- `AI_INTEGRATIONS_ANTHROPIC_BASE_URL` — Auto-configured by Replit AI Integrations
- `AI_INTEGRATIONS_ANTHROPIC_API_KEY` — Auto-configured by Replit AI Integrations
- `SESSION_SECRET` — Session secret
- `DATABASE_URL` — PostgreSQL connection (auto-configured)

## Python Version (artifacts/gaio-py + artifacts/gaio-py-backend)

A parallel Python FastAPI + React/Vite implementation of the GAIO Analyzer.

### Architecture
- **Frontend**: `artifacts/gaio-py/` — React + Vite, plain CSS (no Tailwind), Zustand for state, Axios for API calls
- **Backend**: `artifacts/gaio-py-backend/` — FastAPI + uvicorn, async analysis pipeline with SSE streaming
- **Preview path**: `/gaio-py/`

### Running the Python version
Two workflows must be active:
1. `artifacts/gaio-py: web` — Vite dev server on port 25760
2. `gaio-py: Python Backend` — uvicorn on port 8000

The Vite dev server proxies `/gaio-py/api/*` → `http://localhost:8000/api/*`.

### Python Backend API
- `GET /api/health` — Health check with `api_key_configured` flag
- `GET /api/check-sitemap?url=...` — Check robots.txt / sitemap.xml availability
- `POST /api/analyze/domain` — Start domain analysis (async, returns `task_id`)
- `POST /api/analyze/html` — Start HTML analysis (async, returns `task_id`)
- `GET /api/analysis/{task_id}/stream` — SSE progress stream
- `GET /api/analysis/{task_id}/results` — Fetch completed analysis results

### Key Files (Python version)
- `artifacts/gaio-py-backend/main.py` — FastAPI app, all endpoints and analysis modules
- `artifacts/gaio-py/src/store/appStore.ts` — Zustand store with persist
- `artifacts/gaio-py/src/lib/api.ts` — Axios instance with `BASE_URL` prefix
- `artifacts/gaio-py/src/views/` — DomainAnalysis, HtmlAnalysis, Results, FAQView, Settings

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
