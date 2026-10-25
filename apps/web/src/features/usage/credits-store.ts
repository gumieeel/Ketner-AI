import { create } from 'zustand';
import { fetchCredits } from './api';
import type { CreditsReport } from './types';

interface CreditsState {
  report: CreditsReport | null;
  /** Перезапросить остаток (после ответа модели, смены режима Max или тарифа). */
  refresh: (mode: 'standard' | 'max') => Promise<void>;
  reset: () => void;
}

let latestRequest = 0;

export const useCredits = create<CreditsState>((set) => ({
  report: null,
  refresh: async (mode) => {
    const request = ++latestRequest;
    const report = await fetchCredits(mode);
    // Ответ на устаревший запрос (режим успели переключить) не перетирает свежий.
    if (request === latestRequest) set({ report });
  },
  reset: () => {
    latestRequest += 1;
    set({ report: null });
  },
}));
