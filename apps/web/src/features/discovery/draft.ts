import planFacts from '@/features/billing/plan-facts.json';
import { storage } from '@/lib/storage';

/**
 * Черновик описания задачи с главной. Живёт в localStorage этого браузера, чтобы текст не пропал
 * при перезагрузке страницы, входе в аккаунт или переходе к анализу.
 */

/** Лимит сервера на текст задачи: plan-facts.json (сверяется тестом с services/discovery-limits.ts). */
export const DISCOVERY_TEXT_MAX = planFacts.platform.limits.analyses.textChars;
/** С какой длины показывать счётчик символов. */
export const DISCOVERY_TEXT_WARN = 7000;

const KEY = 'discovery.draft';

export interface DiscoveryDraft {
  text: string;
  savedAt: string;
}

export function readDraft(): DiscoveryDraft | null {
  const raw = storage.get(KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<DiscoveryDraft>;
    if (typeof parsed.text !== 'string' || !parsed.text.trim()) return null;
    return {
      text: parsed.text.slice(0, DISCOVERY_TEXT_MAX),
      savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : new Date(0).toISOString(),
    };
  } catch {
    return null;
  }
}

export function saveDraft(text: string): void {
  const trimmed = text.slice(0, DISCOVERY_TEXT_MAX);
  if (!trimmed.trim()) {
    storage.remove(KEY);
    return;
  }
  storage.set(KEY, JSON.stringify({ text: trimmed, savedAt: new Date().toISOString() }));
}

export function clearDraft(): void {
  storage.remove(KEY);
}
