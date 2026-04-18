import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type {
  View, Theme, AnalysisStatus, Questionnaire, ProgressEvent, AnalysisResult
} from '../types'

interface AppState {
  activeView: View
  setActiveView: (v: View) => void
  theme: Theme
  setTheme: (t: Theme) => void
  questionnaire: Questionnaire
  setQuestionnaire: (q: Partial<Questionnaire>) => void
  htmlContent: string
  setHtmlContent: (h: string) => void
  crawledUrls: string[]
  selectedUrls: string[] | null
  setCrawledUrls: (urls: string[]) => void
  setSelectedUrls: (urls: string[] | null) => void
  apiKeyConfigured: boolean | null
  setApiKeyConfigured: (v: boolean) => void
  taskId: string | null
  analysisStatus: AnalysisStatus
  progressEvents: ProgressEvent[]
  result: AnalysisResult | null
  analysisError: string | null
  startAnalysis: (taskId: string) => void
  addProgress: (ev: ProgressEvent) => void
  setResult: (r: AnalysisResult) => void
  setError: (e: string) => void
  resetAnalysis: () => void
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      activeView: 'domain',
      setActiveView: (v) => set({ activeView: v }),
      theme: 'system',
      setTheme: (t) => set({ theme: t }),
      questionnaire: {
        company_name: '', url: '', competitor_urls: [''],
        social_media: {}, personas: '', differentiators: '', brand_terms: [],
      },
      setQuestionnaire: (q) => set((s) => ({ questionnaire: { ...s.questionnaire, ...q } })),
      htmlContent: '',
      setHtmlContent: (h) => set({ htmlContent: h }),
      crawledUrls: [],
      selectedUrls: null,
      setCrawledUrls: (urls) => set({ crawledUrls: urls }),
      setSelectedUrls: (urls) => set({ selectedUrls: urls }),
      apiKeyConfigured: null,
      setApiKeyConfigured: (v) => set({ apiKeyConfigured: v }),
      taskId: null,
      analysisStatus: 'idle',
      progressEvents: [],
      result: null,
      analysisError: null,
      startAnalysis: (taskId) =>
        set({ taskId, analysisStatus: 'running', progressEvents: [], result: null, analysisError: null }),
      addProgress: (ev) => set((s) => ({ progressEvents: [...s.progressEvents, ev] })),
      setResult: (r) => set({ result: r, analysisStatus: 'done' }),
      setError: (e) => set({ analysisError: e, analysisStatus: 'error' }),
      resetAnalysis: () =>
        set({ taskId: null, analysisStatus: 'idle', progressEvents: [], result: null, analysisError: null }),
    }),
    {
      name: 'gaio-store',
      partialize: (s) => ({
        theme: s.theme,
        questionnaire: s.questionnaire,
        htmlContent: s.htmlContent,
        crawledUrls: s.crawledUrls,
        selectedUrls: s.selectedUrls,
        result: s.result,
        analysisStatus: s.analysisStatus,
        activeView: s.activeView,
      }),
    }
  )
)
