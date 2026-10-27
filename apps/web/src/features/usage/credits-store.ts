import { create } from 'zustand';
import { useAuth } from '../auth/auth-store';
import type { PlanId } from '../billing/types';
import { fetchCredits } from './api';
import type { CreditsReport } from './types';

/**
 * Уровень доступа без платной подписки определяет баланс: пока есть купленные кредиты, это
 * `credits`, после последнего потраченного — `free`. Сервер присылает его с отчётом, и сайт
 * подтягивает профиль, не дожидаясь перезагрузки страницы.
 */
function syncAccessLevel(report: CreditsReport): void {
  const user = useAuth.getState().user;
  if (!user || (user.plan !== 'free' && user.plan !== 'credits')) return;
  if (report.plan !== 'free' && report.plan !== 'credits') return;
  if (user.plan !== report.plan) {
    useAuth.setState({ user: { ...user, plan: report.plan as PlanId } });
  }
}

interface CreditsState {
  report: CreditsReport | null;
  /** Перезапросить остаток (после ответа модели, смены режима Max или покупки пакета). */
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
    if (request !== latestRequest) return;
    set({ report });
    if (report) syncAccessLevel(report);
  },
  reset: () => {
    latestRequest += 1;
    set({ report: null });
  },
}));
