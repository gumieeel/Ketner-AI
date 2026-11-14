import type { Language } from '../types.js';
import type { ModelRegistryEntry } from './gateway-types.js';

/**
 * Прозрачность моделей: кто разработал модель и какая модель стоит за названием в Ketner AI.
 *
 * Ketner AI не обучает собственных моделей: каждый ответ даёт модель стороннего разработчика,
 * подключённая через OpenRouter (или напрямую через API вендора). Это знание нужно в трёх местах:
 * каталог `/api/meta` (страница /models и выбор модели), системный промпт (модель не должна
 * выдавать себя за разработку Ketner AI) и документация. Источник — `providerModelId` реестра,
 * второго списка нет.
 */

/** Разработчик по префиксу идентификатора OpenRouter (`openai/gpt-6-luna` → OpenAI). */
const DEVELOPERS: Readonly<Record<string, string>> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google',
  'x-ai': 'xAI',
  deepseek: 'DeepSeek',
  xiaomi: 'Xiaomi',
  'z-ai': 'Z.ai',
  qwen: 'Alibaba (Qwen)',
  nvidia: 'NVIDIA',
  cohere: 'Cohere',
  moonshotai: 'Moonshot AI',
  minimax: 'MiniMax',
};

/**
 * Модели под собственными названиями Ketner: название — наше, сама модель — стороннего
 * разработчика. Здесь записано её настоящее имя.
 */
const BASE_MODEL_NAMES: Readonly<Record<string, string>> = {
  'openai/gpt-6-luna': 'GPT-6 Luna',
  'xiaomi/mimo-v2.6-pro': 'MiMo-V2.6 Pro',
};

export interface ModelDisclosure {
  /** Компания-разработчик модели. */
  developer: string;
  /** Идентификатор модели у поставщика (OpenRouter), ровно тот, что уходит в запрос. */
  upstreamModel: string;
  /** Настоящее имя модели, если в Ketner она называется иначе (Ketner Mini, Ketner Pro). */
  baseModelName?: string;
}

export function disclosureOf(
  entry: Pick<ModelRegistryEntry, 'providerModelId' | 'name'>,
): ModelDisclosure | null {
  const upstream = entry.providerModelId;
  if (!upstream || upstream === 'auto') return null;
  const prefix = upstream.split('/')[0] ?? '';
  const developer = DEVELOPERS[prefix] ?? prefix;
  const baseModelName = BASE_MODEL_NAMES[upstream.replace(/:free$/, '')];
  return {
    developer,
    upstreamModel: upstream,
    ...(baseModelName ? { baseModelName } : {}),
  };
}

/**
 * Строка системного промпта о том, какая модель отвечает. Не зависит от вопроса, поэтому не
 * сбрасывает кэш промпта; у каждой модели своя постоянная строка.
 */
export function modelIdentityPrompt(
  entry: Pick<ModelRegistryEntry, 'providerModelId' | 'name'>,
  language: Language,
): string {
  const info = disclosureOf(entry);
  if (!info) return '';
  const realName = info.baseModelName ?? entry.name.replace(/\s*\(Free\)$/, '');
  if (language === 'en') {
    const alias = info.baseModelName ? ` (shown in Ketner AI as "${entry.name}")` : '';
    return ` You are ${realName} by ${info.developer}${alias}, accessed through the Ketner AI service. If asked which model you are or who made you, answer truthfully; do not claim to be developed by Ketner AI.`;
  }
  const alias = info.baseModelName ? ` (в Ketner AI называется «${entry.name}»)` : '';
  return ` Ты — модель ${realName} от ${info.developer}${alias}, доступная через сервис Ketner AI. Если спрашивают, какая ты модель или кто тебя создал, отвечай честно и не называй себя разработкой Ketner AI.`;
}

/**
 * Строка о модели для бота, который отвечает от имени бизнеса (`assistant.replaceSystemPrompt`).
 * Кто он — задаёт промпт бота (роль, имя, бизнес); модель и её разработчика бот сам не называет, но
 * на прямой вопрос отвечает честно. Ничего не скрывает и не отрицает: лгать или отказываться отвечать
 * не велено. Как и `modelIdentityPrompt`, не зависит от вопроса — кэш промпта не сбрасывается.
 */
export function modelDisclosureOnRequestPrompt(
  entry: Pick<ModelRegistryEntry, 'providerModelId' | 'name'>,
  language: Language,
): string {
  const info = disclosureOf(entry);
  if (!info) return '';
  const realName = info.baseModelName ?? entry.name.replace(/\s*\(Free\)$/, '');
  if (language === 'en') {
    return ` If the visitor asks directly which AI model you run on or which company made it, answer truthfully: you run on ${realName} by ${info.developer}, and the bot works on the Ketner AI service. Do not bring this up yourself.`;
  }
  return ` Если собеседник прямо спрашивает, на какой модели ИИ ты работаешь или какая компания её создала, ответь честно: ты работаешь на модели ${realName} от ${info.developer}, а бот работает на сервисе Ketner AI. Сам об этом не заговаривай.`;
}
