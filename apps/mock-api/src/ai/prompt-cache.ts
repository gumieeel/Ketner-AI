/**
 * Кэш промпта у провайдеров: как он включается у каждого вендора и когда он вообще возможен.
 *
 * Кэш работает только на совпадающем ПРЕФИКСЕ запроса: системный промпт, контекст проекта и начало
 * истории должны уходить байт-в-байт одинаковыми от хода к ходу. Поэтому шлюз держит префикс
 * стабильным (контекст проекта без файлов «под вопрос», окно истории сдвигается шагами), а адаптер
 * провайдера расставляет точки кэша там, где вендор требует их явно.
 *
 *   anthropic — явные точки `cache_control` (до 4 на запрос), порог 4096 токенов у Opus и Haiku
 *               (короче — просто не кэшируется, без ошибки и доплаты). Чтение в 10 раз дешевле входа.
 *   google    — неявный кэш Gemini срабатывает не всегда; явную точку OpenRouter берёт только
 *               последнюю. Запись стоит как вход плюс хранение 5 минут, поэтому точка ставится только
 *               на длинный префикс (контекст проекта, длинная история), где чтение окупает хранение.
 *   openai, x-ai, deepseek, z-ai, moonshotai, qwen — кэшируют автоматически по префиксу от ~1024
 *               токенов, точки не нужны: достаточно стабильного префикса.
 */

export type PromptCacheMode = 'explicit' | 'explicit-last' | 'automatic' | 'none';

export interface PromptCachePolicy {
  mode: PromptCacheMode;
  /** Минимальная длина кэшируемого префикса, токенов. */
  minTokens: number;
}

const POLICIES: Readonly<Record<string, PromptCachePolicy>> = {
  anthropic: { mode: 'explicit', minTokens: 4096 },
  google: { mode: 'explicit-last', minTokens: 4096 },
  openai: { mode: 'automatic', minTokens: 1024 },
  'x-ai': { mode: 'automatic', minTokens: 1024 },
  deepseek: { mode: 'automatic', minTokens: 1024 },
  'z-ai': { mode: 'automatic', minTokens: 1024 },
  moonshotai: { mode: 'automatic', minTokens: 1024 },
  qwen: { mode: 'automatic', minTokens: 1024 },
};

const NO_CACHE: PromptCachePolicy = { mode: 'none', minTokens: Infinity };

/** Вендор движка OpenRouter: `anthropic/claude-opus-5.5` → `anthropic`. */
export function vendorOf(engineId: string): string {
  const slash = engineId.indexOf('/');
  return slash > 0 ? engineId.slice(0, slash).toLowerCase() : engineId.toLowerCase();
}

/** Политика кэша для движка. `:free`-эндпоинты не кэшируются (и платить там не за что). */
export function promptCachePolicy(engineId: string): PromptCachePolicy {
  if (engineId.trim().endsWith(':free')) return NO_CACHE;
  return POLICIES[vendorOf(engineId)] ?? NO_CACHE;
}

/** Ждём ли от модели кэшированных токенов в ответах (для проверки в админке). */
export function expectsPromptCache(engineId: string): boolean {
  return promptCachePolicy(engineId).mode !== 'none';
}

/**
 * Окно истории сдвигается не на каждом ходу, а шагом `HISTORY_WINDOW_STEP` сообщений: пока окно не
 * сдвинулось, история до предпоследнего сообщения совпадает с прошлым запросом и читается из кэша.
 * Окно держит от `HISTORY_RECENT_MIN` до `HISTORY_RECENT_MIN + HISTORY_WINDOW_STEP - 1` сообщений:
 * лишние сообщения почти бесплатны (они в кэше), а каждый сдвиг стоит одной записи кэша.
 */
export const HISTORY_RECENT_MIN = 8;
export const HISTORY_WINDOW_STEP = 6;

/**
 * Начало окна последних сообщений для истории длиной `total` (индекс в истории, не меньше 1:
 * первое сообщение уходит отдельно как якорь темы).
 */
export function alignedWindowStart(total: number, recentMin: number, maxMessages: number): number {
  const naive = Math.max(1, total - recentMin);
  const aligned = Math.max(1, Math.floor(naive / HISTORY_WINDOW_STEP) * HISTORY_WINDOW_STEP);
  // Окно не может быть длиннее лимита контекста тарифа: тогда сдвигаемся по одному сообщению.
  return total - aligned > maxMessages ? naive : aligned;
}
