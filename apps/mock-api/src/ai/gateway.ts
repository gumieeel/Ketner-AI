/**
 * AI Gateway — центральный шлюз оркестрации AI-запросов Ketner AI.
 *
 * Объединяет:
 * - Model Registry (каталог моделей)
 * - Provider Manager (адаптеры OpenAI, Anthropic, Google, OpenRouter)
 * - Entitlement Service (проверка прав и тарифов)
 * - Fair Use Engine (защита от злоупотреблений, rate limits, concurrency)
 * - Context Optimizer (оптимизация контекста)
 * - Usage Accounting & Cost Calculator (учёт токенов и себестоимости)
 * - Fallback & Failover (автоматическое переключение при сбоях провайдеров)
 */

import { ERROR_MESSAGES, pickAnswer } from './answers.js';
import { semanticCache, SemanticCache } from './cache.js';
import { ContextOptimizer } from './context.js';
import type {
  GatewayRequest,
  GatewayStreamCallbacks,
  ModelRegistryEntry,
  ProviderResponse,
} from './gateway-types.js';
import type { Language, MessageAttachment } from '../types.js';
import {
  modelRegistry,
  type ModelRegistry,
  ECONOMY_SYSTEM_PROMPT,
  DEFAULT_SYSTEM_PROMPT,
} from './model-registry.js';
import { providerManager, type ProviderManager } from './providers/provider-factory.js';
import { delay, streamText } from './stream.js';
import type { AiConfig } from '../config.js';
import { CostCalculator } from '../services/cost.js';
import { EntitlementService } from '../services/entitlement.js';
import { FairUseEngine } from '../services/fair-use.js';
import { AutoRouter } from './auto-router.js';
import type { UsageStore } from '../store/usage-store.js';
import {
  TierPipelineEngine,
  computeDynamicMaxTokens,
  type PipelineStrategy,
} from './tier-pipeline.js';

export interface ComplexityContext {
  history?: Array<{ role: string; content: string }>;
  hasAttachments?: boolean;
  hasWorkspace?: boolean;
}

export interface EngineResolution {
  modelId: string;
  engineName: string;
  level: 'simple' | 'moderate' | 'complex';
}

export type AstraEngineResolution = EngineResolution;

export function classifyPromptComplexity(
  prompt?: string,
  context?: ComplexityContext,
): {
  level: 'simple' | 'moderate' | 'complex';
  category: string;
} {
  if (!prompt || !prompt.trim()) {
    return { level: 'complex', category: 'general' };
  }

  // Если есть вложения или проект — задача сразу переходит в категорию сложных
  if (context?.hasAttachments || context?.hasWorkspace) {
    return { level: 'complex', category: 'coding' };
  }

  const classification = AutoRouter.classify(prompt);
  const trimmed = prompt.trim();

  // Проверка истории: если в недавней истории был сложный контекст (код, длинные ответы, рассуждения),
  // то короткая реплика («да», «продолжи», «ок») не должна сбрасывать сложность на deepseek
  const historyIsComplex = Boolean(
    context?.history &&
      context.history.length > 0 &&
      context.history.slice(-4).some((m) => {
        const text = m.content || '';
        return (
          text.length > 250 ||
          /```|function|class|interface|import|export|select|def |const |let |error|exception/i.test(
            text,
          )
        );
      }),
  );

  const hasCodeOrTechnicalSyntax =
    /```|<pre>|SELECT\s+[\s\S]*?\s+FROM|INSERT\s+INTO|UPDATE\s+[\s\S]*?SET|CREATE\s+TABLE|function\s*\(|def\s+\w+\(|class\s+\w+|const\s+\w+\s*=|let\s+\w+\s*=|import\s+[\s\S]*?from|export\s+(default|const|class)|interface\s+\w+/i.test(
      trimmed,
    );

  // 1. "Прям лёгкие вопросы": приветствия, благодарности, подтверждения, короткие реплики
  const isGreetingOrChitChat =
    /^(привет|хай|здравствуй|добр(ое|ый|ый день|ое утро|ый вечер)|hello|hi|hey|как дела|кто ты|что ты умеешь|спасибо|благодарю|ок|ok|ясно|понятно)[\s!?,.]*$/i.test(
      trimmed,
    );

  const isTrivialGeneral =
    trimmed.length < 50 &&
    classification.complexity === 'simple' &&
    classification.category === 'general' &&
    !/(напиши|составь|придумай|объясни|расскажи|переведи|write|explain|translate|код|функци)/i.test(trimmed);

  if ((isGreetingOrChitChat || isTrivialGeneral) && !historyIsComplex && !hasCodeOrTechnicalSyntax) {
    return { level: 'simple', category: classification.category };
  }

  // 2. Сложные задачи: глубокий код, математика, архитектура, системный дизайн, длинные формулировки (>500 символов)
  const isComplex =
    classification.complexity === 'complex' ||
    classification.category === 'coding' ||
    classification.category === 'math' ||
    classification.category === 'reasoning' ||
    classification.category === 'research' ||
    hasCodeOrTechnicalSyntax ||
    trimmed.length > 500 ||
    historyIsComplex;

  if (isComplex) {
    return { level: 'complex', category: hasCodeOrTechnicalSyntax ? 'coding' : classification.category };
  }

  // 3. Умеренные / стандартные задачи
  return { level: 'moderate', category: classification.category };
}

/**
 * Интеллектуальный роутер движков OpenRouter для флагманских Pro-моделей:
 * 1. GPT-6 Astra:
 *    - лёгкие: deepseek/deepseek-chat
 *    - средние: openai/gpt-6-luna-pro
 *    - сложные: openai/gpt-6-sol-pro
 * 2. Claude Fable (5.1 / 5.5):
 *    - лёгкие: deepseek/deepseek-chat
 *    - средние: anthropic/claude-haiku-4.5
 *    - сложные: anthropic/claude-opus-5.5
 * 3. Gemini 3.8 Flash (ранее gemini-2.5-pro / gemini-pro):
 *    - лёгкие: deepseek/deepseek-chat
 *    - средние и сложные: google/gemini-3.8-flash
 * 4. Grok 4.7:
 *    - лёгкие: deepseek/deepseek-chat
 *    - средние и сложные: x-ai/grok-4.7
 */
export function resolveEngineForModel(
  modelId: string,
  prompt?: string,
  context?: ComplexityContext,
): EngineResolution {
  const { level } = classifyPromptComplexity(prompt, context);

  // 1. GPT-6 Astra
  if (modelId === 'gpt-6-astra') {
    if (level === 'simple') {
      return { modelId: 'deepseek/deepseek-chat', engineName: 'DeepSeek Chat (Light Fast)', level };
    }
    if (level === 'moderate') {
      return { modelId: 'openai/gpt-6-luna-pro', engineName: 'OpenAI: GPT-6 Luna Pro', level };
    }
    return { modelId: 'openai/gpt-6-sol-pro', engineName: 'OpenAI: GPT-6 Sol Pro', level };
  }

  // 2. Claude Fable (5.1 / 5.5)
  if (modelId === 'claude-fable' || modelId === 'claude-3.5-sonnet') {
    if (level === 'simple') {
      return { modelId: 'deepseek/deepseek-chat', engineName: 'DeepSeek Chat (Light Fast)', level };
    }
    if (level === 'moderate') {
      return { modelId: 'anthropic/claude-haiku-4.5', engineName: 'Anthropic: Claude Haiku 4.5', level };
    }
    return { modelId: 'anthropic/claude-opus-5.5', engineName: 'Anthropic: Claude Opus 5.5', level };
  }

  // 3. Gemini 3.8 Flash
  if (
    modelId === 'gemini-2.5-pro' ||
    modelId === 'gemini-pro' ||
    modelId === 'gemini-3.8-flash'
  ) {
    if (level === 'simple') {
      return { modelId: 'deepseek/deepseek-chat', engineName: 'DeepSeek Chat (Light Fast)', level };
    }
    return { modelId: 'google/gemini-3.8-flash', engineName: 'Google: Gemini 3.8 Flash', level };
  }

  // 4. Grok 4.7
  if (modelId === 'grok-4.7' || modelId === 'grok') {
    if (level === 'simple') {
      return { modelId: 'deepseek/deepseek-chat', engineName: 'DeepSeek Chat (Light Fast)', level };
    }
    return { modelId: 'x-ai/grok-4.7', engineName: 'SpaceXAI: Grok 4.7', level };
  }

  // Прочие модели:
  if (modelId === 'gpt-4o-mini') {
    return { modelId: 'openai/gpt-4o-mini', engineName: 'OpenAI: GPT-4o mini', level };
  }
  if (modelId === 'gpt-4o') {
    return { modelId: 'openai/gpt-4o', engineName: 'OpenAI: GPT-4o', level };
  }
  if (modelId === 'deepseek-v4.1-flash') {
    return { modelId: 'deepseek/deepseek-chat', engineName: 'DeepSeek V4.1 Flash', level };
  }
  if (modelId === 'gemini-2.5-flash') {
    return { modelId: 'google/gemini-2.5-flash', engineName: 'Google: Gemini 2.5 Flash', level };
  }
  if (modelId === 'claude-3-haiku') {
    return { modelId: 'anthropic/claude-haiku-4.5', engineName: 'Anthropic: Claude Haiku 4.5', level };
  }

  return { modelId, engineName: modelId, level };
}

export function resolveAstraEngine(prompt?: string, context?: ComplexityContext): AstraEngineResolution {
  return resolveEngineForModel('gpt-6-astra', prompt, context);
}

export function toOpenRouterModelId(
  model: ModelRegistryEntry,
  prompt?: string,
  context?: ComplexityContext,
): string {
  const resolution = resolveEngineForModel(model.id, prompt, context);
  if (resolution.modelId !== model.id) {
    return resolution.modelId;
  }
  if (model.provider === 'openai') return `openai/${model.providerModelId}`;
  if (model.provider === 'anthropic') return `anthropic/${model.providerModelId}`;
  if (model.provider === 'google') return `google/${model.providerModelId}`;
  return model.providerModelId;
}

function buildWorkspaceContextBlock(ws: any, language: Language): string {
  const isEn = language === 'en';
  const typeLabel =
    ws.type === 'git_repo'
      ? (isEn ? 'GitHub Repository' : 'GitHub-репозиторий')
      : (isEn ? 'Local Project Folder' : 'Локальная папка проекта');

  let block = isEn
    ? `\n\n[ATTACHED WORKSPACE CONTEXT: ${typeLabel} "${ws.name}"]\nSource: ${ws.pathOrUrl || ws.name}${ws.branch ? ` (branch: ${ws.branch})` : ''}\nTotal Files Indexed: ${ws.filesCount || ws.files?.length || 0}\n`
    : `\n\n[КОНТЕКСТ ПРИВЯЗАННОГО ПРОЕКТА: ${typeLabel} «${ws.name}»]\nИсточник: ${ws.pathOrUrl || ws.name}${ws.branch ? ` (ветка: ${ws.branch})` : ''}\nВсего проиндексировано файлов: ${ws.filesCount || ws.files?.length || 0}\n`;

  if (Array.isArray(ws.files) && ws.files.length > 0) {
    block += isEn ? '\nProject File Tree:\n' : '\nДерево файлов проекта:\n';
    const treePreview = ws.files
      .slice(0, 60)
      .map((f: any) => `- ${f.path}${f.size ? ` (${Math.round((f.size / 1024) * 10) / 10} KB)` : ''}`)
      .join('\n');
    block += treePreview;
    if (ws.files.length > 60) {
      block += isEn ? `\n... and ${ws.files.length - 60} more files` : `\n... и ещё ${ws.files.length - 60} файлов`;
    }
    block += '\n';

    const filesWithContent = ws.files.filter(
      (f: any) => typeof f.content === 'string' && f.content.trim().length > 0,
    );
    if (filesWithContent.length > 0) {
      block += isEn ? '\nKey Project Code & File Contents:\n' : '\nСодержимое ключевых файлов проекта:\n';
      let totalContentLength = 0;
      const MAX_TOTAL_CHARS = 120000;
      for (const f of filesWithContent) {
        if (totalContentLength > MAX_TOTAL_CHARS) {
          block += isEn ? '\n[Additional files omitted for length]\n' : '\n[Остальные файлы пропущены для экономии контекста]\n';
          break;
        }
        const snippet = f.content.slice(0, 15000);
        block += `\n--- File: ${f.path} ---\n\`\`\`${f.language || ''}\n${snippet}\n\`\`\`\n`;
        totalContentLength += snippet.length;
      }
    }
  }

  block += isEn
    ? `\nIMPORTANT INSTRUCTIONS FOR WORKSPACE WORK:
- You are acting as a full-fledged agentic coding assistant (like Antigravity / Cursor) connected directly to this codebase.
- When asked to analyze the repository/workspace or when the user provides a request regarding this project, provide a thorough, structured, and complete technical response.
- Cover: 1) Architecture & Tech Stack, 2) Directory structure & key modules, 3) Entry points & data flow, 4) Next steps and ready-to-use solutions.
- Never truncate or cut off your answer. Use clean Markdown headers and code blocks.
- If the user prompt is typed in an incorrect keyboard layout (e.g. "ghjfyfkbpbhqe htgjpbnjhbq" for "проанализируй репозиторий"), automatically recognize the intended meaning and respond in the appropriate language.
- Never claim you cannot work with local files or repos, as the files and structure are loaded above for you.`
    : `\nВАЖНЫЕ ИНСТРУКЦИИ ДЛЯ РАБОТЫ С ПРОЕКТОМ:
- Ты работаешь в режиме полноценного инженерного AI-ассистента (как Antigravity / Cursor), напрямую подключенного к этой кодовой базе.
- При запросе анализа репозитория или папки давай глубокий, структурированный и завершённый технический отчёт.
- Освети: 1) Архитектуру и стек технологий проекта, 2) Назначение ключевых директорий и модулей, 3) Входные точки (entry points) и потоки данных, 4) Готовность писать код, вносить правки и решать задачи по проекту.
- Никогда не обрывай ответ на полуслове. Используй качественное Markdown-форматирование, списки и блоки кода.
- Если запрос пользователя набран в ошибочной раскладке (например, «ghjfyfkbpbhqe htgjpbnjhbq» вместо «проанализируй репозиторий»), автоматически распознай смысл и ответь на русском языке по существу.
- Никогда не говори, что ты не имеешь доступа к локальным файлам или репозиторию, так как все файлы и структура проекта уже переданы тебе выше.`;

  return block;
}

const JCUKEN_MAP: Record<string, string> = {
  q: 'й', w: 'ц', e: 'у', r: 'к', t: 'е', y: 'н', u: 'г', i: 'ш', o: 'щ', p: 'з', '[': 'х', ']': 'ъ',
  a: 'ф', s: 'ы', d: 'в', f: 'а', g: 'п', h: 'р', j: 'о', k: 'л', l: 'д', ';': 'ж', "'": 'э',
  z: 'я', x: 'ч', c: 'с', v: 'м', b: 'и', n: 'т', m: 'ь', ',': 'б', '.': 'ю', '`': 'ё',
  Q: 'Й', W: 'Ц', E: 'У', R: 'К', T: 'Е', Y: 'Н', U: 'Г', I: 'Ш', O: 'Щ', P: 'З', '{': 'Х', '}': 'Ъ',
  A: 'Ф', S: 'Ы', D: 'В', F: 'А', G: 'П', H: 'Р', J: 'О', K: 'Л', L: 'Д', ':': 'Ж', '"': 'Э',
  Z: 'Я', X: 'Ч', C: 'С', V: 'М', B: 'И', N: 'Т', M: 'Ь', '<': 'Б', '>': 'Ю', '~': 'Ё',
};

export function convertLayoutIfInverted(input: string): string {
  if (!input || input.trim().length === 0) return input;
  const hasLatin = /[a-zA-Z]/.test(input);
  const hasCyrillic = /[а-яА-ЯёЁ]/.test(input);
  if (!hasLatin || hasCyrillic) return input;

  const converted = input
    .split('')
    .map((ch) => JCUKEN_MAP[ch] ?? ch)
    .join('');

  const ruPatterns = /(анализ|репозитор|проект|файл|сдела|помог|напиш|объясн|ошибк|папк|ветк|функц|компонент|скрипт|привет|как|что|где|почему)/i;
  if (ruPatterns.test(converted)) {
    return converted;
  }
  return input;
}

function buildAttachmentsBlock(attachments: MessageAttachment[], language: Language): string {
  const isEn = language === 'en';
  let block = isEn
    ? `\n\n[USER ATTACHMENTS (${attachments.length} files)]:\n`
    : `\n\n[ПРИКРЕПЛЁННЫЕ ПОЛЬЗОВАТЕЛЕМ ВЛОЖЕНИЯ (${attachments.length})]:\n`;

  for (const a of attachments) {
    block += `- **${a.name}** (${a.category.toUpperCase()}, ${Math.round(((a.size || 0) / 1024) * 10) / 10} KB)\n`;
    if (a.contentPreview) {
      const preview = a.contentPreview.slice(0, 20000);
      block += `\`\`\`\n${preview}\n\`\`\`\n`;
    }
  }

  return block;
}

export interface AIGatewayDeps {
  registry?: ModelRegistry;
  providers?: ProviderManager;
  usageStore: UsageStore;
  aiConfig: AiConfig;
}

export class AIGateway {
  private registry: ModelRegistry;
  private providers: ProviderManager;
  private usageStore: UsageStore;
  private aiConfig: AiConfig;

  constructor(deps: AIGatewayDeps) {
    this.registry = deps.registry ?? modelRegistry;
    this.providers = deps.providers ?? providerManager;
    this.usageStore = deps.usageStore;
    this.aiConfig = deps.aiConfig;
  }

  /**
   * Стриминговая генерация ответа через AI Gateway.
   */
  async stream(
    req: GatewayRequest,
    callbacks: GatewayStreamCallbacks,
    isCancelled: () => boolean,
  ): Promise<void> {
    const startTime = Date.now();
    const activeUserId = req.userId;
    const language = req.language;

    // 1. Определение эффективного плана и лимитов
    // Примечание: req.userPlan предварительно резолвится с учётом VIP-элевации (isVipUser -> 'ultra')
    // upstream в chat.ts перед вызовом gateway.stream().
    // EntitlementService.resolveEffectivePlan повторно валидирует план, учитывая переданные
    // req.userEmail и req.isVip, и обеспечивает надёжный fallback на 'free'.
    const effectivePlan = EntitlementService.resolveEffectivePlan(
      req.userPlan,
      req.userEmail,
      req.isVip,
    );
    const entitlements = EntitlementService.getEntitlements(effectivePlan);
    const snapshot = this.usageStore.getFairUseSnapshot(activeUserId);

    // Проверка превышения бюджета себестоимости (адаптивный даунгрейд вместо жесткого блока)
    const isBudgetExceeded =
      entitlements.costBudget > 0 &&
      snapshot.estimatedCostLastMonth >= entitlements.costBudget;

    // 2. Резолвинг модели и выбор стратегии исполнения (Token Economics & Tier Pipelines)
    let targetModel: ModelRegistryEntry;
    let routingReason: string;
    let pipelineStrategy: PipelineStrategy | null = null;
    const rawPrompt =
      [...req.messages].reverse().find((m) => m.role === 'user')?.content ?? '';
    const decodedPrompt = convertLayoutIfInverted(rawPrompt);
    const prompt = decodedPrompt;

    const activeWorkspace =
      req.workspaceContext ??
      req.messages.slice().reverse().find((m) => m.workspaceContext)?.workspaceContext;
    const activeAttachments =
      req.attachments ??
      req.messages.slice().reverse().find((m) => m.attachments && m.attachments.length > 0)?.attachments;

    const complexityContext: ComplexityContext = {
      history: req.messages.slice(0, -1),
      hasAttachments: Boolean(activeAttachments && activeAttachments.length > 0),
      hasWorkspace: Boolean(activeWorkspace),
    };

    if (req.modelId === 'auto') {
      pipelineStrategy = TierPipelineEngine.resolveStrategy(prompt, {
        userPlan: effectivePlan,
        monthlyCost: snapshot.estimatedCostLastMonth,
        monthlyBudget: entitlements.costBudget,
        random: this.aiConfig.random,
        registry: this.registry,
      });

      targetModel = this.registry.resolve(pipelineStrategy.targetModelId);
      routingReason = pipelineStrategy.reason;
    } else {
      const resolved = this.registry.resolve(req.modelId);
      if (isBudgetExceeded && resolved.tier === 'flagship') {
        targetModel = this.registry.resolve('ketner-mini');
        routingReason = `Budget protection: dynamically routed to ${targetModel.name} for fair usage`;
      } else {
        targetModel = resolved;
        const resolution = resolveEngineForModel(targetModel.id, prompt, complexityContext);
        if (
          [
            'gpt-6-astra',
            'claude-fable',
            'claude-3.5-sonnet',
            'gemini-2.5-pro',
            'gemini-pro',
            'gemini-3.8-flash',
            'grok-4.7',
          ].includes(targetModel.id)
        ) {
          routingReason = `${targetModel.name}: ${resolution.level} query routed to ${resolution.engineName}`;
        } else {
          routingReason = `Explicit user model selection (${targetModel.name})`;
        }
      }
    }

    // 3. Проверка прав доступа (Entitlement Check)
    const accessCheck = EntitlementService.checkModelAccess(targetModel, effectivePlan);
    if (!accessCheck.allowed) {
      const msg =
        language === 'en'
          ? `Access to ${targetModel.name} requires an active subscription (${accessCheck.requiredPlan} or Ultra). Please upgrade your plan.`
          : `Для доступа к модели ${targetModel.name} требуется подписка (${accessCheck.requiredPlan} или Ultra). Пожалуйста, улучшите ваш тариф.`;

      callbacks.onError({
        code: 'upgrade_required',
        message: msg,
      });
      return;
    }

    // 4. Проверка Fair Use и захват concurrency слота
    const decision = FairUseEngine.evaluate(snapshot, effectivePlan, language);

    if (decision.action === 'deny') {
      this.usageStore.recordUsage({
        userId: activeUserId,
        conversationId: req.conversationId,
        modelId: targetModel.id,
        provider: targetModel.provider,
        inputTokens: 0,
        outputTokens: 0,
        estimatedCost: 0,
        latencyMs: Date.now() - startTime,
        status: decision.code === 'concurrency_limit' ? 'concurrency_limited' : 'rate_limited',
        source: 'provider',
      });

      callbacks.onError({
        code: decision.code,
        message: decision.reason,
      });
      return;
    }

    if (decision.action === 'throttle') {
      await delay(decision.delayMs);
    }

    const releaseSlot = this.usageStore.acquireConcurrencySlot(activeUserId);

    try {
      // 5. Оптимизация контекста
      const maxContextMessages = Math.min(
        targetModel.contextMessages,
        entitlements.maxContextMessages,
        entitlements.contextLimit,
      );

      // Дифференциация системных промптов по тарифам и Brand Protection:
      // Free / Plus -> ECONOMY_SYSTEM_PROMPT (максимально краткие ответы)
      // Pro / Ultra -> DEFAULT_SYSTEM_PROMPT (глубокие ответы с рассуждениями)
      const isEconomyTier = effectivePlan === 'free' || effectivePlan === 'plus';
      const promptMap = isEconomyTier
        ? ECONOMY_SYSTEM_PROMPT
        : (targetModel.defaultSystemPrompt ?? DEFAULT_SYSTEM_PROMPT);
      const baseSystemPrompt = promptMap[language];
      const systemPrompt = isBudgetExceeded
        ? `${baseSystemPrompt} ${language === 'en' ? 'Keep responses concise and direct.' : 'Отвечай максимально кратко и по существу.'}`
        : baseSystemPrompt;

      let effectiveSystemPrompt = systemPrompt;
      if (activeWorkspace) {
        effectiveSystemPrompt += buildWorkspaceContextBlock(activeWorkspace, language);
      }
      if (activeAttachments && activeAttachments.length > 0) {
        effectiveSystemPrompt += buildAttachmentsBlock(activeAttachments, language);
      }

      let generatedSummary: string | undefined;
      const optimizedMessages = ContextOptimizer.optimize(
        req.messages.map((m, idx) => ({
          role: m.role as 'user' | 'assistant',
          content:
            idx === req.messages.length - 1 && m.role === 'user' && decodedPrompt !== rawPrompt
              ? decodedPrompt
              : m.content,
        })),
        {
          maxMessages: maxContextMessages,
          maxTokens: targetModel.contextWindow,
          systemPrompt: effectiveSystemPrompt,
          language,
          existingSummary: req.cachedSummary,
          onSummaryGenerated: (summary) => {
            generatedSummary = summary;
          },
        },
      );

      // 5.1. Проверка семантического кэша (Semantic & Query Caching)
      const userScope = effectivePlan === 'free' ? 'shared' : activeUserId;
      const historyHash = SemanticCache.computeHistoryHash(req.messages, 3);
      const hasAttachments = Boolean(activeAttachments && activeAttachments.length > 0);

      const cachedHit = !hasAttachments
        ? semanticCache.get(targetModel.id, language, prompt, userScope, historyHash)
        : null;

      if (cachedHit && !isCancelled()) {
        await streamText(cachedHit.response, {
          thinkingMs: [5, 10],
          chunkMs: [5, 10],
          random: this.aiConfig.random,
          isCancelled,
          onDelta: callbacks.onDelta,
        });

        const latencyMs = Date.now() - startTime;
        this.usageStore.recordUsage({
          userId: activeUserId,
          conversationId: req.conversationId,
          modelId: targetModel.id,
          provider: targetModel.provider,
          inputTokens: cachedHit.inputTokens,
          outputTokens: cachedHit.outputTokens,
          cachedTokens: cachedHit.inputTokens,
          estimatedCost: 0,
          actualCost: 0,
          latencyMs,
          status: 'success',
          source: 'cache',
        });

        if (!isCancelled()) {
          callbacks.onDone({
            inputTokens: cachedHit.inputTokens,
            outputTokens: cachedHit.outputTokens,
            selectedModel: { id: targetModel.id, name: targetModel.name },
            routingReason: `${routingReason} (Semantic Cache Hit)`,
            source: 'cache',
            finishReason: 'stop',
            canContinue: false,
          });
        }
        return;
      }

      // 6. Попытка генерации через провайдер с поддержкой Failover
      const modelsToTry = this.registry.getFallbackChain(targetModel.id);
      let success = false;
      let streamedResponse: ProviderResponse | null = null;
      let usedModel = targetModel;
      let doublePassCost = 0;

      const hasWorkspaceOrAttachments = Boolean(
        activeWorkspace ||
        (activeAttachments && activeAttachments.length > 0)
      );

      const dynamicMaxTokens = computeDynamicMaxTokens({
        userPlan: effectivePlan,
        monthlyCost: snapshot.estimatedCostLastMonth,
        monthlyBudget: entitlements.costBudget,
        baseTokens: hasWorkspaceOrAttachments
          ? Math.max(entitlements.maxTokens, 4096)
          : (pipelineStrategy?.maxOutputTokens ?? 1024),
      });

      // Если режим gpt_short — инструктируем модель отвечать кратко (<150 токенов)
      if (pipelineStrategy?.mode === 'gpt_short' && pipelineStrategy.promptModifier) {
        const lastMsg = optimizedMessages[optimizedMessages.length - 1];
        if (lastMsg && lastMsg.role === 'user') {
          const modText =
            typeof pipelineStrategy.promptModifier === 'string'
              ? pipelineStrategy.promptModifier
              : pipelineStrategy.promptModifier[language];
          lastMsg.content = `${modText}${lastMsg.content}`;
        }
      }

      const isTestEnv =
        process.env.NODE_ENV === 'test' ||
        this.aiConfig.failureRate > 0 ||
        (this.aiConfig.thinkingMs[0] === 0 &&
          this.aiConfig.thinkingMs[1] === 0 &&
          this.aiConfig.chunkMs[0] === 0 &&
          this.aiConfig.chunkMs[1] === 0);

      // 6.0. Двухпроходный пайплайн улучшения (Double Pass Enhancer: cheap draft -> GPT/cheap refine)
      if (
        pipelineStrategy &&
        !activeWorkspace &&
        !activeAttachments?.length &&
        (pipelineStrategy.mode === 'gpt_improve' || pipelineStrategy.mode === 'cheap_improve') &&
        !isTestEnv
      ) {
        const draftModel = this.registry.resolve(pipelineStrategy.draftModelId ?? 'deepseek-v4.1-flash');
        const enhancerModel = this.registry.resolve(pipelineStrategy.enhancerModelId ?? targetModel.id);
        let draftProvider = this.providers.get(draftModel.provider);
        let draftModelId = draftModel.providerModelId;
        if (!draftProvider || !draftProvider.isAvailable()) {
          const openRouterProvider = this.providers.get('openrouter');
          if (openRouterProvider?.isAvailable()) {
            draftProvider = openRouterProvider;
            draftModelId = toOpenRouterModelId(draftModel, prompt, complexityContext);
          }
        }

        let enhancerProvider = this.providers.get(enhancerModel.provider);
        let enhancerModelId = enhancerModel.providerModelId;
        if (!enhancerProvider || !enhancerProvider.isAvailable()) {
          const openRouterProvider = this.providers.get('openrouter');
          if (openRouterProvider?.isAvailable()) {
            enhancerProvider = openRouterProvider;
            enhancerModelId = toOpenRouterModelId(enhancerModel, prompt, complexityContext);
          }
        }

        if (draftProvider?.isAvailable() && enhancerProvider?.isAvailable()) {
          try {
            // Шаг 1: Быстрый черновик от дешёвой модели
            const draftRes = await draftProvider.generateText({
              model: draftModelId,
              messages: optimizedMessages,
              stream: false,
              maxTokens: Math.min(draftModel.maxOutputTokens, 1500),
            });

            if (draftRes.content && !isCancelled()) {
              // Шаг 2: Стриминг отполированного ответа пользователю
              // Во втором проходе передаём и вопрос пользователя, и черновик (Phase 1)
              const modText =
                pipelineStrategy.promptModifier
                  ? typeof pipelineStrategy.promptModifier === 'string'
                    ? pipelineStrategy.promptModifier
                    : pipelineStrategy.promptModifier[language]
                  : (language === 'ru'
                      ? 'Улучши этот ответ. Сделай его более чётким, структурированным и лаконичным:\n\n'
                      : 'Improve this answer. Make it clearer, structured and concise:\n\n');

              const enhanceInstruction =
                language === 'ru'
                  ? `Вопрос пользователя:\n${prompt}\n\nЧерновой ответ:\n${draftRes.content}\n\nИнструкция:\n${modText}`
                  : `User query:\n${prompt}\n\nDraft answer:\n${draftRes.content}\n\nInstruction:\n${modText}`;

              usedModel = enhancerModel;
              streamedResponse = await enhancerProvider.streamText(
                {
                  model: enhancerModelId,
                  messages: [
                    ...optimizedMessages.slice(0, -1),
                    { role: 'user', content: enhanceInstruction },
                  ],
                  stream: true,
                  maxTokens: Math.max(Math.min(enhancerModel.maxOutputTokens, entitlements.maxTokens), 2048),
                },
                {
                  onDelta: callbacks.onDelta,
                  isCancelled,
                },
              );

              if (streamedResponse && streamedResponse.content.length > 0) {
                // Суммируем токены и себестоимость обоих проходов (Phase 1)
                streamedResponse.usage.inputTokens += draftRes.usage.inputTokens;
                streamedResponse.usage.outputTokens += draftRes.usage.outputTokens;
                const draftCostResult = CostCalculator.calculate(
                  draftRes.usage,
                  draftModel.pricing,
                );
                doublePassCost = draftCostResult.totalCost;
                success = true;
              }
            }
          } catch (err) {
            console.warn('[ai-gateway] Double-pass failed, falling back to direct stream:', err);
          }
        }
      }

      // 6.1. Прямой стриминг модели (если double-pass не применялся или не удался)
      if (!isTestEnv && !success) {
        for (const candidateModel of modelsToTry) {
          if (isCancelled()) break;

          let provider = this.providers.get(candidateModel.provider);
          let modelToRequest = candidateModel.providerModelId;

          if (!provider || !provider.isAvailable()) {
            const openRouterProvider = this.providers.get('openrouter');
            if (openRouterProvider && openRouterProvider.isAvailable()) {
              provider = openRouterProvider;
              modelToRequest = toOpenRouterModelId(candidateModel, prompt, complexityContext);
            } else {
              continue;
            }
          }

          try {
            usedModel = candidateModel;
            // Лимит выходных токенов:
            // 1. При привязанном проекте или сложной задаче (код, рассуждения) отдаём полный объём модели и тарифа.
            // 2. Рассуждающие модели тратят до 1500 токенов только на <think>, поэтому лимит не может быть меньше 4096.
            // 3. dynamicMaxTokens применяется ТОЛЬКО при жёстком превышении бюджета (isBudgetExceeded) на простых запросах.
            let maxTokensToUse: number;
            if (hasWorkspaceOrAttachments || candidateModel.capabilities.reasoning || candidateModel.capabilities.coding) {
              maxTokensToUse = Math.min(candidateModel.maxOutputTokens, entitlements.maxTokens);
            } else if (isBudgetExceeded) {
              maxTokensToUse = dynamicMaxTokens;
            } else {
              maxTokensToUse = Math.min(candidateModel.maxOutputTokens, entitlements.maxTokens);
            }
            maxTokensToUse = Math.max(maxTokensToUse, 2048);

            streamedResponse = await provider.streamText(
              {
                model: modelToRequest,
                messages: optimizedMessages,
                stream: true,
                maxTokens: Math.min(candidateModel.maxOutputTokens, maxTokensToUse),
              },
              {
                onDelta: callbacks.onDelta,
                isCancelled,
              },
            );

            if (streamedResponse && streamedResponse.content.length > 0) {
              success = true;
              break;
            }
          } catch (providerError) {
            console.warn(
              `[ai-gateway] Провайдер ${candidateModel.provider} (модель ${candidateModel.name}) вернул ошибку:`,
              providerError,
            );
          }
        }
      }

      let fallbackContent = '';
      let responseSource: 'provider' | 'cache' | 'template' = 'provider';

      if (!success && !isCancelled()) {
        if (!isTestEnv) {
          // Phase 1: если все провайдеры упали в проде — честная ошибка, не списываем лимиты
          callbacks.onError({
            code: 'provider_error',
            message: ERROR_MESSAGES[language],
          });
          this.usageStore.recordUsage({
            userId: activeUserId,
            conversationId: req.conversationId,
            modelId: targetModel.id,
            provider: targetModel.provider,
            inputTokens: 0,
            outputTokens: 0,
            estimatedCost: 0,
            latencyMs: Date.now() - startTime,
            status: 'error',
            source: 'provider',
          });
          return;
        }

        // В test / dev режиме используем шаблонный генератор
        responseSource = 'template';
        const effectiveModelName =
          req.modelId && req.modelId !== 'auto'
            ? (targetModel?.name ?? 'DeepSeek V4.1 Flash')
            : 'DeepSeek V4.1 Flash';
        const templateAnswer = pickAnswer(
          prompt,
          language,
          this.aiConfig.random,
          effectiveModelName,
          activeAttachments ?? req.attachments,
          (activeWorkspace ?? req.workspaceContext) as any,
        );
        await streamText(templateAnswer, {
          thinkingMs: this.aiConfig.thinkingMs,
          chunkMs: this.aiConfig.chunkMs,
          random: this.aiConfig.random,
          isCancelled,
          onDelta: (delta) => {
            fallbackContent += delta;
            callbacks.onDelta(delta);
          },
        });

        streamedResponse = {
          content: fallbackContent,
          usage: {
            inputTokens: ContextOptimizer.estimateTokens(prompt),
            outputTokens: ContextOptimizer.estimateTokens(fallbackContent),
          },
          finishReason: isCancelled() ? 'cancelled' : 'stop',
        };
        success = true;
      }

      // 8. Подсчёт токенов, стоимости и запись в UsageStore
      const latencyMs = Date.now() - startTime;
      const inputTokens = streamedResponse?.usage.inputTokens ?? ContextOptimizer.estimateTokens(prompt);
      const outputTokens =
        streamedResponse?.usage.outputTokens ??
        ContextOptimizer.estimateTokens(streamedResponse?.content ?? '');

      const costResult = CostCalculator.calculate(
        {
          inputTokens,
          outputTokens,
          cachedTokens: streamedResponse?.usage.cachedTokens,
          reasoningTokens: streamedResponse?.usage.reasoningTokens,
        },
        usedModel.pricing,
      );
      const totalEstimatedCost = costResult.totalCost + doublePassCost;

      const finishReason: 'stop' | 'length' | 'cancelled' | 'error' =
        streamedResponse?.finishReason ?? (isCancelled() ? 'cancelled' : 'stop');
      const canContinue = finishReason === 'length';

      this.usageStore.recordUsage({
        userId: activeUserId,
        conversationId: req.conversationId,
        modelId: usedModel.id,
        provider: usedModel.provider,
        inputTokens,
        outputTokens,
        cachedTokens: streamedResponse?.usage.cachedTokens,
        reasoningTokens: streamedResponse?.usage.reasoningTokens,
        estimatedCost: totalEstimatedCost,
        actualCost: streamedResponse?.cost ?? null,
        latencyMs,
        status: isCancelled() ? 'cancelled' : 'success',
        source: responseSource,
      });

      if (!isCancelled()) {
        if (streamedResponse?.content) {
          semanticCache.set(
            targetModel.id,
            language,
            prompt,
            streamedResponse.content,
            {
              inputTokens,
              outputTokens,
            },
            {
              userScope,
              historyHash,
              source: responseSource,
              finishReason,
              hasAttachments,
            },
          );
        }
        callbacks.onDone({
          inputTokens,
          outputTokens,
          selectedModel: { id: usedModel.id, name: usedModel.name },
          routingReason,
          source: responseSource,
          finishReason,
          canContinue,
          contextSummary: generatedSummary,
        });
      }
    } catch (error) {
      console.error('[ai-gateway] Критическая ошибка генерации:', error);
      callbacks.onError({
        code: 'internal_error',
        message: ERROR_MESSAGES[language],
      });
    } finally {
      releaseSlot();
    }
  }
}
