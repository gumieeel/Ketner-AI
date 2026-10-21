import { create } from 'zustand';
import { storage } from '@/lib/storage';
import type { JudgeResult, ReviewerInfo } from '@/features/review/types';

export type CompareSlotStatus = 'streaming' | 'done' | 'error';

/** Одна колонка сравнения на экране. */
export interface CompareSlotView {
  slot: number;
  requestedModelId: string;
  /** Модель, которая ответила (до ответа совпадает с запрошенной). */
  modelId: string;
  modelName: string;
  content: string;
  status: CompareSlotStatus;
  routingReason?: string;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs?: number;
  ttftMs?: number | null;
  errorCode?: string;
  errorMessage?: string;
}

export type CompareRunStatus = 'streaming' | 'done' | 'failed';

/** Судья сравнения («консилиум»): итог из ответов колонок. */
export interface CompareJudgeView {
  status: 'streaming' | 'done' | 'error';
  /** Итоговый ответ по мере генерации. */
  content: string;
  reviewer?: ReviewerInfo;
  result?: JudgeResult;
  error?: string;
  errorCode?: string;
  saving?: boolean;
  /** Итог сейчас сохранён в диалоге вместо ответа колонки. */
  saved?: boolean;
  saveError?: string;
}

/** Сравнение, которое сейчас показано под вопросом диалога. */
export interface CompareRunView {
  conversationId: string;
  /** Сообщение ассистента, которое колонки заменяют на экране. */
  assistantId: string;
  /** Идентификатор запуска на сервере: по нему выбирается ответ. Пуст, пока поток не начался. */
  runId: string;
  status: CompareRunStatus;
  slots: CompareSlotView[];
  /** Колонка, ответ которой сервер уже сохранил в диалог. */
  savedSlot: number | null;
  pickedSlot: number | null;
  picking: boolean;
  pickError?: string;
  judge?: CompareJudgeView;
}

const MODE_KEY = 'compareMode';
const MODELS_KEY = 'compareModels';

function readMode(): boolean {
  return storage.get(MODE_KEY) === '1';
}

function readModelIds(): string[] {
  const raw = storage.get(MODELS_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

interface CompareState {
  /** Режим сравнения включён: следующий вопрос уйдёт нескольким моделям сразу. */
  enabled: boolean;
  /** Выбранные для сравнения модели; пусто, пока человек не включал сравнение. */
  modelIds: string[];
  runs: Record<string, CompareRunView>;

  setEnabled: (enabled: boolean) => void;
  setModelIds: (ids: string[]) => void;
  putRun: (run: CompareRunView) => void;
  patchRun: (conversationId: string, patch: Partial<CompareRunView>) => void;
  patchSlot: (conversationId: string, slot: number, patch: Partial<CompareSlotView>) => void;
  /** Дописывает порции текста нескольких колонок за одно обновление состояния. */
  appendContent: (conversationId: string, chunks: ReadonlyMap<number, string>) => void;
  clearRun: (conversationId: string) => void;
  patchJudge: (conversationId: string, patch: Partial<CompareJudgeView> | null) => void;
}

export const useCompare = create<CompareState>((set) => ({
  enabled: readMode(),
  modelIds: readModelIds(),
  runs: {},

  setEnabled: (enabled) => {
    storage.set(MODE_KEY, enabled ? '1' : '0');
    set({ enabled });
  },

  setModelIds: (modelIds) => {
    storage.set(MODELS_KEY, JSON.stringify(modelIds));
    set({ modelIds });
  },

  putRun: (run) => set((state) => ({ runs: { ...state.runs, [run.conversationId]: run } })),

  patchRun: (conversationId, patch) =>
    set((state) => {
      const run = state.runs[conversationId];
      return run ? { runs: { ...state.runs, [conversationId]: { ...run, ...patch } } } : state;
    }),

  patchSlot: (conversationId, slot, patch) =>
    set((state) => {
      const run = state.runs[conversationId];
      if (!run) return state;
      const slots = run.slots.map((item) => (item.slot === slot ? { ...item, ...patch } : item));
      return { runs: { ...state.runs, [conversationId]: { ...run, slots } } };
    }),

  appendContent: (conversationId, chunks) =>
    set((state) => {
      const run = state.runs[conversationId];
      if (!run || chunks.size === 0) return state;
      const slots = run.slots.map((item) =>
        chunks.has(item.slot) ? { ...item, content: item.content + chunks.get(item.slot) } : item,
      );
      return { runs: { ...state.runs, [conversationId]: { ...run, slots } } };
    }),

  patchJudge: (conversationId, patch) =>
    set((state) => {
      const run = state.runs[conversationId];
      if (!run) return state;
      const judge: CompareJudgeView | undefined = patch
        ? { ...(run.judge ?? { status: 'streaming', content: '' }), ...patch }
        : undefined;
      return { runs: { ...state.runs, [conversationId]: { ...run, judge } } };
    }),

  clearRun: (conversationId) =>
    set((state) => {
      if (!(conversationId in state.runs)) return state;
      const runs = { ...state.runs };
      delete runs[conversationId];
      return { runs };
    }),
}));
