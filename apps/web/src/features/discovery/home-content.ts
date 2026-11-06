import type { Language } from '@/features/preferences/preferences-store';

/**
 * Разделы главной ниже первого экрана: как работает Ketner, внедрение и вопросы. Заголовки
 * разделов — в словарях (discoveryHome.*), списки — здесь, на двух языках, как примеры отраслей.
 */

type Localized = Record<Language, string>;

export interface HomeStep {
  id: string;
  title: Localized;
  text: Localized;
}

export const HOW_IT_WORKS: readonly HomeStep[] = [
  {
    id: 'describe',
    title: { ru: 'Вы рассказываете о бизнесе', en: 'You describe your business' },
    text: {
      ru: 'Своими словами: чем занимаетесь, откуда приходят клиенты, что делается вручную. Можно добавить ссылку на сайт.',
      en: 'In your own words: what you do, where clients come from, what is done by hand. You can add a link to your website.',
    },
  },
  {
    id: 'clarify',
    title: { ru: 'Ketner уточняет главное', en: 'Ketner asks what matters' },
    text: {
      ru: 'Несколько коротких вопросов с готовыми вариантами — только о том, что меняет рекомендацию. Любой можно пропустить.',
      en: 'A few short questions with ready answers — only about what changes the recommendation. Any of them can be skipped.',
    },
  },
  {
    id: 'analyze',
    title: { ru: 'Разбирает процессы', en: 'It analyzes the processes' },
    text: {
      ru: 'Составляет профиль бизнеса и проходит по пяти областям: клиенты, продажи, контент, документы и рутина.',
      en: 'It builds a business profile and goes through five areas: clients, sales, content, documents and routine.',
    },
  },
  {
    id: 'plan',
    title: { ru: 'Показывает, что автоматизировать', en: 'It shows what to automate' },
    text: {
      ru: 'Возможности с оценкой сложности, нужными интеграциями и первым шагом. Что пока нельзя сделать — сказано прямо.',
      en: 'Opportunities with complexity, required integrations and the first step. What cannot be done yet is stated plainly.',
    },
  },
];

export const IMPLEMENTATION: readonly HomeStep[] = [
  {
    id: 'ready',
    title: { ru: 'Готовые автоматизации', en: 'Ready-made automations' },
    text: {
      ru: 'Бот для клиентов, личный помощник и другие готовые решения запускаются прямо из анализа, без программиста.',
      en: 'A customer bot, a personal assistant and other ready-made solutions launch right from the analysis, no developer needed.',
    },
  },
  {
    id: 'plan',
    title: { ru: 'План внедрения', en: 'Implementation plan' },
    text: {
      ru: 'Для остального — пошаговый план: что подключить, какие данные подготовить и по чему понять, что всё работает.',
      en: 'For the rest — a step-by-step plan: what to connect, which data to prepare and how to tell that it works.',
    },
  },
  {
    id: 'help',
    title: { ru: 'Помощь с внедрением', en: 'Help with implementation' },
    text: {
      ru: 'Если нужна интеграция с вашими системами — напишите нам, обсудим задачу и объём работ.',
      en: 'If you need an integration with your systems — write to us and we will discuss the task and the scope.',
    },
  },
];

export interface HomeQuestion {
  id: string;
  q: Localized;
  a: Localized;
}

export const HOME_FAQ: readonly HomeQuestion[] = [
  {
    id: 'tech',
    q: { ru: 'Нужно ли разбираться в технологиях?', en: 'Do I need to understand technology?' },
    a: {
      ru: 'Нет. Опишите, как работает ваш бизнес, обычными словами — Ketner сам переведёт это в задачи для автоматизации.',
      en: 'No. Describe how your business works in plain words — Ketner turns it into automation tasks itself.',
    },
  },
  {
    id: 'signup',
    q: { ru: 'Нужна ли регистрация?', en: 'Do I need to sign up?' },
    a: {
      ru: 'Нет. Анализ доступен сразу и хранится в этом браузере 30 дней. Если войти или зарегистрироваться, он перейдёт в ваш аккаунт и сохранится.',
      en: 'No. The analysis is available right away and is kept in this browser for 30 days. If you log in or sign up, it moves to your account and is kept.',
    },
  },
  {
    id: 'data',
    q: { ru: 'Кто увидит описание моего бизнеса?', en: 'Who will see my business description?' },
    a: {
      ru: 'Только вы: анализ привязан к этому браузеру или к вашему аккаунту. Для разбора текст передаётся модели ИИ. Анализ можно удалить в любой момент.',
      en: 'Only you: the analysis is tied to this browser or to your account. The text is sent to an AI model for the analysis. You can delete the analysis at any time.',
    },
  },
  {
    id: 'price',
    q: { ru: 'Сколько это стоит?', en: 'How much does it cost?' },
    a: {
      ru: 'Один анализ в день — бесплатно. Более подробные анализы и автоматизации — за кредиты, без подписки.',
      en: 'One analysis a day is free. More detailed analyses and automations use credits, with no subscription.',
    },
  },
  {
    id: 'unsupported',
    q: {
      ru: 'А если мою задачу нельзя автоматизировать в Ketner?',
      en: 'What if my task cannot be automated in Ketner?',
    },
    a: {
      ru: 'Отчёт скажет об этом прямо и объяснит, чего не хватает: интеграции, данных или сервиса со стороны.',
      en: 'The report says so plainly and explains what is missing: an integration, data or a third-party service.',
    },
  },
];
