/**
 * Проверка запросов на генерацию картинок.
 *
 * Публичный генератор без проверки быстро начинают использовать для запрещённого контента, поэтому
 * каждый запрос проходит две ступени:
 *  1. Быстрый локальный фильтр: явные сочетания «несовершеннолетний + сексуальное» и известные
 *     обозначения такого контента блокируются сразу, без обращения к модели.
 *  2. Классификатор на лёгкой модели (GPT-6 Luna через OpenRouter, ≈ $0.0001 за проверку). Он же
 *     переводит запрос на английский: FLUX понимает английский заметно лучше.
 * Если классификатор недоступен, запрос НЕ пропускается (fail closed).
 */

import type { AIProvider } from '../ai/gateway-types.js';

export type ModerationCategory = 'minors' | 'sexual' | 'real_person' | 'violence' | 'hate' | 'other';

export type ModerationResult =
  | { allowed: true; promptEn: string }
  | { allowed: false; category: ModerationCategory | 'unavailable' };

export interface PromptModerator {
  check(prompt: string, signal?: AbortSignal): Promise<ModerationResult>;
}

const MINOR_TERMS =
  /(реб[её]н|дет(и|ей|ск)|девочк|мальчик|школьни|подрост|малолет|несовершеннолет|младен|\bchild|\bkids?\b|\bchildren|\btoddler|\bteen|\bpreteen|\bunderage|\bminor\b|\bschool ?(girl|boy)|\bbaby\b|\blittle (girl|boy)|\byoung (girl|boy)|\bjailbait)/i;
const SEXUAL_TERMS =
  /(гол(ая|ый|ые|ой)|обнаж|секс|эрот|порн|интим|нижн(ее|ем) бель|раздет|\bnude|\bnaked|\bnsfw|\bsex|\bporn|\berotic|\blingerie|\btopless|\bundress|\bseductive|\bfetish|\bhentai)/i;
const ALWAYS_BLOCKED = /(\bloli|\bshota|\bcp\b|\bpedo|педо|лоли\b)/i;

/** Локальная ступень: true — запрос заблокирован без обращения к модели. */
export function isObviouslyForbidden(prompt: string): boolean {
  return ALWAYS_BLOCKED.test(prompt) || (MINOR_TERMS.test(prompt) && SEXUAL_TERMS.test(prompt));
}

const SYSTEM = [
  'You are a strict safety classifier for a public text-to-image service.',
  'Decide whether the image request may be generated. Block (allowed=false) if it asks for or clearly implies:',
  '- minors: any sexual, nude, suggestive or fetish content involving children, teens or childlike characters (any style, any wording);',
  '- sexual: nudity, sexual acts, pornographic or explicitly erotic content of anyone;',
  '- real_person: sexual, humiliating, violent or deceptive (fake photo / deepfake) depictions of real, identifiable people;',
  '- violence: graphic gore, torture, mutilation, or glorification of terrorism or mass violence;',
  '- hate: hateful symbols or propaganda targeting protected groups;',
  '- other: anything else clearly illegal (e.g. realistic forged documents or banknotes).',
  'Ordinary art, photography, people, fantasy battles without gore, fashion and swimwear in non-sexual contexts are allowed.',
  'Also translate the request into a clear English image prompt that keeps its meaning (do not add new content).',
  'Answer with JSON only: {"allowed": true|false, "category": "none|minors|sexual|real_person|violence|hate|other", "prompt_en": "..."}',
].join('\n');

const CATEGORIES: ReadonlySet<string> = new Set(['minors', 'sexual', 'real_person', 'violence', 'hate', 'other']);

export function createLlmModerator(options: { provider: () => AIProvider | undefined; model: string }): PromptModerator {
  return {
    async check(prompt, signal) {
      if (isObviouslyForbidden(prompt)) return { allowed: false, category: 'minors' };
      const provider = options.provider();
      if (!provider || !provider.isAvailable()) return { allowed: false, category: 'unavailable' };
      try {
        const response = await provider.generateText({
          model: options.model,
          messages: [
            { role: 'system', content: SYSTEM },
            { role: 'user', content: `Image request:\n"""${prompt.slice(0, 2_000)}"""` },
          ],
          maxTokens: 600,
          temperature: 0,
          stream: false,
          signal,
          reasoning: { effort: 'none' },
        });
        const match = response.content.match(/\{[\s\S]*\}/);
        if (!match) return { allowed: false, category: 'unavailable' };
        const parsed = JSON.parse(match[0]) as { allowed?: unknown; category?: unknown; prompt_en?: unknown };
        if (parsed.allowed === true) {
          const promptEn = typeof parsed.prompt_en === 'string' && parsed.prompt_en.trim() ? parsed.prompt_en.trim() : prompt;
          // Перевод тоже проверяется локальным фильтром: модель не должна «пронести» запрещённое.
          if (isObviouslyForbidden(promptEn)) return { allowed: false, category: 'minors' };
          return { allowed: true, promptEn: promptEn.slice(0, 2_000) };
        }
        const category = typeof parsed.category === 'string' && CATEGORIES.has(parsed.category) ? parsed.category : 'other';
        return { allowed: false, category: category as ModerationCategory };
      } catch (error) {
        console.warn('[images] проверка запроса не удалась:', error instanceof Error ? error.message : error);
        return { allowed: false, category: 'unavailable' };
      }
    },
  };
}
