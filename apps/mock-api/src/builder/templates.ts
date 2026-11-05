/**
 * Шаблоны решений Builder — проверяемый код, единственный источник правды о том, какие решения
 * Ketner умеет создавать (как каталог возможностей в discovery/capabilities.ts).
 *
 * Вид решения (`kind`) определяет, как им пользуются:
 *   - `assistant` — разговор: чат помощника или бот для клиентов;
 *   - `tool` — инструмент: входные данные → операция → структурированный результат на своей странице;
 *   - `workflow` — заданная в коде последовательность операций инструментов.
 *
 * Шаблон — конкретная реализация вида (личный помощник, бот для клиентов, учебный помощник…).
 * Недоступный шаблон нельзя создать, а запрос на него никогда не превращается молча в помощника.
 *
 * Новый шаблон: добавьте id в `TEMPLATE_IDS`, запись в `TEMPLATES` и тест; `available: true` —
 * только когда вся его функциональность работает.
 */
import type { CapabilityId } from '../discovery/capabilities.js';
import type { Language } from '../types.js';
import type { SolutionType } from './types.js';

export const SOLUTION_KINDS = ['assistant', 'tool', 'workflow'] as const;
export type SolutionKind = (typeof SOLUTION_KINDS)[number];

export const TEMPLATE_IDS = ['personal_assistant', 'customer_bot'] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];

export interface SolutionTemplate {
  id: TemplateId;
  kind: SolutionKind;
  /**
   * Значение колонки `solutions.type`. У бота для клиентов исторически свой тип: его код
   * (builder/bot-service.ts, routes/bots.ts) проверяет `type === 'customer_bot'`.
   */
  storageType: SolutionType;
  /** Шаблон можно создать сейчас: вся его функциональность работает. */
  available: boolean;
  /** Что нужно от платформы (проверяется выполнимостью Discovery). */
  requires: readonly CapabilityId[];
  label: Record<Language, string>;
  description: Record<Language, string>;
}

export const TEMPLATES: Readonly<Record<TemplateId, SolutionTemplate>> = {
  personal_assistant: {
    id: 'personal_assistant',
    kind: 'assistant',
    storageType: 'assistant',
    available: true,
    requires: ['text_generation'],
    label: { ru: 'Личный помощник', en: 'Personal assistant' },
    description: {
      ru: 'помощник в чате Ketner со знаниями и стилем человека: отвечает, пишет письма, документы, посты',
      en: "an assistant in Ketner chat with the person's knowledge and style: answers, writes letters, documents, posts",
    },
  },
  customer_bot: {
    id: 'customer_bot',
    kind: 'assistant',
    storageType: 'customer_bot',
    available: true,
    requires: ['text_generation'],
    label: { ru: 'Бот для клиентов', en: 'Customer bot' },
    description: {
      ru: 'бот на странице Ketner отвечает клиентам бизнеса и собирает заявки',
      en: "a bot on a Ketner page answers the business's customers and collects requests",
    },
  },
};

/** Вид решения по колонке `solutions.type`: она всегда известна (CHECK в базе). */
export const KIND_BY_TYPE: Readonly<Record<SolutionType, SolutionKind>> = {
  assistant: 'assistant',
  customer_bot: 'assistant',
  tool: 'tool',
  workflow: 'workflow',
};

export function isTemplateId(value: unknown): value is TemplateId {
  return typeof value === 'string' && (TEMPLATE_IDS as readonly string[]).includes(value);
}

/** Шаблон по id; `null` — такого шаблона в этой версии кода нет. */
export function getTemplate(id: string): SolutionTemplate | null {
  return isTemplateId(id) ? TEMPLATES[id] : null;
}
