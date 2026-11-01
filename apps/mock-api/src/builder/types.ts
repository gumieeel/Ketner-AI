/**
 * Builder (этап 6): решения на основе возможностей анализа. Первый тип — персональный помощник:
 * настройки (роль, инструкции, знания, примеры, правила) хранятся версиями, перед включением
 * текущая версия проходит тест-кейсы, а работает помощник в своём чате с автоматическим выбором
 * модели (Auto) через общий AI Gateway.
 */

import type { Language } from '../types.js';

export type AssistantTone = 'friendly' | 'neutral' | 'formal' | 'concise';

export interface AssistantExample {
  input: string;
  output: string;
}

/** Настройки помощника — содержимое одной версии. */
export interface AssistantConfig {
  name: string;
  /** Кто он и для чего: 1–2 предложения. */
  purpose: string;
  /** Как работать: порядок действий, формат ответов. */
  instructions: string;
  tone: AssistantTone;
  /** Справочные данные: факты, цены, правила компании — вставленный текст. */
  knowledge: string;
  /** Примеры «вопрос → хороший ответ». */
  examples: AssistantExample[];
  /** Чего не делать никогда. */
  restrictions: string[];
  language: Language;
}

export type SolutionStatus = 'draft' | 'active' | 'paused';

export interface SolutionSource {
  analysisId: string;
  opportunityId: string;
  title: string;
}

export type SolutionType = 'assistant' | 'customer_bot';

/**
 * Настройки бота для клиентов (этап B), не версионируются: меняются сразу, без повторной
 * проверки. Поведение бота — в настройках версии (`AssistantConfig`), как у помощника.
 */
export interface BotSettings {
  /** Адрес страницы бота: ketner.org/b/<slug>. */
  slug: string;
  /** Первое сообщение на странице бота. */
  greeting: string;
  /** Кнопки с частыми вопросами. */
  quickReplies: string[];
  /** Потолок расхода за сутки (UTC), кредитов; дальше бот только собирает заявки. */
  dailyCapCredits: number;
  /** Исправленные владельцем ответы: бот отвечает так на похожие вопросы. */
  corrections: Array<{ question: string; answer: string }>;
}

export interface Solution {
  id: string;
  ownerId: string;
  type: SolutionType;
  /** Только у `customer_bot`. */
  bot: BotSettings | null;
  status: SolutionStatus;
  name: string;
  /** Номер последней сохранённой версии настроек. */
  currentVersion: number;
  /** Версия, которая работает в чате; null — помощник ещё не включался. */
  activeVersion: number | null;
  source: SolutionSource | null;
  createdAt: string;
  updatedAt: string;
  /** Версия записи (защита от одновременной записи), не путать с версией настроек. */
  version: number;
}

export interface SolutionVersion {
  solutionId: string;
  number: number;
  config: AssistantConfig;
  createdAt: string;
}

export interface TestCase {
  id: string;
  solutionId: string;
  position: number;
  /** Что спрашивают у помощника. */
  input: string;
  /** Каким должен быть ответ. */
  criteria: string[];
  createdAt: string;
  updatedAt: string;
}

export type Verdict = 'pass' | 'fail';

export interface TestResult {
  caseId: string;
  input: string;
  criteria: string[];
  status: 'pending' | 'running' | 'done' | 'failed';
  answer: string;
  model: { id: string; name: string } | null;
  judge: {
    verdict: Verdict;
    notes: string;
    criteria: Array<{ criterion: string; met: boolean; note: string }>;
  } | null;
  /** Вердикт пользователя: заменяет вердикт модели-судьи. */
  manual: Verdict | null;
  error: { code: string; message: string } | null;
  costUsd: number;
  creditsUsd: number;
}

export interface TestRun {
  id: string;
  solutionId: string;
  ownerId: string;
  /** Какая версия настроек проверялась. */
  versionNumber: number;
  /** Отпечаток набора кейсов: изменились кейсы — прогон устарел. */
  casesHash: string;
  status: 'running' | 'done';
  results: TestResult[];
  createdAt: string;
  finishedAt: string | null;
  version: number;
}

export interface ChatThread {
  id: string;
  solutionId: string;
  ownerId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  threadId: string;
  ownerId: string;
  role: 'user' | 'assistant';
  content: string;
  /** Какая модель ответила (Auto выбирает под задачу). */
  model: { id: string; name: string } | null;
  /** Картинка, если помощник её нарисовал (сервис изображений). */
  image: { id: string; url: string; downloadUrl: string; modelName: string } | null;
  status: 'complete' | 'error';
  createdAt: string;
}

/** Диалог посетителя со страницей бота: посетитель — анонимный id из его браузера. */
export interface BotConversation {
  id: string;
  solutionId: string;
  ownerId: string;
  visitorId: string;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface BotMessage {
  id: string;
  conversationId: string;
  solutionId: string;
  ownerId: string;
  role: 'user' | 'assistant';
  content: string;
  model: { id: string; name: string } | null;
  /** Бот предложил оставить контакт (не знает ответа, клиент просит человека, кончились кредиты). */
  offerContact: boolean;
  /** Списано с кредитов владельца, $. */
  creditsUsd: number;
  status: 'complete' | 'error';
  createdAt: string;
}

export interface BotLead {
  id: string;
  solutionId: string;
  ownerId: string;
  conversationId: string | null;
  name: string;
  contact: string;
  question: string;
  status: 'new' | 'done';
  createdAt: string;
  updatedAt: string;
}
