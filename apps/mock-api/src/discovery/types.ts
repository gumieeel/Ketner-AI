import type { Language } from '../types.js';
import type { CapabilityId } from './capabilities.js';
import type { Feasibility, FeasibilityStatus } from './feasibility.js';
import type { Impact } from './impact.js';
import type { AnalysisMode, StageName } from './model-policy.js';
import type { ContextOutput, Question } from './schemas.js';

/**
 * Состояние анализа:
 * analyzing → needs_answers → discovering → ready; без вопросов — сразу discovering.
 * failed — этап упал; повтор запускает упавший этап снова.
 */
export type AnalysisStatus = 'analyzing' | 'needs_answers' | 'discovering' | 'ready' | 'failed';

export type StageStatus = 'pending' | 'running' | 'done' | 'failed';

export interface StageRun {
  status: StageStatus;
  /** id запуска в учёте шлюза (`runId`). */
  taskId: string;
  model?: { id: string; name: string };
  /** Себестоимость этапа со всеми попытками, $. */
  costUsd: number;
  /** Списано с кредитов пользователя, $. */
  creditsUsd: number;
  attempts: number;
  error?: { code: string; message: string };
  /** Резерв бесплатного бюджета под этап (только бесплатный сценарий). */
  reservationId?: string;
  /**
   * Кто платит за этот запуск этапа. По умолчанию — по режиму анализа (бесплатный — сервис).
   * `user` у бесплатного анализа — повторный поиск возможностей после изменения ответов: он идёт
   * той же моделью, но за кредиты пользователя (бесплатный сценарий не генерирует повторно).
   */
  billing?: 'user';
  startedAt?: string;
  finishedAt?: string;
}

export type AnswerRecord = { skipped: true } | { value: string };

export interface Analysis {
  id: string;
  /** Пользователь или гость (`guest_…`). */
  ownerId: string;
  guest: boolean;
  /** HMAC адреса (IPv6 — подсеть /64): для лимита бесплатных анализов с одного адреса. */
  ipHash: string | null;
  /** Учитывается в лимите бесплатных анализов с одного адреса (гость или аккаунт младше 7 дней). */
  ipLimited: boolean;
  mode: AnalysisMode;
  language: Language;
  status: AnalysisStatus;
  inputText: string;
  context: ContextOutput | null;
  questions: Question[];
  answers: Record<string, AnswerRecord>;
  summary: string | null;
  stages: Partial<Record<StageName, StageRun>>;
  /** Сутки бюджета бесплатных анализов (`YYYY-MM-DD` в поясе бюджета); у платных — тоже, для квот. */
  budgetDay: string;
  idempotencyKey: string | null;
  createdAt: string;
  updatedAt: string;
  /** Номер версии записи: защищает от одновременной записи двух этапов. */
  version: number;
}

export interface Opportunity {
  id: string;
  analysisId: string;
  ownerId: string;
  position: number;
  title: string;
  problem: string;
  solution: string;
  requires: CapabilityId[];
  otherRequirement: string | null;
  dataNeeded: string[];
  integrationsNeeded: string[];
  effort: 'low' | 'medium' | 'high';
  effortReason: string;
  risks: string[];
  limitations: string[];
  successCriteria: string[];
  firstStep: string;
  feasibilityStatus: FeasibilityStatus;
  feasibility: Feasibility;
  impact: Impact;
  /** Порядок в отчёте: меньше — выше. */
  priority: number;
  createdAt: string;
}
