/**
 * Минимум фактов перед поиском возможностей (анализ v2, PR A).
 *
 * Без четырёх фактов анализ получается общим: где пишут клиенты, что происходит после заявки,
 * какие объёмы, где хранятся заявки и данные. Если этап разбора их не нашёл, вопрос о каждом
 * становится обязательным — без пропуска; поиск возможностей ждёт ответов. Вопрос модели о том же
 * факте (поле `fact`) используется как есть, иначе сервер задаёт свой.
 */

import { PLATFORM_LIMITS } from '../services/discovery-limits.js';
import type { Language } from '../types.js';
import { KEY_FACTS, type ContextOutput, type KeyFact, type Question } from './schemas.js';

/** Какие ключевые факты этап разбора оставил неизвестными. */
export function missingKeyFacts(context: ContextOutput): KeyFact[] {
  const profile = context.profile;
  const known: Record<KeyFact, boolean> = {
    channels: (profile?.customerChannels.length ?? 0) > 0,
    after_request: context.recurringProcesses.some((process) => process.steps.length > 0),
    volume:
      profile?.monthlyRequests != null ||
      profile?.monthlyOrders != null ||
      context.tasks.some(
        (task) =>
          task.timesPerDay != null || task.timesPerWeek != null || task.timesPerMonth != null,
      ),
    data_location: context.tools.length > 0 || (profile?.existingTools.length ?? 0) > 0,
  };
  return KEY_FACTS.filter((fact) => !known[fact]);
}

const SERVER_QUESTIONS: Record<KeyFact, Record<Language, Omit<Question, 'fact'>>> = {
  channels: {
    ru: {
      id: 'f_chan',
      text: 'Где клиенты пишут вам чаще всего?',
      reason: 'От этого зависит, где будет работать ИИ-агент.',
      optional: false,
      kind: 'choice',
      options: ['WhatsApp', 'Instagram', 'Telegram', 'Сайт', 'Телефон'],
    },
    en: {
      id: 'f_chan',
      text: 'Where do customers write to you most often?',
      reason: 'This decides where the AI agent will work.',
      optional: false,
      kind: 'choice',
      options: ['WhatsApp', 'Instagram', 'Telegram', 'Website', 'Phone'],
    },
  },
  after_request: {
    ru: {
      id: 'f_flow',
      text: 'Что происходит с заявкой после того, как клиент написал?',
      reason: 'Так видно, какие шаги можно передать ИИ.',
      optional: false,
      kind: 'choice',
      options: [
        'Отвечаю сам',
        'Передаю менеджеру',
        'Записываю в таблицу или CRM',
        'Нигде не записываем',
      ],
    },
    en: {
      id: 'f_flow',
      text: 'What happens to a request after a customer writes?',
      reason: 'This shows which steps AI can take over.',
      optional: false,
      kind: 'choice',
      options: [
        'I reply myself',
        'I pass it to a manager',
        'I record it in a spreadsheet or CRM',
        'We do not record it',
      ],
    },
  },
  volume: {
    ru: {
      id: 'f_vol',
      text: 'Сколько обращений или заказов у вас примерно?',
      reason: 'От объёма зависит, сколько времени сэкономит автоматизация.',
      optional: false,
      kind: 'choice',
      options: ['До 10 в день', '10–50 в день', 'Больше 50 в день'],
    },
    en: {
      id: 'f_vol',
      text: 'Roughly how many requests or orders do you get?',
      reason: 'The volume decides how much time automation saves.',
      optional: false,
      kind: 'choice',
      options: ['Up to 10 a day', '10–50 a day', 'More than 50 a day'],
    },
  },
  data_location: {
    ru: {
      id: 'f_data',
      text: 'Где вы храните заявки, заказы и данные клиентов?',
      reason: 'Так видно, что подключать: таблицу, CRM или ничего.',
      optional: false,
      kind: 'choice',
      options: ['В переписке', 'В Excel или Google Таблице', 'В CRM', 'В тетради'],
    },
    en: {
      id: 'f_data',
      text: 'Where do you keep requests, orders and customer data?',
      reason: 'This shows what to connect: a spreadsheet, a CRM or nothing.',
      optional: false,
      kind: 'choice',
      options: ['In the chats', 'In Excel or Google Sheets', 'In a CRM', 'In a notebook'],
    },
  },
};

/**
 * Вопросы, которые увидит человек: сначала о каждом неизвестном ключевом факте (обязательные, без
 * пропуска), потом остальные вопросы модели — пока не кончится лимит. Если ключевых фактов больше
 * лимита, лимит расширяется до их числа: без них поиск возможностей не начинается.
 */
export function gateQuestions(context: ContextOutput, language: Language): Question[] {
  const missing = missingKeyFacts(context);
  const own = context.questions;
  const key = missing.map((fact): Question => {
    const asked = own.find((question) => question.fact === fact);
    return asked ? { ...asked, optional: false } : { ...SERVER_QUESTIONS[fact][language], fact };
  });
  const usedIds = new Set(key.map((question) => question.id));
  const rest = own
    .filter((question) => !usedIds.has(question.id))
    // Вопрос о факте, который уже известен, — как его задала модель, но без пометки факта.
    .map((question) => (question.fact ? { ...question, fact: null } : question));
  const limit = Math.max(PLATFORM_LIMITS.analyses.maxQuestions, key.length);
  return [...key, ...rest].slice(0, limit);
}

/** Обязательный вопрос о ключевом факте: пропуск и пустой ответ не принимаются. */
export function needsKeyAnswer(question: Question): boolean {
  return Boolean(question.fact) && !question.optional;
}
