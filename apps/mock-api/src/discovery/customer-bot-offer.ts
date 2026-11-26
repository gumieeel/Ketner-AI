/**
 * Бот для клиентов, когда клиенты пишут в каналы, которых у Ketner нет (решение владельца
 * 16.11.2026). Модель честно помечает «ответы в WhatsApp» как «пока не поддерживается», а сервер
 * следит, чтобы рядом всегда было то, что можно сделать сейчас: бот на своей странице — по ссылке,
 * QR-коду и кнопке на сайте. Без лишнего вызова модели: текст собирается здесь.
 */

import type { Language } from '../types.js';
import type { CHANNELS } from './profile.js';
import type { DiscoveryOutput } from './schemas.js';

type Channel = (typeof CHANNELS)[number];

/**
 * Каналы переписки с клиентами, которых у Ketner нет: бот к ним не подключается. Сайт — есть
 * (кнопка-виджет); телефон, почта и офлайн — не переписка в мессенджере.
 */
export const UNSUPPORTED_MESSAGING_CHANNELS = [
  'whatsapp',
  'instagram',
  'telegram',
  'marketplace',
] as const satisfies readonly Channel[];

const CHANNEL_NAMES: Record<
  (typeof UNSUPPORTED_MESSAGING_CHANNELS)[number],
  Record<Language, string>
> = {
  whatsapp: { ru: 'WhatsApp', en: 'WhatsApp' },
  instagram: { ru: 'Instagram', en: 'Instagram' },
  telegram: { ru: 'Telegram', en: 'Telegram' },
  marketplace: { ru: 'чат маркетплейса', en: 'marketplace chat' },
};

/** Каналы из профиля бизнеса, куда клиенты пишут, а бот подключиться не может. */
export function unsupportedMessagingChannels(
  channels: readonly string[] | null | undefined,
): Array<(typeof UNSUPPORTED_MESSAGING_CHANNELS)[number]> {
  return UNSUPPORTED_MESSAGING_CHANNELS.filter((channel) => channels?.includes(channel));
}

type DraftOpportunity = DiscoveryOutput['opportunities'][number];

/** «WhatsApp», «WhatsApp и Instagram», «WhatsApp, Instagram и Telegram» (en — «and»). */
export function joinNames(names: readonly string[], language: Language): string {
  if (names.length <= 1) return names.join('');
  const and = language === 'ru' ? ' и ' : ' and ';
  return `${names.slice(0, -1).join(', ')}${and}${names[names.length - 1]}`;
}

/** Возможность «бот для клиентов» в том же виде, в каком её вернула бы модель. */
export function customerBotOffer(
  language: Language,
  channels: ReadonlyArray<(typeof UNSUPPORTED_MESSAGING_CHANNELS)[number]>,
): DraftOpportunity {
  const names = joinNames(
    channels.map((channel) => CHANNEL_NAMES[channel][language]),
    language,
  );
  const ru = language === 'ru';
  return {
    title: ru
      ? 'ИИ-агент для клиентов по ссылке и QR-коду'
      : 'AI agent for customers by link and QR code',
    area: 'clients',
    recipe: 'customer_bot',
    problem: ru
      ? `Клиенты пишут в ${names}, и на одни и те же вопросы отвечают вручную.`
      : `Customers write in ${names}, and the same questions are answered by hand.`,
    solution: ru
      ? `Бот отвечает клиентам на частые вопросы и собирает заявки. Работает по ссылке, QR-коду и кнопке на сайте. К ${names} не подключается: ссылку на бота можно дать в профиле и в автоответе.`
      : `The bot answers customers' common questions and collects requests. It works by link, QR code and site button. It does not connect to ${names}: put the bot link in your profile and in an auto-reply.`,
    requires: ['customer_bot_page', 'text_generation'],
    otherRequirement: null,
    dataNeeded: ru
      ? ['Частые вопросы клиентов и ответы на них', 'Цены, условия, адрес и часы работы']
      : ['Common customer questions and answers', 'Prices, terms, address and opening hours'],
    integrationsNeeded: [],
    effort: 'low',
    effortReason: ru
      ? 'Бот создаётся и проверяется в Ketner без интеграций.'
      : 'The bot is built and tested in Ketner without integrations.',
    risks: [],
    limitations: ru
      ? [`Не отвечает внутри ${names}: клиент переходит по ссылке или QR-коду.`]
      : [`Does not answer inside ${names}: the customer follows the link or QR code.`],
    successCriteria: ru
      ? ['Бот отвечает на частые вопросы без участия сотрудника', 'Заявки приходят владельцу']
      : ['The bot answers common questions without staff', 'Requests reach the owner'],
    impact: {
      taskId: null,
      automationShare: 'medium',
      benefit: ru ? 'Меньше однотипных ответов вручную.' : 'Fewer repetitive answers by hand.',
    },
    firstStep: ru
      ? 'Создайте бота и добавьте в его знания частые вопросы и ответы.'
      : 'Create the bot and add common questions and answers to its knowledge.',
    solutionType: 'assistant',
    workItems: [
      { capability: 'ai_message_processing', quantity: 1, complexity: 'simple', reason: '' },
      { capability: 'website_chat_widget', quantity: 1, complexity: 'simple', reason: '' },
      { capability: 'customer_lead_collection', quantity: 1, complexity: 'simple', reason: '' },
    ],
    unknowns: [],
    assumptions: [],
  } as DraftOpportunity;
}
