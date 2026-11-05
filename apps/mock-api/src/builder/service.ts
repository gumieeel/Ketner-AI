/**
 * Builder: персональный помощник — черновик из возможности анализа, настройки версиями,
 * тест-кейсы с проверкой моделью-судьёй, включение только после пройденных тестов, чат.
 *
 * Деньги — только через общий AI Gateway (кредиты пользователя, учёт по `runId`):
 * - черновик: один служебный вызов MiMo-V2.6 Pro, цена до запуска, согласие обязательно;
 * - тестовый прогон: ответ помощника (Auto, как в чате) и проверка судьёй на каждый кейс; цена
 *   до запуска, согласие обязательно, с пользователя — не больше потолка каждого вызова;
 * - чат помощника — как обычный чат: Auto выбирает модель, списание по реальной цене.
 * Builder доступен только после входа (решение владельца).
 */

import { createHash, randomUUID } from 'node:crypto';
import type { AIGateway } from '../ai/gateway.js';
import { AUTO_PREMIUM_MODEL_ID } from '../ai/auto-router.js';
import {
  DEFAULT_SYSTEM_PROMPT,
  ECONOMY_SYSTEM_PROMPT,
  modelRegistry,
  type ModelRegistry,
} from '../ai/model-registry.js';
import { callCost, toCreditRange, CONFIRM_ABOVE_CREDITS } from '../discovery/model-policy.js';
import { runStructuredTask, type TaskCaller } from '../discovery/run-task.js';
import { realModelName } from '../discovery/service.js';
import type { DiscoveryStore } from '../discovery/store.js';
import { PLATFORM_LIMITS } from '../services/discovery-limits.js';
import { toCredits } from '../services/entitlement.js';
import type { Language, PlanId } from '../types.js';
import {
  buildAssistantInstructions,
  DRAFT_PAYLOAD_CHARS,
  draftSystemPrompt,
  draftUserMessage,
  JUDGE_ANSWER_CHARS,
  judgeSystemPrompt,
  judgeUserMessage,
} from './prompt.js';
import {
  draftOutputSchema,
  judgeOutputSchema,
  LIMITS,
  type DraftOutput,
  type JudgeOutput,
} from './schemas.js';
import type { BuilderStore } from './store.js';
import { KIND_BY_TYPE, TEMPLATES } from './templates.js';
import {
  botDraftSystemPrompt,
  buildBotInstructions,
  parseBotReply,
  slugFromName,
} from './bot-prompt.js';
import type {
  AssistantConfig,
  BotSettings,
  Solution,
  SolutionVersion,
  TestCase,
  TestResult,
  TestRun,
  Verdict,
} from './types.js';
import { isToolConfig } from './types.js';

export interface BuilderCaller extends TaskCaller {
  language: Language;
}

export interface BuilderServiceDeps {
  store: BuilderStore;
  discovery: DiscoveryStore;
  gateway: Pick<AIGateway, 'stream'>;
  balanceUsd: (userId: string, plan: PlanId) => number;
  registry?: ModelRegistry;
  now?: () => Date;
}

export type BuilderError = {
  ok: false;
  status: number;
  code: string;
  message: string;
  details?: Record<string, unknown>;
};
type Ok<T> = { ok: true } & T;

/** Модель черновика и судьи: служебные задачи, без подмены модели. */
export const DRAFT_MODEL_ID = 'ketner-pro';
export const JUDGE_MODEL_ID = 'ketner-pro';
/** Потолок ответа помощника в тесте, токенов. */
export const TEST_ANSWER_TOKENS = 1500;
const DRAFT_OUTPUT_TOKENS = 4000;
const JUDGE_OUTPUT_TOKENS = 1200;
/** Сколько последних сообщений чата помощник видит. */
export const CHAT_HISTORY = 20;
/** Потолок расхода бота для клиентов в сутки по умолчанию, кредитов (≈ 300 ответов). */
export const DEFAULT_BOT_DAILY_CAP = 1000;

const text = (language: Language, ru: string, en: string) => (language === 'en' ? en : ru);
const round6 = (value: number) => Math.round(value * 1e6) / 1e6;

function chatPromptChars(): number {
  return Math.max(
    ...[...Object.values(DEFAULT_SYSTEM_PROMPT), ...Object.values(ECONOMY_SYSTEM_PROMPT)].map(
      (value) => value.length,
    ),
  );
}

/** Системный промпт ответа: помощник — правила чата + настройки, бот — только свой промпт. */
export function answerInstructions(config: AssistantConfig, bot: BotSettings | null) {
  return bot
    ? { instructions: buildBotInstructions(config, bot), replaceSystemPrompt: true }
    : { instructions: buildAssistantInstructions(config), replaceSystemPrompt: false };
}

function promptChars(config: AssistantConfig, bot: BotSettings | null): number {
  const { instructions, replaceSystemPrompt } = answerInstructions(config, bot);
  return (replaceSystemPrompt ? 0 : chatPromptChars()) + instructions.length;
}

export function defaultConfig(name: string, language: Language): AssistantConfig {
  return {
    name,
    purpose: '',
    instructions: '',
    tone: 'friendly',
    knowledge: '',
    examples: [],
    restrictions: [],
    language,
  };
}

/** Отпечаток набора кейсов: изменились кейсы — прошлый прогон больше не подтверждает версию. */
export function casesHash(cases: readonly TestCase[]): string {
  return createHash('sha256')
    .update(JSON.stringify(cases.map((item) => [item.id, item.input, item.criteria])))
    .digest('hex')
    .slice(0, 16);
}

/** Итоговый вердикт кейса: вердикт пользователя важнее вердикта судьи. */
export function effectiveVerdict(result: TestResult): Verdict | null {
  return result.manual ?? result.judge?.verdict ?? null;
}

/** Вердикт судьи: «прошёл», только если выполнен каждый критерий кейса. */
export function judgeVerdict(criteria: readonly string[], output: JudgeOutput): Verdict {
  if (output.criteria.length < criteria.length) return 'fail';
  return output.criteria.slice(0, criteria.length).every((item) => item.met) ? 'pass' : 'fail';
}

export type Readiness =
  | { ready: true }
  | {
      ready: false;
      reason: 'no_cases' | 'not_tested' | 'outdated' | 'running' | 'failed_cases';
      failed?: number;
    };

/** Можно ли включить текущую версию: все кейсы прошли на ней, кейсы с тех пор не менялись. */
export function readiness(
  solution: Solution,
  cases: readonly TestCase[],
  run: TestRun | null,
): Readiness {
  if (cases.length === 0) return { ready: false, reason: 'no_cases' };
  if (!run) return { ready: false, reason: 'not_tested' };
  if (run.status === 'running') return { ready: false, reason: 'running' };
  if (run.versionNumber !== solution.currentVersion || run.casesHash !== casesHash(cases))
    return { ready: false, reason: 'outdated' };
  const failed = run.results.filter((result) => effectiveVerdict(result) !== 'pass').length;
  return failed > 0 ? { ready: false, reason: 'failed_cases', failed } : { ready: true };
}

function sameConfig(a: AssistantConfig, b: AssistantConfig): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export class BuilderService {
  private readonly registry: ModelRegistry;
  private readonly now: () => Date;
  private readonly running = new Map<string, Promise<unknown>>();
  private readonly drafting = new Map<string, Promise<unknown>>();

  constructor(private readonly deps: BuilderServiceDeps) {
    this.registry = deps.registry ?? modelRegistry;
    this.now = deps.now ?? (() => new Date());
  }

  /** Все фоновые прогоны завершились (тесты, остановка). */
  async whenIdle(): Promise<void> {
    while (this.running.size > 0) await Promise.allSettled([...this.running.values()]);
  }

  // ─── Цены ──────────────────────────────────────────────────────────────────

  draftQuote(language: Language) {
    return draftQuote(language, this.registry);
  }

  /** Помощников у пользователя не больше лимита (services/discovery-limits.ts). */
  private async overLimit(caller: BuilderCaller): Promise<BuilderError | null> {
    const count = (await this.deps.store.listSolutions(caller.userId)).length;
    if (count < PLATFORM_LIMITS.assistants.perUser) return null;
    return {
      ok: false,
      status: 409,
      code: 'assistants_limit',
      message: text(
        caller.language,
        `Помощников может быть не больше ${PLATFORM_LIMITS.assistants.perUser}. Удалите ненужного, чтобы создать нового.`,
        `You can have at most ${PLATFORM_LIMITS.assistants.perUser} assistants. Delete one to create a new one.`,
      ),
    };
  }

  /** Потолок одного кейса: ответ помощника (худший случай Auto) и проверка судьёй. */
  private caseCaps(config: AssistantConfig, item: TestCase, bot: BotSettings | null) {
    const system = promptChars(config, bot);
    const answer = callCost(
      AUTO_PREMIUM_MODEL_ID,
      {
        systemChars: system,
        payloadChars: item.input.length,
        maxOutputTokens: TEST_ANSWER_TOKENS,
        attempts: 1,
      },
      {
        inputTokens: Math.ceil((system + item.input.length) / 3),
        outputTokens: 600,
      },
      this.registry,
    );
    // Типичный ответ — рабочая модель Auto, а не премиум.
    const typicalAnswer = callCost(
      DRAFT_MODEL_ID,
      { systemChars: 0, payloadChars: 0, maxOutputTokens: TEST_ANSWER_TOKENS, attempts: 1 },
      {
        inputTokens: Math.ceil((system + item.input.length) / 3),
        outputTokens: 600,
      },
      this.registry,
    ).typicalUsd;
    const judge = callCost(
      JUDGE_MODEL_ID,
      {
        systemChars: judgeSystemPrompt(config.language).length,
        payloadChars: item.input.length + item.criteria.join(' ').length + JUDGE_ANSWER_CHARS,
        maxOutputTokens: JUDGE_OUTPUT_TOKENS,
        attempts: 2,
      },
      { inputTokens: 1_500, outputTokens: 400 },
      this.registry,
    );
    return {
      answerCapUsd: answer.capUsd,
      judgeCapUsd: judge.capUsd,
      typicalUsd: typicalAnswer + judge.typicalUsd,
    };
  }

  testQuote(config: AssistantConfig, cases: readonly TestCase[], bot: BotSettings | null = null) {
    let capUsd = 0;
    let typicalUsd = 0;
    for (const item of cases) {
      const caps = this.caseCaps(config, item, bot);
      capUsd += caps.answerCapUsd + caps.judgeCapUsd;
      typicalUsd += caps.typicalUsd;
    }
    return {
      cases: cases.length,
      judgeModel: realModelName(JUDGE_MODEL_ID, this.registry),
      capUsd: round6(capUsd),
      ...toCreditRange(typicalUsd, capUsd),
    };
  }

  private insufficient(language: Language, maxCredits: number, balanceUsd: number): BuilderError {
    return {
      ok: false,
      status: 402,
      code: 'insufficient_credits',
      message: text(
        language,
        `Нужно до ${maxCredits} кредитов, на балансе ${toCredits(balanceUsd)}. Пополните баланс.`,
        `Up to ${maxCredits} credits are needed, the balance is ${toCredits(balanceUsd)}. Top up.`,
      ),
      details: { maxCredits, balanceCredits: toCredits(balanceUsd) },
    };
  }

  private confirmation(
    language: Language,
    what: { ru: string; en: string },
    quote: { typicalCredits: number; maxCredits: number },
    extra: Record<string, unknown> = {},
  ): BuilderError {
    return {
      ok: false,
      status: 409,
      code: 'confirmation_required',
      message: text(
        language,
        `${what.ru}: ≈ ${quote.typicalCredits}, не больше ${quote.maxCredits} кредитов. Подтвердите запуск.`,
        `${what.en}: ≈ ${quote.typicalCredits}, at most ${quote.maxCredits} credits. Confirm to start.`,
      ),
      details: { typicalCredits: quote.typicalCredits, maxCredits: quote.maxCredits, ...extra },
    };
  }

  // ─── Создание ──────────────────────────────────────────────────────────────

  async createBlank(
    caller: BuilderCaller,
    name: string,
  ): Promise<Ok<{ solution: Solution }> | BuilderError> {
    const limit = await this.overLimit(caller);
    if (limit) return limit;
    const id = randomUUID();
    const iso = this.now().toISOString();
    const template = TEMPLATES.personal_assistant;
    const solution: Solution = {
      id,
      ownerId: caller.userId,
      type: template.storageType,
      template: template.id,
      bot: null,
      status: 'draft',
      name,
      currentVersion: 1,
      activeVersion: null,
      source: null,
      createdAt: iso,
      updatedAt: iso,
      version: 1,
    };
    await this.deps.store.createSolution(
      solution,
      { solutionId: id, number: 1, config: defaultConfig(name, caller.language), createdAt: iso },
      [],
    );
    return { ok: true, solution };
  }

  /**
   * Черновик помощника из возможности анализа: модель предлагает настройки и тест-кейсы.
   * Из одной возможности — один помощник: повторный запрос возвращает уже созданного.
   */
  async createFromOpportunity(
    caller: BuilderCaller,
    input: { analysisId: string; opportunityId: string; confirm?: boolean },
  ): Promise<Ok<{ solution: Solution; created: boolean }> | BuilderError> {
    const language = caller.language;
    const analysis = await this.deps.discovery.get(caller.userId, input.analysisId);
    const opportunity = analysis
      ? (await this.deps.discovery.opportunities(caller.userId, input.analysisId)).find(
          (item) => item.id === input.opportunityId,
        )
      : undefined;
    if (!analysis || !opportunity) {
      return {
        ok: false,
        status: 404,
        code: 'opportunity_not_found',
        message: text(language, 'Возможность не найдена.', 'Opportunity not found.'),
      };
    }
    if (opportunity.feasibilityStatus === 'not_supported') {
      return {
        ok: false,
        status: 409,
        code: 'opportunity_not_supported',
        message: text(
          language,
          'Ketner пока не умеет этого, поэтому решение здесь не создаётся.',
          'Ketner cannot do this yet, so no solution is created here.',
        ),
      };
    }
    const existing = (await this.deps.store.listSolutions(caller.userId)).find(
      (item) => item.source?.opportunityId === opportunity.id,
    );
    if (existing) return { ok: true, solution: existing, created: false };
    const limit = await this.overLimit(caller);
    if (limit) return limit;

    const quote = this.draftQuote(language);
    if (!input.confirm) {
      return this.confirmation(
        language,
        { ru: 'Черновик помощника', en: 'Assistant draft' },
        quote,
        { model: quote.model },
      );
    }
    const balance = this.deps.balanceUsd(caller.userId, caller.plan);
    if (balance < quote.capUsd) return this.insufficient(language, quote.maxCredits, balance);

    // Двойной клик: второй запрос ждёт первый и получает того же помощника.
    const key = `${caller.userId}:${opportunity.id}`;
    const inFlight = this.drafting.get(key);
    if (inFlight) {
      await inFlight.catch(() => undefined);
      return this.createFromOpportunity(caller, { ...input, confirm: false });
    }
    const job = this.writeDraft(caller, analysis, opportunity, quote.capUsd);
    this.drafting.set(key, job);
    try {
      return await job;
    } finally {
      this.drafting.delete(key);
    }
  }

  private async writeDraft(
    caller: BuilderCaller,
    analysis: NonNullable<Awaited<ReturnType<DiscoveryStore['get']>>>,
    opportunity: Awaited<ReturnType<DiscoveryStore['opportunities']>>[number],
    capUsd: number,
  ): Promise<Ok<{ solution: Solution; created: boolean }> | BuilderError> {
    const language = caller.language;
    const id = randomUUID();
    // Рецепт «бот для клиентов» (этап B): другой черновик и тип решения.
    const isBot = opportunity.recipe === 'customer_bot';
    const site =
      analysis.source && analysis.source.ok
        ? {
            url: analysis.source.url,
            title: analysis.source.title,
            description: analysis.source.description,
            text: analysis.source.text,
          }
        : null;
    const answers = analysis.questions
      .map((question) => {
        const answer = analysis.answers[question.id];
        return answer && 'value' in answer
          ? { question: question.text, answer: answer.value }
          : null;
      })
      .filter(Boolean);
    const result = await runStructuredTask<DraftOutput>({
      gateway: this.deps.gateway,
      caller,
      taskId: `${id}:draft:1`,
      conversationId: `builder:${id}`,
      billing: 'user',
      kind: 'review',
      policy: {
        modelId: DRAFT_MODEL_ID,
        maxOutputTokens: DRAFT_OUTPUT_TOKENS,
        reasoningEffort: 'low',
        capUsd,
        typicalUsd: 0,
      },
      language,
      systemPrompt: isBot ? botDraftSystemPrompt(language) : draftSystemPrompt(language),
      userMessage: draftUserMessage({
        ...(isBot && site ? { website: site } : {}),
        situation: analysis.context
          ? { domain: analysis.context.domain, summary: analysis.context.summary }
          : null,
        answers,
        opportunity: {
          title: opportunity.title,
          problem: opportunity.problem,
          solution: opportunity.solution,
          whatItTakes: [
            ...opportunity.feasibility.blockers,
            ...opportunity.feasibility.available,
          ].map((item) => ({ need: item.label, status: item.status })),
          dataNeeded: opportunity.dataNeeded,
          risks: opportunity.risks,
          limitations: opportunity.limitations,
          successCriteria: opportunity.successCriteria,
        },
        language,
      }),
      schema: draftOutputSchema,
      templateOutput: draftTemplate(opportunity.title, language, isBot),
    });
    if (!result.ok) {
      return {
        ok: false,
        status: 502,
        code: result.code,
        message: result.message,
        details: { chargedCredits: toCredits(result.creditsUsd) },
      };
    }
    const draft = result.data;
    const iso = this.now().toISOString();
    const config: AssistantConfig = {
      name: draft.name,
      purpose: draft.purpose,
      instructions: draft.instructions,
      tone: draft.tone,
      knowledge: draft.knowledge,
      examples: draft.examples,
      restrictions: draft.restrictions,
      language,
    };
    const bot: BotSettings | null = isBot
      ? {
          slug: await this.freeSlug(draft.name),
          greeting:
            draft.greeting ||
            text(
              language,
              `Здравствуйте! Я бот «${draft.name}». Чем помочь?`,
              `Hello! I am the "${draft.name}" bot. How can I help?`,
            ),
          quickReplies: draft.quickReplies,
          dailyCapCredits: DEFAULT_BOT_DAILY_CAP,
          corrections: [],
        }
      : null;
    const template = isBot ? TEMPLATES.customer_bot : TEMPLATES.personal_assistant;
    const solution: Solution = {
      id,
      ownerId: caller.userId,
      type: template.storageType,
      template: template.id,
      bot,
      status: 'draft',
      name: draft.name,
      currentVersion: 1,
      activeVersion: null,
      source: { analysisId: analysis.id, opportunityId: opportunity.id, title: opportunity.title },
      createdAt: iso,
      updatedAt: iso,
      version: 1,
    };
    const cases: TestCase[] = draft.testCases.map((item, position) => ({
      id: randomUUID(),
      solutionId: id,
      position,
      input: item.input,
      criteria: item.criteria,
      createdAt: iso,
      updatedAt: iso,
    }));
    await this.deps.store.createSolution(
      solution,
      { solutionId: id, number: 1, config, createdAt: iso },
      cases,
    );
    return { ok: true, solution, created: true };
  }

  /** Свободный адрес страницы бота: из имени, при занятости — с коротким суффиксом. */
  async freeSlug(name: string): Promise<string> {
    const base = slugFromName(name);
    if (!(await this.deps.store.slugTaken(base))) return base;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const candidate = `${base.slice(0, 33)}-${randomUUID().slice(0, 6)}`;
      if (!(await this.deps.store.slugTaken(candidate))) return candidate;
    }
    return `bot-${randomUUID().slice(0, 12)}`;
  }

  // ─── Чтение и настройки ────────────────────────────────────────────────────

  list(ownerId: string): Promise<Solution[]> {
    return this.deps.store.listSolutions(ownerId);
  }

  async get(ownerId: string, id: string) {
    const solution = await this.deps.store.getSolution(ownerId, id);
    if (!solution) return null;
    const [current, cases, run, versions] = await Promise.all([
      this.deps.store.getVersion(ownerId, id, solution.currentVersion),
      this.deps.store.listCases(ownerId, id),
      this.deps.store.latestRun(ownerId, id),
      this.deps.store.listVersions(ownerId, id),
    ]);
    if (!current) return null;
    const versionList = versions.map((item) => ({
      number: item.number,
      createdAt: item.createdAt,
    }));
    const kind = KIND_BY_TYPE[solution.type];
    if (kind === 'assistant' && !isToolConfig(current.config)) {
      return {
        kind,
        solution,
        config: current.config,
        cases,
        run,
        versions: versionList,
        readiness: readiness(solution, cases, run),
      };
    }
    if (kind !== 'assistant' && isToolConfig(current.config)) {
      return { kind, solution, config: current.config, versions: versionList };
    }
    // Вид решения и его настройки не совпадают — запись повреждена; не показываем её как другую.
    return null;
  }

  getVersion(ownerId: string, id: string, number: number): Promise<SolutionVersion | null> {
    return this.deps.store.getVersion(ownerId, id, number);
  }

  /** Сохранить настройки: изменились — новая версия; включённый помощник работает на прежней. */
  async updateConfig(
    caller: BuilderCaller,
    id: string,
    config: AssistantConfig,
  ): Promise<Ok<{ solution: Solution; changed: boolean }> | BuilderError> {
    const solution = await this.deps.store.getSolution(caller.userId, id);
    if (!solution) return notFound(id);
    if (KIND_BY_TYPE[solution.type] !== 'assistant') return wrongKind(caller.language);
    const current = await this.deps.store.getVersion(caller.userId, id, solution.currentVersion);
    if (current && !isToolConfig(current.config) && sameConfig(current.config, config))
      return { ok: true, solution, changed: false };
    const number = solution.currentVersion + 1;
    const iso = this.now().toISOString();
    const added = await this.deps.store.addVersion(caller.userId, {
      solutionId: id,
      number,
      config,
      createdAt: iso,
    });
    if (!added) return conflict(caller.language);
    const updated = await this.deps.store.updateSolution(
      { ...solution, name: config.name, currentVersion: number, updatedAt: iso },
      solution.version,
    );
    if (!updated) return conflict(caller.language);
    return { ok: true, solution: updated, changed: true };
  }

  /** Вернуть настройки прошлой версии: создаётся новая версия с ними (история не теряется). */
  async restoreVersion(
    caller: BuilderCaller,
    id: string,
    number: number,
  ): Promise<Ok<{ solution: Solution; changed: boolean }> | BuilderError> {
    const version = await this.deps.store.getVersion(caller.userId, id, number);
    if (!version) return notFound(id);
    if (isToolConfig(version.config)) return wrongKind(caller.language);
    return this.updateConfig(caller, id, version.config);
  }

  async saveCase(
    caller: BuilderCaller,
    id: string,
    input: { caseId?: string; input: string; criteria: string[] },
  ): Promise<Ok<{ item: TestCase }> | BuilderError> {
    const solution = await this.deps.store.getSolution(caller.userId, id);
    if (!solution) return notFound(id);
    if (KIND_BY_TYPE[solution.type] !== 'assistant') return wrongKind(caller.language);
    const cases = await this.deps.store.listCases(caller.userId, id);
    const existing = input.caseId ? cases.find((item) => item.id === input.caseId) : undefined;
    if (input.caseId && !existing) return notFound(input.caseId);
    if (!existing && cases.length >= LIMITS.cases) {
      return {
        ok: false,
        status: 409,
        code: 'cases_limit',
        message: text(
          caller.language,
          `Не больше ${LIMITS.cases} тест-кейсов.`,
          `At most ${LIMITS.cases} test cases.`,
        ),
      };
    }
    const iso = this.now().toISOString();
    const item: TestCase = existing
      ? { ...existing, input: input.input, criteria: input.criteria, updatedAt: iso }
      : {
          id: randomUUID(),
          solutionId: id,
          position: (cases.at(-1)?.position ?? -1) + 1,
          input: input.input,
          criteria: input.criteria,
          createdAt: iso,
          updatedAt: iso,
        };
    if (!(await this.deps.store.saveCase(caller.userId, item))) return notFound(id);
    return { ok: true, item };
  }

  async deleteCase(caller: BuilderCaller, id: string, caseId: string): Promise<boolean> {
    return this.deps.store.deleteCase(caller.userId, id, caseId);
  }

  // ─── Тесты ─────────────────────────────────────────────────────────────────

  async runTests(
    caller: BuilderCaller,
    id: string,
    confirm?: boolean,
  ): Promise<Ok<{ run: TestRun }> | BuilderError> {
    const view = await this.get(caller.userId, id);
    if (!view) return notFound(id);
    if (view.kind !== 'assistant') return wrongKind(caller.language);
    const language = caller.language;
    if (view.cases.length === 0) {
      return {
        ok: false,
        status: 409,
        code: 'no_cases',
        message: text(language, 'Добавьте хотя бы один тест-кейс.', 'Add at least one test case.'),
      };
    }
    if (view.run?.status === 'running') {
      return {
        ok: false,
        status: 409,
        code: 'run_in_progress',
        message: text(language, 'Тесты уже идут.', 'Tests are already running.'),
      };
    }
    const quote = this.testQuote(view.config, view.cases, view.solution.bot);
    if (!confirm)
      return this.confirmation(language, { ru: 'Прогон тестов', en: 'Test run' }, quote, {
        cases: quote.cases,
        judgeModel: quote.judgeModel,
      });
    const balance = this.deps.balanceUsd(caller.userId, caller.plan);
    if (balance < quote.capUsd) return this.insufficient(language, quote.maxCredits, balance);

    const run: TestRun = {
      id: randomUUID(),
      solutionId: id,
      ownerId: caller.userId,
      versionNumber: view.solution.currentVersion,
      casesHash: casesHash(view.cases),
      status: 'running',
      results: view.cases.map((item) => ({
        caseId: item.id,
        input: item.input,
        criteria: item.criteria,
        status: 'pending',
        answer: '',
        model: null,
        judge: null,
        manual: null,
        error: null,
        costUsd: 0,
        creditsUsd: 0,
      })),
      createdAt: this.now().toISOString(),
      finishedAt: null,
      version: 1,
    };
    if (!(await this.deps.store.createRun(run))) return notFound(id);
    const job = this.executeRun(caller, run, view.config, view.cases, view.solution.bot)
      .catch((error: unknown) => console.error(`[builder] прогон ${run.id} упал`, error))
      .finally(() => this.running.delete(run.id));
    this.running.set(run.id, job);
    return { ok: true, run };
  }

  private async executeRun(
    caller: BuilderCaller,
    run: TestRun,
    config: AssistantConfig,
    cases: readonly TestCase[],
    bot: BotSettings | null,
  ): Promise<void> {
    const { instructions, replaceSystemPrompt } = answerInstructions(config, bot);
    for (const item of cases) {
      const caps = this.caseCaps(config, item, bot);
      await this.updateResult(caller.userId, run.id, item.id, { status: 'running' });
      const answer = await this.answer(
        caller,
        run.id,
        `builder:test:${run.id}`,
        instructions,
        [{ role: 'user', content: item.input }],
        {
          maxOutputTokens: TEST_ANSWER_TOKENS,
          maxChargeUsd: caps.answerCapUsd,
          solutionId: run.solutionId,
          replaceSystemPrompt,
        },
      );
      // Бот: метка заявки — не текст ответа; судья видит, что клиенту предложена форма.
      if (bot) {
        const parsed = parseBotReply(answer.text);
        answer.text = parsed.offerContact
          ? `${parsed.text}\n\n${config.language === 'en' ? '[The bot showed the customer the "Leave your contact" form]' : '[Бот показал клиенту форму «Оставьте контакт»]'}`
          : parsed.text;
      }
      if (answer.error) {
        await this.updateResult(caller.userId, run.id, item.id, {
          status: 'failed',
          answer: answer.text,
          error: answer.error,
          costUsd: answer.costUsd,
          creditsUsd: answer.creditsUsd,
          ...(answer.model ? { model: answer.model } : {}),
        });
        continue;
      }
      const judged = await runStructuredTask<JudgeOutput>({
        gateway: this.deps.gateway,
        caller,
        taskId: `${run.id}:judge:${item.id}`,
        conversationId: `builder:test:${run.id}`,
        billing: 'user',
        kind: 'review',
        policy: {
          modelId: JUDGE_MODEL_ID,
          maxOutputTokens: JUDGE_OUTPUT_TOKENS,
          reasoningEffort: 'low',
          capUsd: caps.judgeCapUsd,
          typicalUsd: 0,
        },
        language: config.language,
        systemPrompt: judgeSystemPrompt(config.language),
        userMessage: judgeUserMessage(item.input, item.criteria, answer.text),
        schema: judgeOutputSchema,
        templateOutput: JSON.stringify({
          criteria: item.criteria.map((criterion) => ({
            criterion,
            met: true,
            note:
              config.language === 'en'
                ? 'Demo check without a model.'
                : 'Демо-проверка без модели.',
          })),
          notes:
            config.language === 'en' ? 'Demo check without a model.' : 'Демо-проверка без модели.',
        }),
      });
      await this.updateResult(caller.userId, run.id, item.id, {
        status: judged.ok ? 'done' : 'failed',
        answer: answer.text,
        model: answer.model,
        judge: judged.ok
          ? {
              verdict: judgeVerdict(item.criteria, judged.data),
              notes: judged.data.notes,
              criteria: item.criteria.map((criterion, index) => ({
                criterion,
                met: judged.data.criteria[index]?.met ?? false,
                note: judged.data.criteria[index]?.note ?? '',
              })),
            }
          : null,
        error: judged.ok ? null : { code: judged.code, message: judged.message },
        costUsd: round6(answer.costUsd + judged.costUsd),
        creditsUsd: round6(answer.creditsUsd + judged.creditsUsd),
      });
    }
    await this.mutateRun(caller.userId, run.id, (current) => ({
      ...current,
      status: 'done',
      finishedAt: this.now().toISOString(),
    }));
  }

  /** Ответ помощника через общий шлюз: Auto, настройки поверх правил чата. */
  async answer(
    caller: BuilderCaller,
    runId: string | null,
    conversationId: string,
    instructions: string,
    messages: Array<{ role: 'user' | 'assistant'; content: string }>,
    options: {
      maxOutputTokens?: number;
      maxChargeUsd?: number;
      solutionId: string;
      /** Бот для клиентов: его промпт заменяет правила чата Ketner. */
      replaceSystemPrompt?: boolean;
    },
    onDelta?: (delta: string) => void,
    signal?: AbortSignal,
  ): Promise<{
    text: string;
    model: { id: string; name: string } | null;
    error: { code: string; message: string } | null;
    costUsd: number;
    creditsUsd: number;
  }> {
    const outcome = {
      text: '',
      model: null as { id: string; name: string } | null,
      error: null as { code: string; message: string } | null,
      costUsd: 0,
      creditsUsd: 0,
    };
    await this.deps.gateway.stream(
      {
        userId: caller.userId,
        userPlan: caller.plan,
        ...(caller.email ? { userEmail: caller.email } : {}),
        isVip: caller.isVip,
        isAnonymous: false,
        conversationId,
        modelId: 'auto',
        messages,
        language: caller.language,
        stream: true,
        ...(signal ? { signal } : {}),
        assistant: {
          id: options.solutionId,
          instructions,
          ...(runId ? { testRunId: runId } : {}),
          ...(options.maxOutputTokens ? { maxOutputTokens: options.maxOutputTokens } : {}),
          ...(options.maxChargeUsd !== undefined ? { maxChargeUsd: options.maxChargeUsd } : {}),
          ...(options.replaceSystemPrompt ? { replaceSystemPrompt: true } : {}),
        },
      },
      {
        onDelta: (delta) => {
          outcome.text += delta;
          onDelta?.(delta);
        },
        onDone: (done) => {
          outcome.costUsd = done.costUsd ?? 0;
          outcome.creditsUsd = done.creditsUsd ?? 0;
          if (done.selectedModel)
            outcome.model = {
              id: done.selectedModel.id,
              name: realModelName(done.selectedModel.id, this.registry),
            };
        },
        onError: (error) => {
          outcome.error = error;
        },
      },
      () => signal?.aborted ?? false,
    );
    return outcome;
  }

  async setVerdict(
    caller: BuilderCaller,
    id: string,
    runId: string,
    caseId: string,
    verdict: Verdict | null,
  ): Promise<Ok<{ run: TestRun }> | BuilderError> {
    const run = await this.deps.store.getRun(caller.userId, runId);
    if (!run || run.solutionId !== id || !run.results.some((item) => item.caseId === caseId))
      return notFound(runId);
    const updated = await this.updateResult(caller.userId, runId, caseId, { manual: verdict });
    return updated ? { ok: true, run: updated } : notFound(runId);
  }

  private updateResult(
    ownerId: string,
    runId: string,
    caseId: string,
    patch: Partial<TestResult>,
  ): Promise<TestRun | null> {
    return this.mutateRun(ownerId, runId, (run) => ({
      ...run,
      results: run.results.map((item) => (item.caseId === caseId ? { ...item, ...patch } : item)),
    }));
  }

  private async mutateRun(
    ownerId: string,
    runId: string,
    change: (run: TestRun) => TestRun,
  ): Promise<TestRun | null> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const current = await this.deps.store.getRun(ownerId, runId);
      if (!current) return null;
      const saved = await this.deps.store.updateRun(change(current), current.version);
      if (saved) return saved;
    }
    throw new Error(`builder: не удалось сохранить прогон ${runId}`);
  }

  // ─── Включение ─────────────────────────────────────────────────────────────

  async activate(
    caller: BuilderCaller,
    id: string,
  ): Promise<Ok<{ solution: Solution }> | BuilderError> {
    const view = await this.get(caller.userId, id);
    if (!view) return notFound(id);
    if (view.kind !== 'assistant') return wrongKind(caller.language);
    if (!view.readiness.ready) {
      const messages: Record<string, { ru: string; en: string }> = {
        no_cases: {
          ru: 'Добавьте тест-кейсы и проверьте помощника.',
          en: 'Add test cases and test the assistant.',
        },
        not_tested: {
          ru: 'Сначала проверьте помощника на тест-кейсах.',
          en: 'Test the assistant on the test cases first.',
        },
        outdated: {
          ru: 'Настройки или тест-кейсы изменились после проверки — проверьте ещё раз.',
          en: 'The settings or test cases changed after the check — test again.',
        },
        running: { ru: 'Дождитесь окончания тестов.', en: 'Wait until the tests finish.' },
        failed_cases: {
          ru: 'Не все тест-кейсы пройдены. Исправьте настройки или отметьте кейс пройденным вручную.',
          en: 'Not all test cases passed. Fix the settings or mark the case as passed manually.',
        },
      };
      const message = messages[view.readiness.reason];
      return {
        ok: false,
        status: 409,
        code: 'not_ready',
        message: text(caller.language, message.ru, message.en),
        details: { reason: view.readiness.reason },
      };
    }
    const updated = await this.deps.store.updateSolution(
      {
        ...view.solution,
        status: 'active',
        activeVersion: view.solution.currentVersion,
        updatedAt: this.now().toISOString(),
      },
      view.solution.version,
    );
    return updated ? { ok: true, solution: updated } : conflict(caller.language);
  }

  async pause(
    caller: BuilderCaller,
    id: string,
  ): Promise<Ok<{ solution: Solution }> | BuilderError> {
    const solution = await this.deps.store.getSolution(caller.userId, id);
    if (!solution) return notFound(id);
    if (KIND_BY_TYPE[solution.type] !== 'assistant') return wrongKind(caller.language);
    if (solution.status !== 'active') return { ok: true, solution };
    const updated = await this.deps.store.updateSolution(
      { ...solution, status: 'paused', updatedAt: this.now().toISOString() },
      solution.version,
    );
    return updated ? { ok: true, solution: updated } : conflict(caller.language);
  }

  async remove(caller: BuilderCaller, id: string): Promise<boolean> {
    const runs = await this.deps.store.latestRun(caller.userId, id);
    if (runs && this.running.has(runs.id)) await this.running.get(runs.id);
    return this.deps.store.deleteSolution(caller.userId, id);
  }

  /** Настройки, на которых работает чат: включённая версия. */
  async activeConfig(ownerId: string, id: string) {
    const solution = await this.deps.store.getSolution(ownerId, id);
    if (!solution || solution.status !== 'active' || solution.activeVersion === null) return null;
    const version = await this.deps.store.getVersion(ownerId, id, solution.activeVersion);
    // Чат и бот работают только на настройках помощника.
    return version && !isToolConfig(version.config) ? { solution, config: version.config } : null;
  }
}

/** Цена черновика помощника: показывается до запуска и на странице «Кредиты». */
export function draftQuote(language: Language, registry: ModelRegistry = modelRegistry) {
  const cost = callCost(
    DRAFT_MODEL_ID,
    {
      systemChars: Math.max(
        draftSystemPrompt(language).length,
        botDraftSystemPrompt(language).length,
      ),
      payloadChars: DRAFT_PAYLOAD_CHARS,
      maxOutputTokens: DRAFT_OUTPUT_TOKENS,
      attempts: 2,
    },
    { inputTokens: 3_500, outputTokens: 2_000 },
    registry,
  );
  return {
    model: realModelName(DRAFT_MODEL_ID, registry),
    capUsd: cost.capUsd,
    ...toCreditRange(cost.typicalUsd, cost.capUsd),
  };
}

/** Действие помощника (настройки, тесты, включение, чат) над инструментом или процессом. */
function wrongKind(language: Language): BuilderError {
  return {
    ok: false,
    status: 409,
    code: 'wrong_solution_kind',
    message: text(
      language,
      'Это действие есть только у помощников.',
      'This action is only available for assistants.',
    ),
  };
}

function notFound(id: string): BuilderError {
  return { ok: false, status: 404, code: 'not_found', message: `Не найдено: ${id}` };
}

function conflict(language: Language): BuilderError {
  return {
    ok: false,
    status: 409,
    code: 'conflict',
    message: text(
      language,
      'Помощник только что изменился. Обновите страницу.',
      'The assistant has just changed. Reload the page.',
    ),
  };
}

/** Демо-черновик для работы без ключей моделей (локально и в тестах). */
export function draftTemplate(title: string, language: Language, bot = false): string {
  const en = language === 'en';
  return JSON.stringify({
    name: title.slice(0, LIMITS.name),
    ...(bot
      ? {
          greeting: en
            ? 'Hello! This is a demo bot without a model. Ask about delivery or prices.'
            : 'Здравствуйте! Это демо-бот без модели. Спросите о доставке или ценах.',
          quickReplies: en ? ['Delivery', 'Prices', 'Contacts'] : ['Доставка', 'Цены', 'Контакты'],
        }
      : {}),
    purpose: en
      ? 'Demo assistant without a model: helps with this opportunity.'
      : 'Демо-помощник без модели: помогает с этой возможностью.',
    instructions: en
      ? 'Answer briefly. Ask a clarifying question if data is missing.'
      : 'Отвечай кратко. Если не хватает данных — задай уточняющий вопрос.',
    tone: 'friendly',
    knowledge: '',
    examples: [],
    restrictions: [en ? 'Do not invent prices or deadlines' : 'Не выдумывай цены и сроки'],
    testCases: [
      {
        input: en ? 'Hello! What can you help me with?' : 'Привет! С чем ты можешь помочь?',
        criteria: [en ? 'Explains what it can do' : 'Объясняет, чем может помочь'],
      },
      {
        input: en ? 'How much does delivery cost?' : 'Сколько стоит доставка?',
        criteria: [en ? 'Does not invent a price' : 'Не выдумывает цену'],
      },
    ],
  });
}

export { CONFIRM_ABOVE_CREDITS };
