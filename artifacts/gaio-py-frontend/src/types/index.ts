export type View = 'domain' | 'html' | 'results' | 'faq' | 'settings'
export type Theme = 'light' | 'dark' | 'system'
export type AnalysisStatus = 'idle' | 'running' | 'done' | 'error'

export interface Questionnaire {
  company_name: string
  url: string
  competitor_urls: string[]
  social_media: Record<string, string>
  personas: string
  differentiators: string
  brand_terms: string[]
}

export interface ProgressEvent {
  module: string
  status: 'running' | 'done' | 'skipped'
  step: number
  crawled_urls?: string[]
}

export interface ScoreSet {
  technical_seo: number
  schema: number
  headings: number
  content: number
  faq: number
  llm_discoverability: number
}

export interface Recommendation {
  title: string
  problem: string
  why_matters: string
  fix: string
}

export interface CompetitorResult {
  url: string
  composite: number
  pages_analyzed: number
  scores: {
    technical_seo: number
    schema: number
    headings: number
    content: number
    faq: number
  }
  is_https: boolean
  avg_response_ms: number
  has_product_schema: boolean
  has_org_schema: boolean
  has_faq_schema: boolean
  schema_types: string[]
  insights?: {
    competitor_advantages: string
    main_advantages: string
    recommendation: string
  }
  error?: string
}

export interface AnalysisResult {
  gaio_score: number
  scores: ScoreSet
  crawled_urls: string[]
  technical_seo: any
  schema: any
  headings: any
  content: any
  faq: any
  llm: any
  competitors: CompetitorResult[]
  recommendations: {
    critical: Recommendation[]
    high_leverage: Recommendation[]
    secondary: Recommendation[]
  }
  executive_summary?: string
  questionnaire: Questionnaire
  html_mode?: boolean
}
