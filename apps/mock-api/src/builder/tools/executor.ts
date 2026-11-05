/**
 * Исполнитель операций инструментов — один на все инструменты и операции.
 *
 * Деньги:
 *   - цена считается до запуска по настоящему запросу (промпт + выбранные материалы + потолок ответа,
 *     все попытки) той же формулой, что у анализа и Builder (`callCost`);
 *   - запуск принимается, только если пользователь подтвердил эту цену (`acceptedMaxCredits` не
 *     меньше пересчитанного потолка; выше CONFIRM_ABOVE_CREDITS — ещё и `confirm`) и баланса хватает;
 *   - списывает только AI Gateway через существующий CreditService: по фактической цене провайдера,
 *     но не больше потолка на все попытки (`runStructuredTask` → `task.maxChargeUsd`);
 *   - ключ идемпотентности: повтор запроса возвращает тот же запуск, второго списания нет;
 *   - в инструменте один идущий запуск, у пользователя — не больше `activeRunsPerUser`.
 *
 * Надёжность: запуск идёт в этом процессе, его состояние — в базе с арендой. Процесс
 * перезапустился — запуск с истёкшей арендой закрывается как прерванный, а списанное за уже
 * завершённые вызовы модели берётся из учёта шлюза (`runId` = id запуска) и показывается честно.
 */
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AIGateway } from '../../ai/gateway.js';
import { modelRegistry, type ModelRegistry } from '../../ai/model-registry.js';
import {
  callCost,
  CONFIRM_ABOVE_CREDITS,
  STAGE_ATTEMPTS,
  toCreditRange,
} from '../../discovery/model-policy.js';
import { runStructuredTask, type TaskCaller } from '../../discovery/run-task.js';
import { realModelName } from '../../discovery/service.js';
import { PLATFORM_LIMITS } from '../../services/discovery-limits.js';
import { CREDITS_PER_USD, toCredits } from '../../services/entitlement.js';
import type { UsageStore } from '../../store/usage-store.js';
import type { Language } from '../../types.js';
import type { BuilderStore } from '../store.js';
import { getTemplate, KIND_BY_TYPE } from '../templates.js';
import type { Solution } from '../types.js';
import { getOperation } from './catalog.js';
import type { MaterialStore } from './material-store.js';
import type { SourceText, ToolOperation } from './operations.js';
import type { RunFinish, RunQuote, RunStore, ToolRun } from './run-store.js';

const LIMITS = PLATFORM_LIMITS.tools;

/** Ожидание в очереди до начала: дольше — запуск считается потерянным (процесс перезапустился). */
export const QUEUE_LEASE_MS = 2 * 60_000;
/** Таймаут ответа провайдера на попытку. */
export const RUN_PROVIDER_TIMEOUT_MS = 120_000;
/** Аренда идущего запуска: все попытки с таймаутом провайдера и запасом. */
export const RUN_LEASE_MS = STAGE_ATTEMPTS * RUN_PROVIDER_TIMEOUT_MS + 60_000;
export const RUN_HISTORY = 50;

export interface ToolCaller extends TaskCaller {
  language: Language;
}

export type ToolError = {
  ok: false;
  status: number;
  code: string;
  message: string;
  details?: Record<string, unknown>;
};

export interface ToolExecutorDeps {
  runs: RunStore;
  materials: MaterialStore;
  solutions: Pick<BuilderStore, 'getSolution'>;
  gateway: Pick<AIGateway, 'stream'>;
  /** Остаток кредитов пользователя, $. */
  balanceUsd: (userId: string, plan: TaskCaller['plan']) => number;
  /** Учёт шлюза: списанное за вызовы прерванного запуска. */
  usage: Pick<UsageStore, 'getRunRecords'>;
  registry?: ModelRegistry;
  now?: () => Date;
  providerTimeoutMs?: number;
}

export interface StartInput {
  operation: string;
  input: unknown;
  idempotencyKey: string;
  /** Потолок, который пользователь видел и подтвердил, кредиты. */
  acceptedMaxCredits: number;
  confirm?: boolean;
}

interface Prepared {
  solution: Solution;
  operation: ToolOperation;
  input: unknown;
  sources: SourceText[];
  systemPrompt: string;
  userMessage: string;
  quote: RunQuote;
}

const text = (language: Language, ru: string, en: string) => (language === 'en' ? en : ru);
const round6 = (value: number) => Math.round(value * 1e6) / 1e6;

/** Списано в кредитах для показа: с одним знаком после запятой. */
export const creditsOf = (usd: number) => Math.round(usd * CREDITS_PER_USD * 10) / 10;

function hashInput(operation: string, input: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify([operation, input]))
    .digest('hex');
}

/** Понятная пользователю ошибка запуска вместо служебного кода. */
function runError(language: Language, code: string): { code: string; message: string } {
  const messages: Record<string, { ru: string; en: string }> = {
    model_output_invalid: {
      ru: 'Модель дважды ответила не в том формате. Запустите ещё раз.',
      en: 'The model replied in the wrong format twice. Run it again.',
    },
    insufficient_credits: {
      ru: 'Кредитов не хватило на запуск. Пополните баланс.',
      en: 'Not enough credits for the run. Top up.',
    },
    model_unavailable: {
      ru: 'Модель сейчас недоступна. Попробуйте позже.',
      en: 'The model is unavailable right now. Try later.',
    },
    material_missing: {
      ru: 'Документ удалили до начала запуска. Кредиты не списаны.',
      en: 'The document was deleted before the run started. No credits were charged.',
    },
    interrupted: {
      ru: 'Запуск прервался: сервер перезапускался. Запустите ещё раз.',
      en: 'The run was interrupted by a server restart. Run it again.',
    },
  };
  const message = messages[code] ?? {
    ru: 'Запуск не удался. Попробуйте ещё раз.',
    en: 'The run failed. Try again.',
  };
  return { code, message: text(language, message.ru, message.en) };
}

export class ToolExecutor {
  private readonly registry: ModelRegistry;
  private readonly now: () => Date;
  /** Запуски, которые идут в этом процессе: их аренду не закрывают как прерванную. */
  private readonly running = new Map<string, Promise<void>>();

  constructor(private readonly deps: ToolExecutorDeps) {
    this.registry = deps.registry ?? modelRegistry;
    this.now = deps.now ?? (() => new Date());
  }

  async whenIdle(): Promise<void> {
    while (this.running.size > 0) await Promise.allSettled([...this.running.values()]);
  }

  private fail(
    status: number,
    code: string,
    language: Language,
    ru: string,
    en: string,
    details?: Record<string, unknown>,
  ): ToolError {
    return {
      ok: false,
      status,
      code,
      message: text(language, ru, en),
      ...(details ? { details } : {}),
    };
  }

  private async tool(caller: ToolCaller, solutionId: string): Promise<Solution | ToolError> {
    const solution = await this.deps.solutions.getSolution(caller.userId, solutionId);
    if (!solution) {
      return this.fail(
        404,
        'not_found',
        caller.language,
        'Решение не найдено.',
        'Solution not found.',
      );
    }
    if (KIND_BY_TYPE[solution.type] !== 'tool' || !getTemplate(solution.template)) {
      return this.fail(
        409,
        'wrong_solution_kind',
        caller.language,
        'У этого решения нет операций инструмента.',
        'This solution has no tool operations.',
      );
    }
    return solution;
  }

  /** Источники запуска: выбранные части документов под короткими ref по порядку. */
  private async sourcesOf(
    caller: ToolCaller,
    solutionId: string,
    selections: ReadonlyArray<{ id: string; sections?: string[] }>,
  ): Promise<SourceText[] | ToolError> {
    const sources: SourceText[] = [];
    for (const selection of selections) {
      const material = await this.deps.materials.get(caller.userId, solutionId, selection.id);
      if (!material) {
        return this.fail(
          404,
          'material_not_found',
          caller.language,
          'Документ не найден: возможно, его удалили.',
          'Document not found: it may have been deleted.',
        );
      }
      const wanted = selection.sections ? new Set(selection.sections) : null;
      if (wanted && [...wanted].some((id) => !material.sections.some((s) => s.id === id))) {
        return this.fail(
          400,
          'section_not_found',
          caller.language,
          'Выбранной части нет в документе.',
          'The selected part is not in the document.',
        );
      }
      for (const section of material.sections) {
        if (wanted && !wanted.has(section.id)) continue;
        sources.push({
          ref: `S${sources.length + 1}`,
          materialId: material.id,
          materialName: material.name,
          sectionId: section.id,
          label: section.label,
          text: section.text,
        });
      }
    }
    return sources;
  }

  private async prepare(
    caller: ToolCaller,
    solutionId: string,
    operationId: string,
    rawInput: unknown,
  ): Promise<Prepared | ToolError> {
    const solution = await this.tool(caller, solutionId);
    if ('ok' in solution) return solution;
    const operation = getOperation(solution.template, operationId);
    if (!operation) {
      return this.fail(
        404,
        'unknown_operation',
        caller.language,
        'Такой операции у инструмента нет.',
        'The tool has no such operation.',
      );
    }
    const parsed = operation.inputSchema.safeParse(rawInput);
    if (!parsed.success) {
      return this.fail(
        400,
        'invalid_input',
        caller.language,
        'Проверьте предмет, пожелания и выбранные документы.',
        'Check the subject, wishes and selected documents.',
      );
    }
    const input = parsed.data;
    const sources = await this.sourcesOf(caller, solutionId, operation.materials(input));
    if (!Array.isArray(sources)) return sources;
    const inputChars = sources.reduce((sum, source) => sum + source.text.length, 0);
    if (inputChars > LIMITS.runChars) {
      return this.fail(
        413,
        'run_too_large',
        caller.language,
        `Выбрано ${inputChars} символов текста, за один запуск — не больше ${LIMITS.runChars}. Выберите меньше частей.`,
        `${inputChars} characters are selected; one run takes at most ${LIMITS.runChars}. Select fewer parts.`,
        { inputChars, maxChars: LIMITS.runChars },
      );
    }
    const systemPrompt = operation.systemPrompt(caller.language);
    const userMessage = operation.userMessage(input, sources, caller.language);
    const cost = callCost(
      operation.policy.modelId,
      {
        systemChars: systemPrompt.length,
        payloadChars: userMessage.length,
        maxOutputTokens: operation.policy.maxOutputTokens,
        attempts: STAGE_ATTEMPTS,
      },
      {
        // Типично: вход ≈ 3 символа на токен, ответ ≈ 60% потолка.
        inputTokens: Math.ceil((systemPrompt.length + userMessage.length) / 3),
        outputTokens: Math.ceil(operation.policy.maxOutputTokens * 0.6),
      },
      this.registry,
    );
    const credits = toCreditRange(cost.typicalUsd, cost.capUsd);
    return {
      solution,
      operation,
      input,
      sources,
      systemPrompt,
      userMessage,
      quote: {
        modelId: operation.policy.modelId,
        modelName: realModelName(operation.policy.modelId, this.registry),
        maxOutputTokens: cost.maxOutputTokens,
        inputChars,
        capUsd: cost.capUsd,
        typicalUsd: cost.typicalUsd,
        maxCredits: credits.maxCredits,
        typicalCredits: credits.typicalCredits,
      },
    };
  }

  /** Цена запуска до запуска: показывается на кнопке и подтверждается пользователем. */
  async quote(
    caller: ToolCaller,
    solutionId: string,
    operationId: string,
    input: unknown,
  ): Promise<{ ok: true; quote: PublicQuote } | ToolError> {
    const prepared = await this.prepare(caller, solutionId, operationId, input);
    if ('ok' in prepared) return prepared;
    return { ok: true, quote: publicQuote(prepared.quote) };
  }

  async start(
    caller: ToolCaller,
    solutionId: string,
    request: StartInput,
  ): Promise<{ ok: true; run: ToolRun; duplicate: boolean } | ToolError> {
    const language = caller.language;
    // Повтор того же запроса (сеть, двойной клик) — тот же запуск, без второго списания.
    const existing = await this.deps.runs.byKey(caller.userId, request.idempotencyKey);
    if (existing) {
      if (
        existing.solutionId !== solutionId ||
        existing.inputHash !== hashInput(request.operation, request.input)
      ) {
        return this.fail(
          409,
          'idempotency_conflict',
          language,
          'Этот ключ запроса уже использован для другого запуска.',
          'This request key was already used for another run.',
        );
      }
      return { ok: true, run: existing, duplicate: true };
    }

    const prepared = await this.prepare(caller, solutionId, request.operation, request.input);
    if ('ok' in prepared) return prepared;
    const quote = prepared.quote;
    const needsConfirm = quote.maxCredits > CONFIRM_ABOVE_CREDITS && request.confirm !== true;
    if (!(request.acceptedMaxCredits >= quote.maxCredits) || needsConfirm) {
      // Цену не видели, она выросла или нужна явная галочка: показать новую и не запускать.
      return this.fail(
        409,
        'confirmation_required',
        language,
        `Запуск: ≈ ${quote.typicalCredits}, не больше ${quote.maxCredits} кредитов. Подтвердите запуск.`,
        `Run: ≈ ${quote.typicalCredits}, at most ${quote.maxCredits} credits. Confirm to start.`,
        { quote: publicQuote(quote) },
      );
    }

    await this.expireStale(caller);
    const active = await this.deps.runs.active(caller.userId);
    if (active.length >= LIMITS.activeRunsPerUser) {
      return this.fail(
        429,
        'too_many_runs',
        language,
        `Одновременно идёт не больше ${LIMITS.activeRunsPerUser} запусков. Дождитесь окончания.`,
        `At most ${LIMITS.activeRunsPerUser} runs at a time. Wait for one to finish.`,
      );
    }
    const balance = this.deps.balanceUsd(caller.userId, caller.plan);
    if (balance < quote.capUsd) {
      return this.fail(
        402,
        'insufficient_credits',
        language,
        `Нужно до ${quote.maxCredits} кредитов, на балансе ${toCredits(balance)}. Пополните баланс.`,
        `Up to ${quote.maxCredits} credits are needed, the balance is ${toCredits(balance)}. Top up.`,
        { maxCredits: quote.maxCredits, balanceCredits: toCredits(balance) },
      );
    }

    const now = this.now();
    const run: ToolRun = {
      id: randomUUID(),
      solutionId,
      ownerId: caller.userId,
      operation: prepared.operation.id,
      status: 'queued',
      versionNumber: prepared.solution.currentVersion,
      input: prepared.input,
      inputHash: hashInput(request.operation, request.input),
      sources: prepared.sources.map(({ text: _text, ...source }) => source),
      quote,
      result: null,
      resultSchema: 1,
      model: null,
      costUsd: 0,
      creditsUsd: 0,
      error: null,
      idempotencyKey: request.idempotencyKey,
      claimToken: null,
      leaseExpiresAt: new Date(now.getTime() + QUEUE_LEASE_MS).toISOString(),
      createdAt: now.toISOString(),
      startedAt: null,
      finishedAt: null,
    };
    const inserted = await this.deps.runs.insert(run);
    if (inserted.status === 'duplicate') {
      return { ok: true, run: inserted.run, duplicate: true };
    }
    if (inserted.status === 'busy') {
      return this.fail(
        409,
        'run_in_progress',
        language,
        'В этом инструменте уже идёт запуск. Дождитесь его окончания.',
        'A run is already in progress in this tool. Wait for it to finish.',
        inserted.run ? { runId: inserted.run.id } : undefined,
      );
    }
    if (inserted.status === 'not_found') {
      return this.fail(404, 'not_found', language, 'Решение не найдено.', 'Solution not found.');
    }
    this.schedule(caller, inserted.run);
    return { ok: true, run: inserted.run, duplicate: false };
  }

  private schedule(caller: ToolCaller, run: ToolRun): void {
    const job = this.execute(caller, run)
      .catch((error: unknown) => {
        console.error(`[tools] запуск ${run.id} упал`, error);
      })
      .finally(() => {
        if (this.running.get(run.id) === job) this.running.delete(run.id);
      });
    this.running.set(run.id, job);
  }

  private async execute(caller: ToolCaller, queued: ToolRun): Promise<void> {
    const token = randomUUID();
    const startedAt = this.now();
    const run = await this.deps.runs.claim(
      caller.userId,
      queued.id,
      token,
      new Date(startedAt.getTime() + RUN_LEASE_MS).toISOString(),
      startedAt.toISOString(),
    );
    if (!run) return;
    const finish = (outcome: Omit<RunFinish, 'finishedAt'>) =>
      this.deps.runs.finish(caller.userId, run.id, token, {
        ...outcome,
        finishedAt: this.now().toISOString(),
      });

    try {
      const solution = await this.deps.solutions.getSolution(caller.userId, run.solutionId);
      const operation = solution ? getOperation(solution.template, run.operation) : null;
      // Текст — заново из материалов: в запуске хранятся только ссылки на части.
      const sources: SourceText[] = [];
      for (const source of run.sources) {
        const material = await this.deps.materials.get(
          caller.userId,
          run.solutionId,
          source.materialId,
        );
        const section = material?.sections.find((item) => item.id === source.sectionId);
        if (!section) break;
        sources.push({ ...source, text: section.text });
      }
      if (!operation || sources.length !== run.sources.length) {
        await finish({
          status: 'failed',
          result: null,
          model: null,
          costUsd: 0,
          creditsUsd: 0,
          error: runError(caller.language, 'material_missing'),
        });
        return;
      }
      const refs = new Set(sources.map((source) => source.ref));
      const result = await runStructuredTask({
        gateway: this.deps.gateway,
        caller,
        taskId: run.id,
        conversationId: `tool:${run.solutionId}`,
        billing: 'user',
        kind: 'tool',
        policy: {
          modelId: run.quote.modelId,
          maxOutputTokens: run.quote.maxOutputTokens,
          reasoningEffort: operation.policy.reasoningEffort,
          capUsd: run.quote.capUsd,
          typicalUsd: run.quote.typicalUsd,
        },
        language: caller.language,
        systemPrompt: operation.systemPrompt(caller.language),
        userMessage: operation.userMessage(run.input, sources, caller.language),
        schema: operation.outputSchema(refs),
        templateOutput: operation.templateOutput(run.input, sources, caller.language),
        providerTimeoutMs: this.deps.providerTimeoutMs ?? RUN_PROVIDER_TIMEOUT_MS,
      });
      await finish(
        result.ok
          ? {
              status: 'done',
              result: result.data,
              model: { id: result.model.id, name: realModelName(result.model.id, this.registry) },
              costUsd: result.costUsd,
              creditsUsd: result.creditsUsd,
              error: null,
            }
          : {
              status: 'failed',
              result: null,
              model: null,
              costUsd: result.costUsd,
              creditsUsd: result.creditsUsd,
              error: runError(caller.language, result.code),
            },
      );
    } catch (error) {
      console.error(`[tools] запуск ${run.id}: внутренняя ошибка`, error);
      // Что успели списать до ошибки — из учёта шлюза, чтобы показать честно.
      const spent = this.spent(caller.userId, run.id);
      await finish({
        status: 'failed',
        result: null,
        model: null,
        ...spent,
        error: runError(caller.language, 'internal_error'),
      });
    }
  }

  /** Сколько стоили и сколько списали вызовы модели этого запуска (учёт шлюза по `runId`). */
  private spent(userId: string, runId: string): { costUsd: number; creditsUsd: number } {
    const records = this.deps.usage.getRunRecords(userId, runId);
    return {
      costUsd: round6(records.reduce((sum, record) => sum + (record.estimatedCost ?? 0), 0)),
      creditsUsd: round6(records.reduce((sum, record) => sum + (record.creditsUsd ?? 0), 0)),
    };
  }

  /** Запуски с истёкшей арендой, которые не идут в этом процессе, закрываются как прерванные. */
  private async expireStale(caller: ToolCaller): Promise<void> {
    const now = this.now().toISOString();
    for (const run of await this.deps.runs.active(caller.userId)) {
      if (run.leaseExpiresAt > now || this.running.has(run.id)) continue;
      await this.deps.runs.expire(caller.userId, run.id, now, {
        status: 'failed',
        result: null,
        model: null,
        ...this.spent(caller.userId, run.id),
        error: runError(caller.language, 'interrupted'),
        finishedAt: now,
      });
    }
  }

  async get(
    caller: ToolCaller,
    solutionId: string,
    runId: string,
  ): Promise<{ ok: true; run: ToolRun } | ToolError> {
    const solution = await this.tool(caller, solutionId);
    if ('ok' in solution) return solution;
    await this.expireStale(caller);
    const run = await this.deps.runs.get(caller.userId, solutionId, runId);
    if (!run) return this.missing(caller.language);
    return { ok: true, run };
  }

  async list(
    caller: ToolCaller,
    solutionId: string,
  ): Promise<{ ok: true; runs: ToolRun[] } | ToolError> {
    const solution = await this.tool(caller, solutionId);
    if ('ok' in solution) return solution;
    await this.expireStale(caller);
    return { ok: true, runs: await this.deps.runs.list(caller.userId, solutionId, RUN_HISTORY) };
  }

  async remove(
    caller: ToolCaller,
    solutionId: string,
    runId: string,
  ): Promise<{ ok: true } | ToolError> {
    const found = await this.get(caller, solutionId, runId);
    if (!found.ok) return found;
    if (found.run.status === 'queued' || found.run.status === 'running') {
      return this.fail(
        409,
        'run_in_progress',
        caller.language,
        'Запуск ещё идёт: удалить его можно после окончания.',
        'The run is still in progress: delete it after it finishes.',
      );
    }
    return (await this.deps.runs.remove(caller.userId, solutionId, runId))
      ? { ok: true }
      : this.missing(caller.language);
  }

  private missing(language: Language): ToolError {
    return this.fail(404, 'run_not_found', language, 'Запуск не найден.', 'Run not found.');
  }
}

export interface PublicQuote {
  model: string;
  typicalCredits: number;
  maxCredits: number;
  inputChars: number;
  maxInputChars: number;
  confirmationRequired: boolean;
}

export function publicQuote(quote: RunQuote): PublicQuote {
  return {
    model: quote.modelName,
    typicalCredits: quote.typicalCredits,
    maxCredits: quote.maxCredits,
    inputChars: quote.inputChars,
    maxInputChars: LIMITS.runChars,
    confirmationRequired: quote.maxCredits > CONFIRM_ABOVE_CREDITS,
  };
}

/** Запуск для сайта: без служебных полей (жетон, отпечаток, ключ, себестоимость). */
export function publicRun(run: ToolRun) {
  return {
    id: run.id,
    solutionId: run.solutionId,
    operation: run.operation,
    status: run.status,
    input: run.input,
    sources: run.sources,
    quote: publicQuote(run.quote),
    result: run.result,
    resultSchema: run.resultSchema,
    model: run.model,
    chargedCredits: creditsOf(run.creditsUsd),
    error: run.error,
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
  };
}

/** Строка истории: без результата целиком, только заголовок. */
export function runSummary(run: ToolRun) {
  const { result, input, sources: _sources, ...rest } = publicRun(run);
  const title =
    result &&
    typeof result === 'object' &&
    typeof (result as { title?: unknown }).title === 'string'
      ? (result as { title: string }).title
      : null;
  const subject =
    input &&
    typeof input === 'object' &&
    typeof (input as { subject?: unknown }).subject === 'string'
      ? (input as { subject: string }).subject
      : '';
  return { ...rest, title, subject };
}

// ─── Тела запросов ────────────────────────────────────────────────────────────

const operationId = z.string().regex(/^[a-z][a-z0-9_]{1,39}$/);

export const runQuoteBodySchema = z.object({ operation: operationId, input: z.unknown() }).strict();

export const runStartBodySchema = z
  .object({
    operation: operationId,
    input: z.unknown(),
    /** Ключ идемпотентности от сайта: один на одно нажатие «Запустить». */
    idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{8,100}$/),
    acceptedMaxCredits: z.number().finite().nonnegative(),
    confirm: z.boolean().optional(),
  })
  .strict();
