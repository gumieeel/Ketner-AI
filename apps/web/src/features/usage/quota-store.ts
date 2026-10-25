import { create } from 'zustand';
import { fetchQuota } from './api';
import type { QuotaReport } from './types';

interface QuotaState {
  report: QuotaReport | null;
  /** Перезапросить остаток (после ответа модели, смены режима Max или тарифа). */
  refresh: (mode: 'standard' | 'max') => Promise<void>;
  reset: () => void;
}

let latestRequest = 0;

export const useQuota = create<QuotaState>((set) => ({
  report: null,
  refresh: async (mode) => {
    const request = ++latestRequest;
    const report = await fetchQuota(mode);
    // Ответ на устаревший запрос (режим успели переключить) не перетирает свежий.
    if (request === latestRequest) set({ report });
  },
  reset: () => {
    latestRequest += 1;
    set({ report: null });
  },
}));
