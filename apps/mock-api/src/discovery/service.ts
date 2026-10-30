/**
 * Сервис анализа задач (Discovery): создание, этапы, ответы на вопросы, повтор, отчёт.
 *
 * Этапы выполняются в фоне после ответа API: клиент следит за статусом через GET. Состояние
 * каждого этапа хранится в записи анализа, поэтому после перезапуска сервера незавершённый этап
 * не теряется: через `RUNNING_MS` он считается прерванным, и пользователь может его повторить.
 *
 * Деньги:
 * - бесплатный сценарий оплачивает сервис из суточного бюджета (budget.ts): потолок каждого этапа
 *   резервируется до запуска, после этапа резерв закрывается фактической стоимостью;
 * - анализ за кредиты списывается штатно шлюзом по реальной цене каждого вызова; до запуска сервер
 *   проверяет, что баланса хватает на потолок, а дорогой режим требует подтверждения.
 */

import { randomUUID } from 'node:crypto';
import type { AIGateway } from '../ai/gateway.js';
import { modelRegistry, type ModelRegistry } from '../ai/model-registry.js';
import { disclosureOf } from '../ai/model-disclosure.js';
import { CREDITS_PER_USD, toCredits } from '../services/entitlement.js';
import type { Language, PlanId } from '../types.js';
import {
  HOLD_MS,
  RUNNING_MS,
  budgetDayOf,
  nextBudgetReset,
  type BudgetStore,
  type ReservationRequest,
} from './budget.js';
import { assessFeasibility, feasibilityRank, type UserCapabilities } from './feasibility.js';
import { estimateImpact, verifyTaskNumbers } from './impact.js';
import {
  ANALYSES_PER_OWNER_PER_DAY,
  FREE_PER_IP_PER_DAY,
  FREE_PER_OWNER_PER_DAY,
  isDisposableEmail,
} from './limits.js';
import {
  ANALYSIS_STAGES,
  CONFIRM_ABOVE_CREDITS,
  estimateStages,
  stagePolicy,
  type AnalysisMode,
  type CostEstimate,
  type StageName,
} from './model-policy.js';
import {
  contextSystemPrompt,
  contextUserMessage,
  discoverySystemPrompt,
  discoveryUserMessage,
} from './prompts.js';
import { runStructuredTask, type TaskCaller } from './run-task.js';
import {
  contextOutputSchema,
  discoveryOutputSchema,
  type AnswersBody,
  type ContextOutput,
  type DiscoveryOutput,
} from './schemas.js';
import type { DiscoveryStore } from './store.js';
import { contextTemplate, discoveryTemplate } from './templates.js';
import type { Analysis, AnswerRecord, Opportunity, StageRun } from './types.js';

/** Кто делает запрос: личность только из сессии или гостевого id (routes/analyses.ts). */
export interface DiscoveryCaller extends TaskCaller {
  /** Гость (`guest_…`): платный анализ ему недоступен. */
  guest: boolean;
  ipHash: string | null;
  /** Гость или аккаунт младше 7 дней: учитывается в лимите бесплатных анализов с адреса. */
  ipLimited: boolean;
}

export interface DiscoveryServiceDeps {
  store: DiscoveryStore;
  budget: BudgetStore;
  gateway: Pick<AIGateway, 'stream'>;
  /** Остаток кредитов пользователя, $. */
  balanceUsd: (userId: string, plan: PlanId) => number;
  userCapabilities: (caller: DiscoveryCaller) => UserCapabilities;
  freeDailyUsd: number;
  budgetTimeZone: string;
  registry?: ModelRegistry;
  now?: () => Date;
  /** Таймаут ответа провайдера, мс. */
  providerTimeoutMs?: number;
}

export type ServiceError = {
  ok: false;
  status: number;
  code: string;
  message: string;
  details?: Record<string, unknown>;
};

type Ok<T> = { ok: true } & T;

const STAGE_ORDER: readonly StageName[] = ['context', 'discovery'];

function text(language: Language, ru: string, en: string): string {
  return language === 'en' ? en : ru;
}

/** Настоящее имя модели: «GPT-6 Luna», а не «Ketner Mini». */
export function realModelName(modelId: string, registry: ModelRegistry = modelRegistry): string {
  const entry = registry.resolve(modelId);
  return disclosureOf(entry)?.baseModelName ?? entry.name;
}

export class DiscoveryService {
  private readonly registry: ModelRegistry;
  private readonly now: () => Date;
  private readonly running = new Map<string, Promise<void>>();

  constructor(private readonly deps: DiscoveryServiceDeps) {
    this.registry = deps.registry ?? modelRegistry;
    this.now = deps.now ?? (() => new Date());
  }

  /** Сутки бюджета и квот сейчас. */
  today(): string {
    return budgetDayOf(this.now(), this.deps.budgetTimeZone);
  }

  resetsAt(): string {
    return nextBudgetReset(this.now(), this.deps.budgetTimeZone).toISOString();
  }

  quote(mode: AnalysisMode, language: Language): CostEstimate {
    return estimateStages(mode, ANALYSIS_STAGES, language, this.registry);
  }

  /** Модели и цены для страницы анализа: что будет, если запустить сейчас. */
  async offer(caller: DiscoveryCaller, language: Language) {
    await this.deps.budget.expire(this.now().toISOString());
    const free = await this.freeAvailability(caller, null);
    return {
      free: free.ok
        ? { available: true as const, model: realModelName('ketner-mini', this.registry) }
        : { available: false as const, reason: free.reason, resetsAt: this.resetsAt() },
      paid: {
        model: realModelName(
          stagePolicy('paid', 'context', language, this.registry).modelId,
          this.registry,
        ),
        ...this.quote('paid', language),
        loginRequired: caller.guest,
      },
      deep: {
        model: realModelName(
          stagePolicy('deep', 'context', language, this.registry).modelId,
          this.registry,
        ),
        ...this.quote('deep', language),
        loginRequired: caller.guest,
        confirmationRequired: this.quote('deep', language).maxCredits > CONFIRM_ABOVE_CREDITS,
      },
    };
  }

  private async freeAvailability(
    caller: DiscoveryCaller,
    email: string | null,
  ): Promise<
    | { ok: true }
    | { ok: false; reason: 'daily_limit' | 'ip_limit' | 'disposable_email' | 'budget_exhausted' }
  > {
    const day = this.today();
    if (isDisposableEmail(email)) return { ok: false, reason: 'disposable_email' };
    const own = await this.deps.store.count({
      ownerId: caller.userId,
      budgetDay: day,
      mode: 'free',
    });
    if (own >= FREE_PER_OWNER_PER_DAY) return { ok: false, reason: 'daily_limit' };
    if (caller.ipLimited && caller.ipHash) {
      const fromIp = await this.deps.store.count({
        ipHash: caller.ipHash,
        budgetDay: day,
        mode: 'free',
        ipLimited: true,
      });
      if (fromIp >= FREE_PER_IP_PER_DAY) return { ok: false, reason: 'ip_limit' };
    }
    const budget = await this.deps.budget.day(day);
    const need = this.freeReservationCaps('ru').reduce((sum, item) => sum + item.capUsd, 0);
    if (budget && budget.spentUsd + budget.reservedUsd + need > this.deps.freeDailyUsd) {
      return { ok: false, reason: 'budget_exhausted' };
    }
    return { ok: true };
  }

  /** Потолки этапов бесплатного сценария: разбор, поиск возможностей и краткий план. */
  private freeReservationCaps(language: Language): Array<{ stage: StageName; capUsd: number }> {
    return (['context', 'discovery', 'plan'] as const).map((stage) => ({
      stage,
      capUsd: stagePolicy('free', stage, language, this.registry).capUsd,
    }));
  }

  private freeUnavailable(
    reason: 'daily_limit' | 'ip_limit' | 'disposable_email' | 'budget_exhausted',
    caller: DiscoveryCaller,
    language: Language,
  ): ServiceError {
    const paid = this.quote('paid', language);
    const messages: Record<typeof reason, string> = {
      daily_limit: text(
        language,
        'Бесплатный анализ на сегодня уже использован. Следующий — после сброса суток.',
        'Today’s free analysis has already been used. The next one is available after the daily reset.',
      ),
      ip_limit: text(
        language,
        'С этого подключения сегодня уже запускали много бесплатных анализов. Попробуйте завтра или войдите в аккаунт.',
        'Many free analyses were already started from this connection today. Try tomorrow or sign in.',
      ),
      disposable_email: text(
        language,
        'Бесплатный анализ недоступен для временных почтовых адресов.',
        'The free analysis is not available for temporary email addresses.',
      ),
      budget_exhausted: text(
        language,
        'Бесплатные анализы на сегодня закончились — их число в сутки ограничено.',
        'Free analyses for today have run out — their number per day is limited.',
      ),
    };
    return {
      ok: false,
      status: 409,
      code: 'free_unavailable',
      message: messages[reason],
      details: {
        reason,
        resetsAt: this.resetsAt(),
        loginRequired: caller.guest,
        paid: {
          model: realModelName(
            stagePolicy('paid', 'context', language, this.registry).modelId,
            this.registry,
          ),
          typicalCredits: paid.typicalCredits,
          maxCredits: paid.maxCredits,
        },
      },
    };
  }

  async create(input: {
    caller: DiscoveryCaller;
    email: string | null;
    text: string;
    language: Language;
    mode?: AnalysisMode;
    confirm?: boolean;
    idempotencyKey: string | null;
  }): Promise<Ok<{ analysis: Analysis; duplicate: boolean }> | ServiceError> {
    const { caller, language } = input;
    const now = this.now();
    const day = this.today();
    await this.deps.budget.expire(now.toISOString());

    if (input.idempotencyKey) {
      const existing = await this.findByIdempotencyKey(caller.userId, input.idempotencyKey);
      if (existing) return { ok: true, analysis: existing, duplicate: true };
    }

    const today = await this.deps.store.count({ ownerId: caller.userId, budgetDay: day });
    if (today >= ANALYSES_PER_OWNER_PER_DAY) {
      return {
        ok: false,
        status: 429,
        code: 'analysis_limit',
        message: text(
          language,
          `Сегодня запущено ${ANALYSES_PER_OWNER_PER_DAY} анализов — это предел на сутки.`,
          `${ANALYSES_PER_OWNER_PER_DAY} analyses were started today — that is the daily maximum.`,
        ),
        details: { resetsAt: this.resetsAt() },
      };
    }

    const mode: AnalysisMode = input.mode ?? 'free';
    const id = randomUUID();
    let reservations: ReservationRequest[] = [];

    if (mode === 'free') {
      const availability = await this.freeAvailability(caller, input.email);
      if (!availability.ok) return this.freeUnavailable(availability.reason, caller, language);
      reservations = this.freeReservationCaps(language).map((item) => ({
        id: `${id}:${item.stage}:1`,
        analysisId: id,
        stage: item.stage,
        capUsd: item.capUsd,
        expiresAt: new Date(
          now.getTime() + (item.stage === 'context' ? RUNNING_MS : HOLD_MS),
        ).toISOString(),
      }));
      const reserved = await this.deps.budget.reserve(day, this.deps.freeDailyUsd, reservations);
      if (!reserved) return this.freeUnavailable('budget_exhausted', caller, language);
    } else {
      const check = this.checkPaid(caller, mode, ANALYSIS_STAGES, language, input.confirm);
      if (!check.ok) return check;
    }

    const stages: Analysis['stages'] = {};
    for (const stage of STAGE_ORDER) {
      const reservation = reservations.find((item) => item.stage === stage);
      stages[stage] = {
        status: 'pending',
        taskId: `${id}:${stage}:1`,
        costUsd: 0,
        creditsUsd: 0,
        attempts: 0,
        ...(reservation ? { reservationId: reservation.id } : {}),
      };
    }
    const planReservation = reservations.find((item) => item.stage === 'plan');
    if (planReservation) {
      stages.plan = {
        status: 'pending',
        taskId: `${id}:plan:1`,
        costUsd: 0,
        creditsUsd: 0,
        attempts: 0,
        reservationId: planReservation.id,
      };
    }

    const iso = now.toISOString();
    const created = await this.deps.store.create({
      id,
      ownerId: caller.userId,
      guest: caller.guest,
      ipHash: caller.ipHash,
      ipLimited: caller.ipLimited,
      mode,
      language,
      status: 'analyzing',
      inputText: input.text,
      context: null,
      questions: [],
      answers: {},
      summary: null,
      stages,
      budgetDay: day,
      idempotencyKey: input.idempotencyKey,
      createdAt: iso,
      updatedAt: iso,
      version: 1,
    });
    if (created.duplicate) {
      // Гонка двух запросов с одним ключом: второй вернул первый анализ, свои резервы возвращает.
      for (const reservation of reservations) await this.deps.budget.release(reservation.id);
      return { ok: true, analysis: created.analysis, duplicate: true };
    }
    this.schedule(caller, created.analysis.id, 'context');
    return { ok: true, analysis: created.analysis, duplicate: false };
  }

  private checkPaid(
    caller: DiscoveryCaller,
    mode: AnalysisMode,
    stages: readonly StageName[],
    language: Language,
    confirm: boolean | undefined,
  ): { ok: true } | ServiceError {
    if (caller.guest) {
      return {
        ok: false,
        status: 401,
        code: 'login_required',
        message: text(
          language,
          'Анализ за кредиты доступен после входа в аккаунт.',
          'Analysis for credits is available after signing in.',
        ),
      };
    }
    const estimate = estimateStages(mode, stages, language, this.registry);
    const balance = this.deps.balanceUsd(caller.userId, caller.plan);
    if (balance < estimate.maxUsd) {
      return {
        ok: false,
        status: 402,
        code: 'insufficient_credits',
        message: text(
          language,
          `Нужно до ${estimate.maxCredits} кредитов, на балансе ${toCredits(balance)}. Пополните баланс, чтобы запустить анализ.`,
          `Up to ${estimate.maxCredits} credits are needed, the balance is ${toCredits(balance)}. Top up to run the analysis.`,
        ),
        details: {
          typicalCredits: estimate.typicalCredits,
          maxCredits: estimate.maxCredits,
          balanceCredits: toCredits(balance),
        },
      };
    }
    if (estimate.maxCredits > CONFIRM_ABOVE_CREDITS && !confirm) {
      return {
        ok: false,
        status: 409,
        code: 'confirmation_required',
        message: text(
          language,
          `Это может стоить до ${estimate.maxCredits} кредитов (обычно ≈ ${estimate.typicalCredits}). Подтвердите запуск.`,
          `This may cost up to ${estimate.maxCredits} credits (usually ≈ ${estimate.typicalCredits}). Confirm to start.`,
        ),
        details: { typicalCredits: estimate.typicalCredits, maxCredits: estimate.maxCredits },
      };
    }
    return { ok: true };
  }

  private async findByIdempotencyKey(ownerId: string, key: string): Promise<Analysis | null> {
    const recent = await this.deps.store.list(ownerId, ANALYSES_PER_OWNER_PER_DAY * 3);
    return recent.find((item) => item.idempotencyKey === key) ?? null;
  }

  /** Анализ владельца; этап, зависший дольше `RUNNING_MS` (сервер перезапустился), считается прерванным. */
  async get(
    ownerId: string,
    id: string,
  ): Promise<{ analysis: Analysis; opportunities: Opportunity[] } | null> {
    let analysis = await this.deps.store.get(ownerId, id);
    if (!analysis) return null;
    if (!this.running.has(id)) {
      const stuck = STAGE_ORDER.find((stage) => {
        const run = analysis?.stages[stage];
        return (
          run?.status === 'running' &&
          run.startedAt !== undefined &&
          this.now().getTime() - Date.parse(run.startedAt) > RUNNING_MS
        );
      });
      if (stuck) {
        analysis =
          (await this.mutate(ownerId, id, (current) => {
            const run = current.stages[stuck];
            if (!run || run.status !== 'running') return current;
            return {
              ...current,
              status: 'failed',
              stages: {
                ...current.stages,
                [stuck]: {
                  ...run,
                  status: 'failed',
                  finishedAt: this.now().toISOString(),
                  error: {
                    code: 'interrupted',
                    message: text(
                      current.language,
                      'Этап прервался. Повторите его.',
                      'The step was interrupted. Retry it.',
                    ),
                  },
                },
              },
            };
          })) ?? analysis;
      }
    }
    const opportunities = await this.deps.store.opportunities(ownerId, id);
    return { analysis, opportunities };
  }

  list(ownerId: string, limit = 50): Promise<Analysis[]> {
    return this.deps.store.list(ownerId, limit);
  }

  claimGuest(userId: string, guestId: string | null, id: string): Promise<boolean> {
    if (!guestId) return Promise.resolve(false);
    return this.deps.store.claimGuest(userId, guestId, id);
  }

  /** Ответы на вопросы и запуск поиска возможностей. Повтор после старта ничего не запускает. */
  async continue(
    caller: DiscoveryCaller,
    id: string,
    body: AnswersBody,
  ): Promise<Ok<{ analysis: Analysis }> | ServiceError> {
    const current = await this.deps.store.get(caller.userId, id);
    if (!current) return notFound(id);
    if (current.status === 'discovering' || current.status === 'ready') {
      return { ok: true, analysis: current };
    }
    if (current.status !== 'needs_answers') {
      return {
        ok: false,
        status: 409,
        code: 'analysis_not_waiting',
        message: text(
          current.language,
          'Анализ сейчас не ждёт ответов.',
          'The analysis is not waiting for answers now.',
        ),
      };
    }
    const answers: Record<string, AnswerRecord> = {};
    for (const question of current.questions) {
      const given = body.answers[question.id];
      if (given && 'value' in given) answers[question.id] = { value: given.value };
      else if (question.optional || (given && 'skipped' in given))
        answers[question.id] = { skipped: true };
    }
    const missing = current.questions.filter(
      (question) => !question.optional && !answers[question.id],
    );
    if (missing.length > 0) {
      return {
        ok: false,
        status: 400,
        code: 'answers_required',
        message: text(
          current.language,
          'Ответьте на обязательные вопросы или пропустите их явно.',
          'Answer the required questions or skip them explicitly.',
        ),
        details: { questionIds: missing.map((question) => question.id) },
      };
    }
    // Бесплатный анализ: резерв поиска возможностей держится 2 часа. Если пользователь вернулся
    // позже и резерв уже вернулся в бюджет — берём новый или честно говорим, что бюджет исчерпан.
    let discoveryReservation = current.stages.discovery?.reservationId;
    if (current.mode === 'free') {
      await this.deps.budget.expire(this.now().toISOString());
      const held = (await this.deps.budget.forAnalysis(id)).find(
        (item) => item.id === discoveryReservation && item.status === 'held',
      );
      if (!held) {
        discoveryReservation = `${id}:discovery:${randomUUID().slice(0, 8)}`;
        const reserved = await this.deps.budget.reserve(this.today(), this.deps.freeDailyUsd, [
          {
            id: discoveryReservation,
            analysisId: id,
            stage: 'discovery',
            capUsd: stagePolicy('free', 'discovery', current.language, this.registry).capUsd,
            expiresAt: new Date(this.now().getTime() + RUNNING_MS).toISOString(),
          },
        ]);
        if (!reserved) return this.freeUnavailable('budget_exhausted', caller, current.language);
      }
    }
    const updated = await this.mutate(caller.userId, id, (analysis) =>
      analysis.status === 'needs_answers'
        ? {
            ...analysis,
            answers,
            status: 'discovering',
            stages: {
              ...analysis.stages,
              ...(analysis.stages.discovery && discoveryReservation
                ? {
                    discovery: {
                      ...analysis.stages.discovery,
                      reservationId: discoveryReservation,
                    },
                  }
                : {}),
            },
          }
        : analysis,
    );
    if (!updated) return notFound(id);
    if (updated.status === 'discovering' && updated.stages.discovery?.status === 'pending') {
      this.schedule(caller, id, 'discovery');
    }
    return { ok: true, analysis: updated };
  }

  /** Повтор упавшего этапа: бесплатный — с новым резервом бюджета, платный — с проверкой баланса. */
  async retry(
    caller: DiscoveryCaller,
    id: string,
    confirm?: boolean,
  ): Promise<Ok<{ analysis: Analysis }> | ServiceError> {
    const current = await this.deps.store.get(caller.userId, id);
    if (!current) return notFound(id);
    if (current.status !== 'failed') return { ok: true, analysis: current };
    const stage = STAGE_ORDER.find((name) => current.stages[name]?.status === 'failed');
    if (!stage) return { ok: true, analysis: current };
    const previous = current.stages[stage] as StageRun;
    const attemptNo = Number(previous.taskId.split(':').at(-1) ?? '1') + 1;
    let reservationId: string | undefined;

    if (current.mode === 'free') {
      const capUsd = stagePolicy('free', stage, current.language, this.registry).capUsd;
      reservationId = `${id}:${stage}:${attemptNo}`;
      const reserved = await this.deps.budget.reserve(this.today(), this.deps.freeDailyUsd, [
        {
          id: reservationId,
          analysisId: id,
          stage,
          capUsd,
          expiresAt: new Date(this.now().getTime() + RUNNING_MS).toISOString(),
        },
      ]);
      if (!reserved) return this.freeUnavailable('budget_exhausted', caller, current.language);
    } else {
      const check = this.checkPaid(caller, current.mode, [stage], current.language, confirm);
      if (!check.ok) return check;
    }

    const updated = await this.mutate(caller.userId, id, (analysis) => ({
      ...analysis,
      status: stage === 'context' ? 'analyzing' : 'discovering',
      stages: {
        ...analysis.stages,
        [stage]: {
          status: 'pending',
          taskId: `${id}:${stage}:${attemptNo}`,
          costUsd: previous.costUsd,
          creditsUsd: previous.creditsUsd,
          attempts: previous.attempts,
          ...(reservationId ? { reservationId } : {}),
        },
      },
    }));
    if (!updated) return notFound(id);
    this.schedule(caller, id, stage);
    return { ok: true, analysis: updated };
  }

  /** Все этапы, запущенные в фоне, завершились (для тестов и остановки сервера). */
  async whenIdle(): Promise<void> {
    while (this.running.size > 0) await Promise.allSettled([...this.running.values()]);
  }

  private schedule(caller: DiscoveryCaller, id: string, stage: StageName): void {
    const job = this.runStage(caller, id, stage)
      .catch((error: unknown) => {
        console.error(`[discovery] ${id}: этап ${stage} упал`, error);
        return this.failStage(
          caller.userId,
          id,
          stage,
          {
            code: 'internal_error',
            message: text(
              'ru',
              'Внутренняя ошибка. Повторите этап.',
              'Internal error. Retry the step.',
            ),
          },
          0,
          0,
          0,
        );
      })
      .finally(() => {
        if (this.running.get(id) === job) this.running.delete(id);
      });
    this.running.set(id, job);
  }

  private async runStage(caller: DiscoveryCaller, id: string, stage: StageName): Promise<void> {
    const startedAt = this.now().toISOString();
    const started = await this.mutate(caller.userId, id, (analysis) => {
      const run = analysis.stages[stage];
      if (!run || run.status !== 'pending') return analysis;
      return {
        ...analysis,
        stages: { ...analysis.stages, [stage]: { ...run, status: 'running', startedAt } },
      };
    });
    const run = started?.stages[stage];
    if (!started || !run || run.status !== 'running' || run.startedAt !== startedAt) return;

    const sponsored = started.mode === 'free';
    if (sponsored && run.reservationId) {
      await this.deps.budget.start(
        run.reservationId,
        new Date(this.now().getTime() + RUNNING_MS).toISOString(),
      );
    }
    const policy = stagePolicy(started.mode, stage, started.language, this.registry);
    const common = {
      gateway: this.deps.gateway,
      caller,
      taskId: run.taskId,
      conversationId: `discovery:${id}`,
      billing: sponsored ? ('sponsored' as const) : ('user' as const),
      policy,
      language: started.language,
      ...(this.deps.providerTimeoutMs ? { providerTimeoutMs: this.deps.providerTimeoutMs } : {}),
    };

    if (stage === 'context') {
      const result = await runStructuredTask({
        ...common,
        systemPrompt: contextSystemPrompt(started.language),
        userMessage: contextUserMessage(started.inputText),
        schema: contextOutputSchema,
        templateOutput: contextTemplate(started.inputText, started.language),
      });
      if (sponsored && run.reservationId)
        await this.deps.budget.settle(run.reservationId, result.costUsd);
      if (!result.ok) {
        await this.failStage(
          caller.userId,
          id,
          stage,
          result,
          result.costUsd,
          result.creditsUsd,
          result.attempts.length,
        );
        return;
      }
      const context = verifyTaskNumbers(result.data, started.inputText);
      const questions = context.questions;
      const after = await this.mutate(caller.userId, id, (analysis) => ({
        ...analysis,
        context,
        questions,
        status: questions.length > 0 ? 'needs_answers' : 'discovering',
        stages: {
          ...analysis.stages,
          context: {
            ...(analysis.stages.context as StageRun),
            status: 'done',
            model: { id: result.model.id, name: realModelName(result.model.id, this.registry) },
            costUsd: round6((analysis.stages.context?.costUsd ?? 0) + result.costUsd),
            creditsUsd: round6((analysis.stages.context?.creditsUsd ?? 0) + result.creditsUsd),
            attempts: (analysis.stages.context?.attempts ?? 0) + result.attempts.length,
            finishedAt: this.now().toISOString(),
          },
        },
      }));
      // Вопросов нет — поиск возможностей сразу, в той же фоновой задаче.
      if (after?.status === 'discovering') await this.runStage(caller, id, 'discovery');
      return;
    }

    if (stage === 'discovery') {
      const context = started.context as ContextOutput;
      const answers = started.questions.map((question) => {
        const answer = started.answers[question.id];
        return { question, value: answer && 'value' in answer ? answer.value : null };
      });
      const result = await runStructuredTask({
        ...common,
        systemPrompt: discoverySystemPrompt(started.language),
        userMessage: discoveryUserMessage(started.language, context, answers),
        schema: discoveryOutputSchema,
        templateOutput: discoveryTemplate(started.language),
      });
      if (sponsored && run.reservationId)
        await this.deps.budget.settle(run.reservationId, result.costUsd);
      if (!result.ok) {
        await this.failStage(
          caller.userId,
          id,
          stage,
          result,
          result.costUsd,
          result.creditsUsd,
          result.attempts.length,
        );
        return;
      }
      const opportunities = this.buildOpportunities(started, context, result.data, caller);
      await this.deps.store.setOpportunities(caller.userId, id, opportunities);
      await this.mutate(caller.userId, id, (analysis) => ({
        ...analysis,
        summary: result.data.summary,
        status: 'ready',
        stages: {
          ...analysis.stages,
          discovery: {
            ...(analysis.stages.discovery as StageRun),
            status: 'done',
            model: { id: result.model.id, name: realModelName(result.model.id, this.registry) },
            costUsd: round6((analysis.stages.discovery?.costUsd ?? 0) + result.costUsd),
            creditsUsd: round6((analysis.stages.discovery?.creditsUsd ?? 0) + result.creditsUsd),
            attempts: (analysis.stages.discovery?.attempts ?? 0) + result.attempts.length,
            finishedAt: this.now().toISOString(),
          },
        },
      }));
    }
  }

  private buildOpportunities(
    analysis: Analysis,
    context: ContextOutput,
    output: DiscoveryOutput,
    caller: DiscoveryCaller,
  ): Opportunity[] {
    const user = this.deps.userCapabilities(caller);
    const createdAt = this.now().toISOString();
    const effortRank = { low: 0, medium: 1, high: 2 } as const;
    const built = output.opportunities.map((item, position): Opportunity => {
      const feasibility = assessFeasibility(
        item.requires,
        user,
        analysis.language,
        item.otherRequirement,
      );
      return {
        id: randomUUID(),
        analysisId: analysis.id,
        ownerId: analysis.ownerId,
        position,
        title: item.title,
        problem: item.problem,
        solution: item.solution,
        requires: item.requires,
        otherRequirement: item.otherRequirement ?? null,
        dataNeeded: item.dataNeeded,
        integrationsNeeded: item.integrationsNeeded,
        effort: item.effort,
        effortReason: item.effortReason,
        risks: item.risks,
        limitations: item.limitations,
        successCriteria: item.successCriteria,
        firstStep: item.firstStep,
        feasibilityStatus: feasibility.status,
        feasibility,
        impact: estimateImpact(item, context, analysis.language),
        priority: 0,
        createdAt,
      };
    });
    // Порядок отчёта: что можно сделать сейчас, затем по оценке пользы, затем по сложности, затем
    // по порядку модели.
    const hours = (item: Opportunity) =>
      item.impact.kind === 'estimate' ? item.impact.hoursPerWeek[1] : 0;
    const ranked = [...built].sort(
      (a, b) =>
        feasibilityRank(a.feasibilityStatus) - feasibilityRank(b.feasibilityStatus) ||
        hours(b) - hours(a) ||
        effortRank[a.effort] - effortRank[b.effort] ||
        a.position - b.position,
    );
    ranked.forEach((item, index) => {
      item.priority = index;
    });
    return built;
  }

  private async failStage(
    ownerId: string,
    id: string,
    stage: StageName,
    error: { code: string; message: string },
    costUsd: number,
    creditsUsd: number,
    attempts: number,
  ): Promise<void> {
    await this.mutate(ownerId, id, (analysis) => {
      const run = analysis.stages[stage];
      if (!run) return analysis;
      return {
        ...analysis,
        status: 'failed',
        stages: {
          ...analysis.stages,
          [stage]: {
            ...run,
            status: 'failed',
            costUsd: round6(run.costUsd + costUsd),
            creditsUsd: round6(run.creditsUsd + creditsUsd),
            attempts: run.attempts + attempts,
            error: { code: error.code, message: error.message },
            finishedAt: this.now().toISOString(),
          },
        },
      };
    });
  }

  /** Изменение с проверкой версии: при одновременной записи читаем заново и применяем ещё раз. */
  private async mutate(
    ownerId: string,
    id: string,
    change: (analysis: Analysis) => Analysis,
  ): Promise<Analysis | null> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const current = await this.deps.store.get(ownerId, id);
      if (!current) return null;
      const next = change(current);
      if (next === current) return current;
      const saved = await this.deps.store.update(
        { ...next, updatedAt: this.now().toISOString() },
        current.version,
      );
      if (saved) return saved;
    }
    throw new Error(`discovery: не удалось сохранить анализ ${id} — запись постоянно меняется`);
  }
}

function notFound(id: string): ServiceError {
  return { ok: false, status: 404, code: 'analysis_not_found', message: `Анализ ${id} не найден` };
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/** Цена анализа для ответа API: списано с кредитов и (для бесплатного) — без списания. */
export function chargedCredits(analysis: Analysis): number {
  const usd = Object.values(analysis.stages).reduce((sum, run) => sum + (run?.creditsUsd ?? 0), 0);
  return Math.round(usd * CREDITS_PER_USD * 10) / 10;
}
