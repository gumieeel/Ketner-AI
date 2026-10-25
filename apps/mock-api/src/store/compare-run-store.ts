/**
 * Недавние запуски сравнения ответов: хранятся в памяти, чтобы выбор лучшего ответа брал текст
 * с сервера, а не от клиента.
 *
 * Запуск живёт несколько часов: он нужен, пока человек читает колонки и выбирает ответ. После
 * перезапуска сервера он теряется; выбор тогда отвечает 410, а диалог остаётся с ответом,
 * сохранённым при завершении сравнения.
 */

import { randomUUID } from 'node:crypto';
import type { JudgeAgreement, JudgeDispute } from '../services/answer-review.js';
import type { ReviewerInfo } from '../types.js';

export type CompareSlotStatus = 'complete' | 'error' | 'cancelled';

/** Итог одной колонки сравнения. */
export interface CompareSlotResult {
  slot: number;
  /** Что просили: id модели каталога или `auto`. */
  requestedModelId: string;
  /** Какая модель ответила (у Auto — выбранная роутером). */
  modelId: string;
  modelName: string;
  status: CompareSlotStatus;
  content: string;
  finishReason?: 'stop' | 'length' | 'cancelled' | 'error';
  canContinue?: boolean;
  routingReason?: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  /** Время до первого токена, мс. */
  ttftMs: number | null;
  errorCode?: string;
  errorMessage?: string;
}

/** Итог судьи («консилиум»): один ответ из нескольких и где модели расходятся. */
export interface CompareJudgeResult {
  id: string;
  content: string;
  agreement: JudgeAgreement;
  consensus: string[];
  disputes: JudgeDispute[];
  judge: ReviewerInfo;
  /** Колонки, чьи ответы видел судья. */
  slots: number[];
  createdAt: string;
}

export interface CompareRun {
  id: string;
  userId: string;
  conversationId: string;
  /** Вопрос, на который отвечали колонки: его видит судья. */
  question?: string;
  slots: CompareSlotResult[];
  /** Колонка, чей ответ сейчас сохранён в диалоге: сначала первая завершённая, потом выбранная. */
  savedSlot: number | null;
  /** Сообщение ассистента в диалоге, которое соответствует savedSlot. */
  savedMessageId: string | null;
  /** Колонка, которую человек выбрал лучшей. */
  pickedSlot: number | null;
  /** Итог судьи, если его запрашивали; `judgeSaved` — он сейчас сохранён в диалоге. */
  judge?: CompareJudgeResult;
  judgeSaved?: boolean;
  createdAt: number;
}

export interface CompareRunStoreOptions {
  ttlMs?: number;
  maxRuns?: number;
  maxPerUser?: number;
  now?: () => number;
}

export class CompareRunStore {
  private readonly runs = new Map<string, CompareRun>();
  private readonly ttlMs: number;
  private readonly maxRuns: number;
  private readonly maxPerUser: number;
  private readonly now: () => number;

  constructor(options: CompareRunStoreOptions = {}) {
    this.ttlMs = options.ttlMs ?? 3 * 3600 * 1000;
    this.maxRuns = options.maxRuns ?? 300;
    this.maxPerUser = options.maxPerUser ?? 12;
    this.now = options.now ?? Date.now;
  }

  newId(): string {
    return randomUUID();
  }

  /** Запоминает запуск; самые старые вытесняются по сроку, по числу на человека и общему числу. */
  put(run: CompareRun): void {
    this.prune();
    this.runs.set(run.id, run);
    const mine = [...this.runs.values()]
      .filter((candidate) => candidate.userId === run.userId)
      .sort((a, b) => a.createdAt - b.createdAt);
    for (const old of mine.slice(0, Math.max(0, mine.length - this.maxPerUser))) {
      this.runs.delete(old.id);
    }
    while (this.runs.size > this.maxRuns) {
      const oldest = this.runs.keys().next().value;
      if (oldest === undefined) break;
      this.runs.delete(oldest);
    }
  }

  /** Запуск виден только владельцу: чужой id отвечает так же, как несуществующий. */
  get(id: string, userId: string): CompareRun | undefined {
    const run = this.runs.get(id);
    if (!run || run.userId !== userId) return undefined;
    if (this.now() - run.createdAt > this.ttlMs) {
      this.runs.delete(id);
      return undefined;
    }
    return run;
  }

  size(): number {
    return this.runs.size;
  }

  private prune(): void {
    const limit = this.now() - this.ttlMs;
    for (const [id, run] of this.runs) {
      if (run.createdAt < limit) this.runs.delete(id);
    }
  }
}

/** Рабочее хранилище процесса. В тестах создаётся своё. */
export const compareRunStore = new CompareRunStore();
