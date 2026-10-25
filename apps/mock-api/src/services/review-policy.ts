/**
 * Правила проверки ответов другой моделью: кто проверяет и сколько проверок в сутки.
 *
 * Смысл проверки — взгляд модели ДРУГОЙ компании: у моделей одного разработчика общие данные
 * обучения и общие слепые зоны, поэтому GPT, проверяющий GPT, пропускает те же ошибки. Рецензент
 * выбирается из списка тарифа, и модели того же разработчика, что и автор ответа, пропускаются.
 *
 * Проверки (ответа в чате, ревью кода и судья сравнения) считаются одним суточным лимитом и не
 * тратят лимит модели-рецензента. Деньги при этом учитываются как обычно: стоимость идёт в
 * месячный бюджет тарифа, а сильные модели расходуют квоту премиум-запросов. Поэтому в каждом
 * списке последней стоит рабочая модель: когда квота кончилась, проверку делает она.
 */

import type { ModelRegistryEntry } from '../ai/gateway-types.js';
import { disclosureOf } from '../ai/model-disclosure.js';
import { planRank } from './entitlement.js';

/** Проверок в сутки по рангу тарифа (Free, Plus, Pro, Ultra). */
const DAILY_REVIEWS_BY_RANK: readonly number[] = [2, 10, 30, 80];

export function dailyReviewLimit(plan: string | null | undefined): number {
  return DAILY_REVIEWS_BY_RANK[planRank(plan)] ?? DAILY_REVIEWS_BY_RANK[0];
}

/**
 * Рецензенты по рангу тарифа, в порядке предпочтения. Все модели списка доступны на этом тарифе
 * (requiredPlan не выше), иначе шлюз ответил бы `upgrade_required`.
 */
const REVIEWERS_BY_RANK: readonly (readonly string[])[] = [
  // Free: дешёвые модели; бесплатный эндпоинт — запасной.
  ['ketner-mini', 'nemotron-ultra', 'north-mini-code'],
  // Plus: быстрые модели разных компаний.
  ['claude-haiku-5.5', 'gemini-3.7-flash', 'gpt-5.6-luna-pro', 'deepseek-v4.1-flash', 'ketner-pro'],
  // Pro и Ultra: сильные модели, затем рабочие на случай исчерпанной премиум-квоты.
  [
    'claude-sonnet-5.5',
    'gpt-6.1-sol',
    'grok-4.7',
    'gemini-3.7-flash',
    'claude-haiku-5.5',
    'gpt-5.6-luna-pro',
  ],
  [
    'claude-sonnet-5.5',
    'gpt-6.1-sol',
    'grok-4.7',
    'gemini-3.7-flash',
    'claude-haiku-5.5',
    'gpt-5.6-luna-pro',
  ],
];

/** Компания-разработчик модели (`openai/gpt-6-luna` → OpenAI); у Auto разработчика нет. */
export function developerOf(entry: Pick<ModelRegistryEntry, 'providerModelId' | 'name'>): string {
  return disclosureOf(entry)?.developer ?? '';
}

export interface ReviewerCandidate {
  entry: ModelRegistryEntry;
  developer: string;
}

interface RegistryLike {
  get(id: string): ModelRegistryEntry | undefined;
}

/**
 * Рецензенты для ответа: модели тарифа, кроме моделей тех же разработчиков, что авторы ответа.
 * Если все модели списка от тех же компаний (сравнение четырёх разработчиков), берётся список
 * целиком: проверка лучше, чем отказ, а в интерфейсе видно, кто проверял.
 */
export function pickReviewers(
  plan: string | null | undefined,
  authorModelIds: readonly string[],
  registry: RegistryLike,
): ReviewerCandidate[] {
  const list = REVIEWERS_BY_RANK[planRank(plan)] ?? REVIEWERS_BY_RANK[0];
  const authors = new Set(
    authorModelIds
      .map((id) => registry.get(id))
      .filter((entry): entry is ModelRegistryEntry => Boolean(entry))
      .map((entry) => developerOf(entry))
      .filter((developer) => developer !== ''),
  );
  const available = list
    .map((id) => registry.get(id))
    .filter((entry): entry is ModelRegistryEntry => Boolean(entry?.enabled))
    .map((entry) => ({ entry, developer: developerOf(entry) }));
  const foreign = available.filter((candidate) => !authors.has(candidate.developer));
  return foreign.length > 0 ? foreign : available;
}
