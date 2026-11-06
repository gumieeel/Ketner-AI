import planFacts from '@/features/billing/plan-facts.json';
import { storage } from '@/lib/storage';
import { newIdempotencyKey, type AnalysisMode } from './api';

/**
 * Черновик описания задачи с главной. Живёт в localStorage этого браузера, чтобы текст не пропал
 * при перезагрузке страницы, входе в аккаунт или переходе к анализу.
 */

/** Лимит сервера на текст задачи: plan-facts.json (сверяется тестом с services/discovery-limits.ts). */
export const DISCOVERY_TEXT_MAX = planFacts.platform.limits.analyses.textChars;
/** Короче — только ссылка на сайт (как ANALYSIS_TEXT_MIN в discovery/schemas.ts на сервере). */
export const DISCOVERY_TEXT_MIN = 20;
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

const START_KEY = 'discovery.start';

/**
 * Ключ идемпотентности запуска живёт, пока не изменились описание и режим: повторное нажатие,
 * перезагрузка или обрыв сети возвращают уже созданный анализ, а не запускают второй.
 */
export function startKey(text: string, mode: AnalysisMode): string {
  try {
    const saved = JSON.parse(storage.get(START_KEY) ?? 'null') as {
      key?: string;
      text?: string;
      mode?: string;
    } | null;
    if (saved?.key && saved.text === text && saved.mode === mode) return saved.key;
  } catch {
    /* повреждённая запись — новый ключ */
  }
  const key = newIdempotencyKey();
  storage.set(START_KEY, JSON.stringify({ key, text, mode }));
  return key;
}

/** Анализ создан или сервер отказал: следующая попытка — с новым ключом. */
export function forgetStartKey(): void {
  storage.remove(START_KEY);
}
