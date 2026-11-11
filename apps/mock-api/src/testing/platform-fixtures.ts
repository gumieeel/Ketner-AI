/** Фикстуры тестов модуля platform (docs/DOMAIN_MODEL.md). */

import { BOT_LIMITS } from '../builder/bot-service.js';
import { LIMITS } from '../builder/schemas.js';
import type { AssistantConfig, BotSettings } from '../builder/types.js';
import type { LegacyAgentSource } from '../platform/agent-spec.js';
import type { SolutionSpec } from '../platform/solution-spec.js';

const repeat = (text: string, length: number) =>
  text.repeat(Math.ceil(length / text.length)).slice(0, length);

export const assistantConfig = (overrides: Partial<AssistantConfig> = {}): AssistantConfig => ({
  name: 'Помощник Алии',
  purpose: 'Пишет письма и коммерческие предложения для студии керамики',
  instructions: 'Отвечай коротко. Цены — только из знаний.',
  tone: 'friendly',
  knowledge: 'Мастер-класс — 12 000 ₸. Доставка по Алматы — 1 500 ₸.',
  examples: [{ input: 'Сколько стоит мастер-класс?', output: '12 000 ₸ за человека.' }],
  restrictions: ['Не обещать скидки'],
  language: 'ru',
  ...overrides,
});

export const botSettings = (overrides: Partial<BotSettings> = {}): BotSettings => ({
  slug: 'keramika-alia',
  greeting: 'Здравствуйте! Чем помочь?',
  quickReplies: ['Цены', 'Доставка'],
  dailyCapCredits: 1000,
  corrections: [{ question: 'Работаете в воскресенье?', answer: 'Да, с 11 до 17.' }],
  ...overrides,
});

/** Существующие настройки, включая краевые случаи хранимых данных. */
export const legacySources: Array<{ title: string; source: LegacyAgentSource }> = [
  {
    title: 'личный помощник',
    source: { template: 'personal_assistant', config: assistantConfig(), bot: null },
  },
  {
    title: 'помощник с пустыми необязательными полями (создан вручную)',
    source: {
      template: 'personal_assistant',
      config: assistantConfig({
        purpose: '',
        instructions: '',
        knowledge: '',
        examples: [],
        restrictions: [],
        language: 'en',
        tone: 'concise',
      }),
      bot: null,
    },
  },
  {
    title: 'помощник на пределах длины',
    source: {
      template: 'personal_assistant',
      config: assistantConfig({
        name: repeat('Имя ', LIMITS.name),
        purpose: repeat('Назначение. ', LIMITS.purpose),
        instructions: repeat('Шаг. ', LIMITS.instructions),
        knowledge: repeat('Факт. ', LIMITS.knowledge),
        examples: Array.from({ length: LIMITS.examples }, (_, i) => ({
          input: `${i} ${repeat('в', LIMITS.exampleChars - 2)}`.slice(0, LIMITS.exampleChars),
          output: repeat('о', LIMITS.exampleChars),
        })),
        restrictions: Array.from({ length: LIMITS.restrictions }, (_, i) =>
          `${i} ${repeat('з', LIMITS.restrictionChars - 2)}`.slice(0, LIMITS.restrictionChars),
        ),
      }),
      bot: null,
    },
  },
  {
    title: 'бот для клиентов',
    source: {
      template: 'customer_bot',
      config: assistantConfig({ tone: 'formal' }),
      bot: botSettings(),
    },
  },
  {
    title: 'бот без кнопок, приветствия и исправлений, минимальный потолок',
    source: {
      template: 'customer_bot',
      config: assistantConfig(),
      bot: botSettings({
        greeting: '',
        quickReplies: [],
        corrections: [],
        dailyCapCredits: BOT_LIMITS.dailyCapMin,
      }),
    },
  },
  {
    title: 'бот на пределах: 4 кнопки, 30 исправлений, максимальный потолок',
    source: {
      template: 'customer_bot',
      config: assistantConfig({ language: 'en' }),
      bot: botSettings({
        slug: 'a-1',
        greeting: repeat('Hi ', BOT_LIMITS.greeting),
        quickReplies: Array.from(
          { length: BOT_LIMITS.quickReplies },
          (_, i) => `${i} ${repeat('q', BOT_LIMITS.quickReply - 2)}`,
        ),
        corrections: Array.from({ length: BOT_LIMITS.corrections }, (_, i) => ({
          question: `${i} ${repeat('?', BOT_LIMITS.correctionChars - 3)}`.slice(
            0,
            BOT_LIMITS.correctionChars,
          ),
          answer: repeat('!', BOT_LIMITS.correctionChars),
        })),
        dailyCapCredits: BOT_LIMITS.dailyCapMax,
      }),
    },
  },
];

/** Решение «бот отвечает на вопросы, процесс передаёт заявку владельцу». */
export const supportSolution = (overrides: Partial<SolutionSpec> = {}): SolutionSpec => ({
  specVersion: 1,
  title: 'Ответы клиентам и заявки',
  source: { analysisId: 'an_1', opportunityId: 'op_1' },
  businessContext: 'Студия керамики, заказы через сайт и Instagram',
  problem: 'Сотрудники тратят по два часа в день на одинаковые вопросы о ценах и доставке',
  expectedOutcome: 'Бот отвечает на типовые вопросы, сложные передаёт владельцу заявкой',
  successCriteria: ['70% вопросов без участия сотрудника'],
  type: 'assistant',
  strategy: 'agent_calls_workflow',
  trigger: { kind: 'public_page', description: 'Посетитель пишет на странице бота' },
  components: {
    agents: [{ key: 'support', template: 'customer_bot', purpose: 'Отвечает на вопросы клиентов' }],
    workflows: [
      {
        key: 'lead_followup',
        purpose: 'Уведомить владельца о новой заявке',
        trigger: { kind: 'webhook', description: 'Бот создал заявку' },
        steps: [
          { key: 'save', action: 'lead.create', description: 'Сохранить заявку', onError: 'stop' },
          {
            key: 'notify',
            action: 'owner.notify',
            description: 'Сообщить владельцу',
            onError: 'retry',
          },
        ],
        logicOrigin: 'catalog_template',
        template: { id: 'lead_followup', version: 1 },
        instantiation: 'shared',
      },
    ],
    tools: [],
  },
  requires: ['text_generation'],
  integrations: [],
  knowledgeSources: [{ kind: 'site', ref: 'https://example.com' }],
  input: { kind: 'text', fields: [] },
  output: { kind: 'text', fields: [] },
  permissions: ['knowledge.search', 'reply.send_in_session', 'lead.create', 'owner.notify'],
  failureHandling: { onError: 'retry_then_notify', maxRetries: 2 },
  testing: { minCases: 3, kinds: ['typical', 'unknown', 'escalation'] },
  effort: 'low',
  estimateId: null,
  assumptions: [],
  unknowns: [],
  ...overrides,
});
