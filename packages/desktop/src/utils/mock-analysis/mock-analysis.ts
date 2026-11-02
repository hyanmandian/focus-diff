import { vi } from "vite-plus/test";

import type { AnalysisState } from "@/hooks/use-analysis/use-analysis";

export const fakeAnalysis = (over: Partial<AnalysisState> = {}): AnalysisState => ({
  saved: [],
  analysis: null,
  record: null,
  runs: [],
  split: null,
  building: false,
  error: null,
  stale: false,
  current: false,
  build: vi.fn<AnalysisState["build"]>(() => Promise.resolve()),
  stop: vi.fn<AnalysisState["stop"]>(),
  show: vi.fn<AnalysisState["show"]>(),
  archive: vi.fn<AnalysisState["archive"]>(),
  dismiss: vi.fn<AnalysisState["dismiss"]>(),
  deepening: () => false,
  partError: () => null,
  deepen: vi.fn<AnalysisState["deepen"]>(() => Promise.resolve()),
  stopPart: vi.fn<AnalysisState["stopPart"]>(),
  ...over,
});
