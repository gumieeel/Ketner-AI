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
import { modelRegistry, ECONOMY_SYSTEM_PROMPT, DEFAULT_SYSTEM_PROMPT, } from './model-registry.js';
import { providerManager } from './providers/provider-factory.js';
import { delay, streamText } from './stream.js';
import { CostCalculator } from '../services/cost.js';
import { EntitlementService } from '../services/entitlement.js';
import { FairUseEngine } from '../services/fair-use.js';
import { AutoRouter } from './auto-router.js';
import { TierPipelineEngine, computeDynamicMaxTokens, } from './tier-pipeline.js';
import { CircuitBreaker, defaultCircuitBreaker } from './circuit-breaker.js';
import { PayloadGuard } from './payload-guard.js';
export function classifyPromptComplexity(prompt, context) {
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
    const historyIsComplex = Boolean(context?.history &&
        context.history.length > 0 &&
        context.history.slice(-4).some((m) => {
            const text = m.content || '';
            return (text.length > 250 ||
                /```|function|class|interface|import|export|select|def |const |let |error|exception/i.test(text));
        }));
    const hasCodeOrTechnicalSyntax = /```|<pre>|SELECT\s+[\s\S]*?\s+FROM|INSERT\s+INTO|UPDATE\s+[\s\S]*?SET|CREATE\s+TABLE|function\s*\(|def\s+\w+\(|class\s+\w+|const\s+\w+\s*=|let\s+\w+\s*=|import\s+[\s\S]*?from|export\s+(default|const|class)|interface\s+\w+/i.test(trimmed);
    // 1. "Прям лёгкие вопросы": приветствия, благодарности, подтверждения, короткие реплики
    const isGreetingOrChitChat = /^(привет|хай|здравствуй|добр(ое|ый|ый день|ое утро|ый вечер)|hello|hi|hey|как дела|кто ты|что ты умеешь|спасибо|благодарю|ок|ok|ясно|понятно)[\s!?,.]*$/i.test(trimmed);
    const isTrivialGeneral = trimmed.length < 50 &&
        classification.complexity === 'simple' &&
        classification.category === 'general' &&
        !/(напиши|составь|придумай|объясни|расскажи|переведи|write|explain|translate|код|функци)/i.test(trimmed);
    if ((isGreetingOrChitChat || isTrivialGeneral) && !historyIsComplex && !hasCodeOrTechnicalSyntax) {
        return { level: 'simple', category: classification.category };
    }
    // 2. Сложные задачи: глубокий код, математика, архитектура, системный дизайн, длинные формулировки (>500 символов)
    const isComplex = classification.complexity === 'complex' ||
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
export function resolveEngineForModel(modelId, prompt, context) {
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
    if (modelId === 'gemini-2.5-pro' ||
        modelId === 'gemini-pro' ||
        modelId === 'gemini-3.8-flash') {
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
export function resolveAstraEngine(prompt, context) {
    return resolveEngineForModel('gpt-6-astra', prompt, context);
}
export function toOpenRouterModelId(model, prompt, context) {
    const resolution = resolveEngineForModel(model.id, prompt, context);
    if (resolution.modelId !== model.id) {
        return resolution.modelId;
    }
    if (model.provider === 'openai')
        return `openai/${model.providerModelId}`;
    if (model.provider === 'anthropic')
        return `anthropic/${model.providerModelId}`;
    if (model.provider === 'google')
        return `google/${model.providerModelId}`;
    return model.providerModelId;
}
function prioritizeWorkspaceFiles(files) {
    const highPriority = [
        /^package\.json$/i,
        /^tsconfig.*\.json$/i,
        /^(src\/|apps\/[^\/]+\/src\/)?(index|main|server|app)\.(ts|tsx|js|jsx)$/i,
        /routes/i,
        /(schema|models|store|service)/i,
        /^README\.md$/i,
    ];
    return [...files].sort((a, b) => {
        const aMatch = highPriority.some((p) => p.test(a.path));
        const bMatch = highPriority.some((p) => p.test(b.path));
        if (aMatch && !bMatch)
            return -1;
        if (!aMatch && bMatch)
            return 1;
        return (a.path || '').localeCompare(b.path || '');
    });
}
function buildWorkspaceContextBlock(ws, language) {
    const isEn = language === 'en';
    const typeLabel = ws.type === 'git_repo'
        ? (isEn ? 'GitHub Repository' : 'GitHub-репозиторий')
        : (isEn ? 'Local Project Folder' : 'Локальная папка проекта');
    let block = isEn
        ? `\n\n[ATTACHED WORKSPACE CONTEXT: ${typeLabel} "${ws.name}"]\nSource: ${ws.pathOrUrl || ws.name}${ws.branch ? ` (branch: ${ws.branch})` : ''}\nTotal Files Indexed: ${ws.filesCount || ws.files?.length || 0}\n`
        : `\n\n[КОНТЕКСТ ПРИВЯЗАННОГО ПРОЕКТА: ${typeLabel} «${ws.name}»]\nИсточник: ${ws.pathOrUrl || ws.name}${ws.branch ? ` (ветка: ${ws.branch})` : ''}\nВсего проиндексировано файлов: ${ws.filesCount || ws.files?.length || 0}\n`;
    if (Array.isArray(ws.files) && ws.files.length > 0) {
        block += isEn ? '\nProject File Tree:\n' : '\nДерево файлов проекта:\n';
        const treePreview = ws.files
            .slice(0, 80)
            .map((f) => `- ${f.path}${f.size ? ` (${Math.round((f.size / 1024) * 10) / 10} KB)` : ''}`)
            .join('\n');
        block += treePreview;
        if (ws.files.length > 80) {
            block += isEn ? `\n... and ${ws.files.length - 80} more files` : `\n... и ещё ${ws.files.length - 80} файлов`;
        }
        block += '\n';
        const rawFilesWithContent = ws.files.filter((f) => typeof f.content === 'string' && f.content.trim().length > 0);
        const filesWithContent = prioritizeWorkspaceFiles(rawFilesWithContent);
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
        ? `\nIMPORTANT AGENTIC INSTRUCTIONS FOR WORKSPACE WORK:
- You are acting as Ketner AI Engine — a senior autonomous full-stack software engineer directly embedded in this project.
- YOU HAVE FULL ACCESS TO THIS CODEBASE. The file tree and source code are provided above.
- NEVER SAY: "I cannot edit files", "I am only an AI text model", "I have no access to your filesystem or repository". Your environment has an automated file-action execution runtime that captures your \`\`\`file-actions blocks and applies them directly to the user's disk and GitHub!
- NEVER HALLUCINATE: NEVER say "I already pushed to main" or make up fake commit URLs. Always state: "I have prepared the changes in the card below. Click [Apply to Project] or [Apply to GitHub] to commit them."
- When asked to analyze the project, check readiness, or find bugs:
  1) Base your analysis ONLY on the actual code, imports, and dependencies above. Do NOT invent libraries that do not exist in package.json.
  2) Give deep, precise technical answers: reference exact file paths, line numbers, function names, and root causes of bugs.
  3) If you find bugs or missing features, explain the problem and immediately provide complete, ready-to-use fixes.
- When creating, modifying, editing, or replacing files in the workspace:
  Always include structured \`\`\`file-actions blocks in your response so the client UI can render a visual Diff Viewer and apply them:
  \`\`\`file-actions
  [
    {
      "action": "write",
      "path": "path/to/file.ts",
      "description": "Short summary of changes",
      "content": "Full content of the file"
    }
  ]
  \`\`\`
  Or for targeted replacements in existing files:
  \`\`\`file-actions
  [
    {
      "action": "replace",
      "path": "path/to/file.ts",
      "description": "Short summary of replacement",
      "targetContent": "exact existing code snippet to replace",
      "replacementContent": "new replacement code snippet"
    }
  ]
  \`\`\`
- Always provide COMPLETE, syntactically valid code. Never cut off code with comments like "// ... rest of code unchanged ...", because that breaks compilation.
- Never truncate or cut off your answer. Use clean Markdown headers and code blocks.
- If the user prompt is typed in an incorrect keyboard layout (e.g. "ghjfyfkbpbhqe htgjpbnjhbq" for "проанализируй репозиторий"), automatically recognize the intended meaning and respond in the appropriate language.`
        : `\nВАЖНЫЕ ИНЖЕНЕРНЫЕ ИНСТРУКЦИИ ДЛЯ РАБОТЫ С ПРОЕКТОМ:
- Ты работаешь как Ketner AI Engine — ведущий инженерный AI-ассистент, напрямую подключённый к кодовой базе этого проекта.
- У ТЕБЯ ЕСТЬ ПОЛНЫЙ ДОСТУП К ЭТОМУ ПРОЕКТУ. Все файлы и дерево проекта переданы тебе выше.
- КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО писать: «у меня нет доступа к файлам», «я всего лишь языковая модель и не могу менять файлы», «я не могу запускать команды». Веб-интерфейс Ketner AI оснащён автоматическим движком записи: он перехватывает твои блоки \`\`\`file-actions и записывает их на диск или отправляет коммитом в GitHub! Ты ОБЯЗАН при любых просьбах изменить или создать код формировать блок \`\`\`file-actions!
- КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО ВРАТЬ: никогда не говори «Я уже запушил изменения в main» и не выдумывай ссылки на несуществующие коммиты. Всегда говори правду: «Я подготовил изменения ниже. Нажмите [Применить к проекту] (или [Применить к GitHub]), чтобы сохранить их».
- При запросе анализа проекта, готовности к продакшну или поиске ошибок:
  1) Опирайся ИСКЛЮЧИТЕЛЬНО на реальный код и файлы из контекста выше (не выдумывай несуществующие базы или пакеты, которых нет в package.json).
  2) Давай глубокий инженерный разбор: указывай точные пути файлов, названия функций, существующие роуты и коренные причины (root cause) ошибок.
  3) Если находишь баг или недостающую логику — сразу предлагай готовое рабочее исправление в блоке \`\`\`file-actions.
- При создании, перезаписи, модификации или редактировании файлов в проекте:
  Обязательно приводи изменения в виде структурированного блока \`\`\`file-actions, чтобы веб-интерфейс отобразил визуальный Diff Viewer и позволил пользователю применить правки на локальный диск или закоммитить/создать PR в GitHub в один клик:
  \`\`\`file-actions
  [
    {
      "action": "write",
      "path": "src/utils/example.ts",
      "description": "Краткое описание создаваемого или перезаписываемого файла",
      "content": "Полное новое содержимое файла"
    }
  ]
  \`\`\`
  Или для точечной замены блока кода в существующем файле:
  \`\`\`file-actions
  [
    {
      "action": "replace",
      "path": "src/utils/example.ts",
      "description": "Краткое описание замены",
      "targetContent": "точный фрагмент существующего кода для замены",
      "replacementContent": "новый фрагмент заменяющего кода"
    }
  ]
  \`\`\`
- Всегда генерируй ПОЛНЫЙ, рабочий и компилируемый код без плейсхолдеров вроде «// ... остальной код без изменений ...», которые ломают проект.
- Никогда не обрывай ответ на полуслове. Используй качественное Markdown-форматирование, списки и блоки кода.
- Если запрос пользователя набран в ошибочной раскладке (например, «ghjfyfkbpbhqe htgjpbnjhbq» вместо «проанализируй репозиторий»), автоматически распознай смысл и ответь на русском языке по существу.`;
    return block;
}
const JCUKEN_MAP = {
    q: 'й', w: 'ц', e: 'у', r: 'к', t: 'е', y: 'н', u: 'г', i: 'ш', o: 'щ', p: 'з', '[': 'х', ']': 'ъ',
    a: 'ф', s: 'ы', d: 'в', f: 'а', g: 'п', h: 'р', j: 'о', k: 'л', l: 'д', ';': 'ж', "'": 'э',
    z: 'я', x: 'ч', c: 'с', v: 'м', b: 'и', n: 'т', m: 'ь', ',': 'б', '.': 'ю', '`': 'ё',
    Q: 'Й', W: 'Ц', E: 'У', R: 'К', T: 'Е', Y: 'Н', U: 'Г', I: 'Ш', O: 'Щ', P: 'З', '{': 'Х', '}': 'Ъ',
    A: 'Ф', S: 'Ы', D: 'В', F: 'А', G: 'П', H: 'Р', J: 'О', K: 'Л', L: 'Д', ':': 'Ж', '"': 'Э',
    Z: 'Я', X: 'Ч', C: 'С', V: 'М', B: 'И', N: 'Т', M: 'Ь', '<': 'Б', '>': 'Ю', '~': 'Ё',
};
export function convertLayoutIfInverted(input) {
    if (!input || input.trim().length === 0)
        return input;
    const hasLatin = /[a-zA-Z]/.test(input);
    const hasCyrillic = /[а-яА-ЯёЁ]/.test(input);
    if (!hasLatin || hasCyrillic)
        return input;
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
function buildAttachmentsBlock(attachments, language) {
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
export class AIGateway {
    registry;
    providers;
    usageStore;
    aiConfig;
    circuitBreaker;
    constructor(deps) {
        this.registry = deps.registry ?? modelRegistry;
        this.providers = deps.providers ?? providerManager;
        this.usageStore = deps.usageStore;
        this.aiConfig = deps.aiConfig;
        this.circuitBreaker = deps.circuitBreaker ?? defaultCircuitBreaker;
    }
    getCircuitBreaker() {
        return this.circuitBreaker;
    }
    /**
     * Стриминговая генерация ответа через AI Gateway.
     */
    async stream(req, callbacks, isCancelled) {
        const startTime = Date.now();
        const activeUserId = req.userId;
        const language = req.language;
        // 0. Payload Guard (Phase 5: валидация размера сообщений и вложений)
        const guardResult = PayloadGuard.validate(req.messages, {
            language,
            attachments: req.attachments,
        });
        if (!guardResult.valid) {
            callbacks.onError({
                code: guardResult.code ?? 'payload_too_large',
                message: guardResult.message ?? ERROR_MESSAGES[language],
            });
            return;
        }
        const clientAbortController = new AbortController();
        if (req.signal) {
            if (req.signal.aborted) {
                clientAbortController.abort();
            }
            else {
                req.signal.addEventListener('abort', () => clientAbortController.abort(), { once: true });
            }
        }
        const combinedIsCancelled = () => isCancelled() || clientAbortController.signal.aborted;
        // 1. Определение эффективного плана и лимитов
        // Примечание: req.userPlan предварительно резолвится с учётом VIP-элевации (isVipUser -> 'ultra')
        // upstream в chat.ts перед вызовом gateway.stream().
        // EntitlementService.resolveEffectivePlan повторно валидирует план, учитывая переданные
        // req.userEmail и req.isVip, и обеспечивает надёжный fallback на 'free'.
        const effectivePlan = EntitlementService.resolveEffectivePlan(req.userPlan, req.userEmail, req.isVip);
        const entitlements = EntitlementService.getEntitlements(effectivePlan);
        const snapshot = this.usageStore.getFairUseSnapshot(activeUserId);
        // Проверка превышения бюджета себестоимости (адаптивный даунгрейд вместо жесткого блока)
        const isBudgetExceeded = entitlements.costBudget > 0 &&
            snapshot.estimatedCostLastMonth >= entitlements.costBudget;
        // 2. Резолвинг модели и выбор стратегии исполнения (Token Economics & Tier Pipelines)
        let targetModel;
        let routingReason;
        let pipelineStrategy = null;
        const rawPrompt = [...req.messages].reverse().find((m) => m.role === 'user')?.content ?? '';
        const decodedPrompt = convertLayoutIfInverted(rawPrompt);
        const prompt = decodedPrompt;
        const activeWorkspace = req.workspaceContext ??
            req.messages.slice().reverse().find((m) => m.workspaceContext)?.workspaceContext;
        const activeAttachments = req.attachments ??
            req.messages.slice().reverse().find((m) => m.attachments && m.attachments.length > 0)?.attachments;
        const complexityContext = {
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
        }
        else {
            const resolved = this.registry.resolve(req.modelId);
            if (isBudgetExceeded && resolved.tier === 'flagship') {
                targetModel = this.registry.resolve('ketner-mini');
                routingReason = `Budget protection: dynamically routed to ${targetModel.name} for fair usage`;
            }
            else {
                targetModel = resolved;
                const resolution = resolveEngineForModel(targetModel.id, prompt, complexityContext);
                if ([
                    'gpt-6-astra',
                    'claude-fable',
                    'claude-3.5-sonnet',
                    'gemini-2.5-pro',
                    'gemini-pro',
                    'gemini-3.8-flash',
                    'grok-4.7',
                ].includes(targetModel.id)) {
                    routingReason = `${targetModel.name}: ${resolution.level} query routed to ${resolution.engineName}`;
                }
                else {
                    routingReason = `Explicit user model selection (${targetModel.name})`;
                }
            }
        }
        // 3. Проверка прав доступа (Entitlement Check)
        const accessCheck = EntitlementService.checkModelAccess(targetModel, effectivePlan);
        if (!accessCheck.allowed) {
            const msg = language === 'en'
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
            const maxContextMessages = Math.min(targetModel.contextMessages, entitlements.maxContextMessages, entitlements.contextLimit);
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
            let generatedSummary;
            const optimizedMessages = ContextOptimizer.optimize(req.messages.map((m, idx) => ({
                role: m.role,
                content: idx === req.messages.length - 1 && m.role === 'user' && decodedPrompt !== rawPrompt
                    ? decodedPrompt
                    : m.content,
            })), {
                maxMessages: maxContextMessages,
                maxTokens: targetModel.contextWindow,
                systemPrompt: effectiveSystemPrompt,
                language,
                existingSummary: req.cachedSummary,
                onSummaryGenerated: (summary) => {
                    generatedSummary = summary;
                },
            });
            // 5.1. Проверка семантического кэша (Semantic & Query Caching)
            const userScope = effectivePlan === 'free' ? 'shared' : activeUserId;
            const historyHash = SemanticCache.computeHistoryHash(req.messages, 3);
            const hasAttachments = Boolean(activeAttachments && activeAttachments.length > 0);
            const cachedHit = !hasAttachments
                ? semanticCache.get(targetModel.id, language, prompt, userScope, historyHash)
                : null;
            if (cachedHit && !isCancelled()) {
                let cacheTtft = null;
                await streamText(cachedHit.response, {
                    thinkingMs: [5, 10],
                    chunkMs: [5, 10],
                    random: this.aiConfig.random,
                    isCancelled,
                    onDelta: (delta) => {
                        if (cacheTtft === null) {
                            cacheTtft = Date.now() - startTime;
                        }
                        callbacks.onDelta(delta);
                    },
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
                    ttftMs: cacheTtft,
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
            let streamedResponse = null;
            let usedModel = targetModel;
            let doublePassCost = 0;
            let firstTokenMs = null;
            const hasWorkspaceOrAttachments = Boolean(activeWorkspace ||
                (activeAttachments && activeAttachments.length > 0));
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
                    const modText = typeof pipelineStrategy.promptModifier === 'string'
                        ? pipelineStrategy.promptModifier
                        : pipelineStrategy.promptModifier[language];
                    lastMsg.content = `${modText}${lastMsg.content}`;
                }
            }
            const isTestEnv = process.env.NODE_ENV === 'test' ||
                this.aiConfig.failureRate > 0 ||
                (this.aiConfig.thinkingMs[0] === 0 &&
                    this.aiConfig.thinkingMs[1] === 0 &&
                    this.aiConfig.chunkMs[0] === 0 &&
                    this.aiConfig.chunkMs[1] === 0);
            // 6.0. Двухпроходный пайплайн улучшения (Double Pass Enhancer: cheap draft -> GPT/cheap refine)
            if (pipelineStrategy &&
                !activeWorkspace &&
                !activeAttachments?.length &&
                (pipelineStrategy.mode === 'gpt_improve' || pipelineStrategy.mode === 'cheap_improve') &&
                !isTestEnv) {
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
                            const modText = pipelineStrategy.promptModifier
                                ? typeof pipelineStrategy.promptModifier === 'string'
                                    ? pipelineStrategy.promptModifier
                                    : pipelineStrategy.promptModifier[language]
                                : (language === 'ru'
                                    ? 'Улучши этот ответ. Сделай его более чётким, структурированным и лаконичным:\n\n'
                                    : 'Improve this answer. Make it clearer, structured and concise:\n\n');
                            const enhanceInstruction = language === 'ru'
                                ? `Вопрос пользователя:\n${prompt}\n\nЧерновой ответ:\n${draftRes.content}\n\nИнструкция:\n${modText}`
                                : `User query:\n${prompt}\n\nDraft answer:\n${draftRes.content}\n\nInstruction:\n${modText}`;
                            usedModel = enhancerModel;
                            streamedResponse = await enhancerProvider.streamText({
                                model: enhancerModelId,
                                messages: [
                                    ...optimizedMessages.slice(0, -1),
                                    { role: 'user', content: enhanceInstruction },
                                ],
                                stream: true,
                                maxTokens: Math.max(Math.min(enhancerModel.maxOutputTokens, entitlements.maxTokens), 2048),
                            }, {
                                onDelta: (delta) => {
                                    if (firstTokenMs === null) {
                                        firstTokenMs = Date.now() - startTime;
                                    }
                                    callbacks.onDelta(delta);
                                },
                                isCancelled,
                            });
                            if (streamedResponse && streamedResponse.content.length > 0) {
                                // Суммируем токены и себестоимость обоих проходов (Phase 1)
                                streamedResponse.usage.inputTokens += draftRes.usage.inputTokens;
                                streamedResponse.usage.outputTokens += draftRes.usage.outputTokens;
                                const draftCostResult = CostCalculator.calculate(draftRes.usage, draftModel.pricing);
                                doublePassCost = draftCostResult.totalCost;
                                success = true;
                            }
                        }
                    }
                    catch (err) {
                        console.warn('[ai-gateway] Double-pass failed, falling back to direct stream:', err);
                    }
                }
            }
            // 6.1. Прямой стриминг модели (если double-pass не применялся или не удался)
            if (!isTestEnv && !success) {
                for (const candidateModel of modelsToTry) {
                    if (combinedIsCancelled())
                        break;
                    let provider = this.providers.get(candidateModel.provider);
                    let modelToRequest = candidateModel.providerModelId;
                    if (!provider || !provider.isAvailable()) {
                        const openRouterProvider = this.providers.get('openrouter');
                        if (openRouterProvider && openRouterProvider.isAvailable()) {
                            provider = openRouterProvider;
                            modelToRequest = toOpenRouterModelId(candidateModel, prompt, complexityContext);
                        }
                        else {
                            continue;
                        }
                    }
                    const activeProviderType = provider.type;
                    // Phase 5: Проверка Circuit Breaker для провайдера
                    if (this.circuitBreaker.isOpen(activeProviderType)) {
                        console.warn(`[ai-gateway] Circuit breaker OPEN для ${activeProviderType}, быстрый переход к следующему fallback`);
                        continue;
                    }
                    const providerTimeoutMs = req.providerTimeoutMs ?? 25_000;
                    const attemptController = new AbortController();
                    const timeoutId = setTimeout(() => {
                        attemptController.abort(new Error(`Timeout: provider ${activeProviderType} call timed out after ${providerTimeoutMs}ms`));
                    }, providerTimeoutMs);
                    const abortHandler = () => attemptController.abort();
                    if (clientAbortController.signal.aborted) {
                        attemptController.abort();
                    }
                    else {
                        clientAbortController.signal.addEventListener('abort', abortHandler, { once: true });
                    }
                    try {
                        usedModel = candidateModel;
                        // Лимит выходных токенов:
                        // 1. При привязанном проекте или сложной задаче (код, рассуждения) отдаём полный объём модели и тарифа.
                        // 2. Рассуждающие модели тратят до 1500 токенов только на <think>, поэтому лимит не может быть меньше 4096.
                        // 3. dynamicMaxTokens применяется ТОЛЬКО при жёстком превышении бюджета (isBudgetExceeded) на простых запросах.
                        let maxTokensToUse;
                        if (hasWorkspaceOrAttachments || candidateModel.capabilities.reasoning || candidateModel.capabilities.coding) {
                            maxTokensToUse = Math.min(candidateModel.maxOutputTokens, entitlements.maxTokens);
                        }
                        else if (isBudgetExceeded) {
                            maxTokensToUse = dynamicMaxTokens;
                        }
                        else {
                            maxTokensToUse = Math.min(candidateModel.maxOutputTokens, entitlements.maxTokens);
                        }
                        maxTokensToUse = Math.max(maxTokensToUse, 2048);
                        streamedResponse = await provider.streamText({
                            model: modelToRequest,
                            messages: optimizedMessages,
                            stream: true,
                            maxTokens: Math.min(candidateModel.maxOutputTokens, maxTokensToUse),
                            signal: attemptController.signal,
                        }, {
                            onDelta: (delta) => {
                                if (firstTokenMs === null) {
                                    firstTokenMs = Date.now() - startTime;
                                }
                                callbacks.onDelta(delta);
                            },
                            isCancelled: () => combinedIsCancelled() || attemptController.signal.aborted,
                        });
                        clearTimeout(timeoutId);
                        clientAbortController.signal.removeEventListener('abort', abortHandler);
                        if (streamedResponse && streamedResponse.content.length > 0) {
                            this.circuitBreaker.recordSuccess(activeProviderType);
                            success = true;
                            break;
                        }
                        else {
                            this.circuitBreaker.recordFailure(activeProviderType, new Error('Empty response from provider'));
                        }
                    }
                    catch (providerError) {
                        clearTimeout(timeoutId);
                        clientAbortController.signal.removeEventListener('abort', abortHandler);
                        this.circuitBreaker.recordFailure(activeProviderType, providerError);
                        console.warn(`[ai-gateway] Провайдер ${activeProviderType} (модель ${candidateModel.name}) вернул ошибку:`, providerError);
                    }
                }
            }
            let fallbackContent = '';
            let responseSource = 'provider';
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
                const effectiveModelName = req.modelId && req.modelId !== 'auto'
                    ? (targetModel?.name ?? 'DeepSeek V4.1 Flash')
                    : 'DeepSeek V4.1 Flash';
                const templateAnswer = pickAnswer(prompt, language, this.aiConfig.random, effectiveModelName, activeAttachments ?? req.attachments, (activeWorkspace ?? req.workspaceContext));
                await streamText(templateAnswer, {
                    thinkingMs: this.aiConfig.thinkingMs,
                    chunkMs: this.aiConfig.chunkMs,
                    random: this.aiConfig.random,
                    isCancelled,
                    onDelta: (delta) => {
                        if (firstTokenMs === null) {
                            firstTokenMs = Date.now() - startTime;
                        }
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
            const outputTokens = streamedResponse?.usage.outputTokens ??
                ContextOptimizer.estimateTokens(streamedResponse?.content ?? '');
            const costResult = CostCalculator.calculate({
                inputTokens,
                outputTokens,
                cachedTokens: streamedResponse?.usage.cachedTokens,
                reasoningTokens: streamedResponse?.usage.reasoningTokens,
            }, usedModel.pricing);
            const totalEstimatedCost = costResult.totalCost + doublePassCost;
            const finishReason = streamedResponse?.finishReason ?? (isCancelled() ? 'cancelled' : 'stop');
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
                ttftMs: firstTokenMs,
                status: isCancelled() ? 'cancelled' : 'success',
                source: responseSource,
            });
            if (!isCancelled()) {
                if (streamedResponse?.content) {
                    semanticCache.set(targetModel.id, language, prompt, streamedResponse.content, {
                        inputTokens,
                        outputTokens,
                    }, {
                        userScope,
                        historyHash,
                        source: responseSource,
                        finishReason,
                        hasAttachments,
                    });
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
        }
        catch (error) {
            console.error('[ai-gateway] Критическая ошибка генерации:', error);
            callbacks.onError({
                code: 'internal_error',
                message: ERROR_MESSAGES[language],
            });
        }
        finally {
            releaseSlot();
        }
    }
}
