import type { Language } from '../preferences/preferences-store';

export interface FaqItem {
  id: string;
  q: Record<Language, string>;
  a: Record<Language, string>;
}

export const FAQ_ITEMS: FaqItem[] = [
  {
    id: 'unlimited',
    q: {
      ru: 'Это правда безлимитно?',
      en: 'Is it really unlimited?',
    },
    a: {
      ru: 'Да! Для реального человека в рамках платных тарифов нет ограничений по количеству сообщений или токенов. Вы можете комфортно решать рабочие, учебные и творческие задачи каждый день без подсчёта кредитов.',
      en: 'Yes! For human usage on paid tiers, there are no artificial token counters or message caps. You can tackle your work, study, and creative tasks every day without calculating credits.',
    },
  },
  {
    id: 'models',
    q: {
      ru: 'Какие модели доступны в Ketner AI?',
      en: 'Which AI models are included in Ketner AI?',
    },
    a: {
      ru: 'Вам доступны лучшие флагманы мира: OpenAI (GPT-6 Astra, GPT-4o), Anthropic (Claude 3.5 Sonnet), Google (Gemini 2.5 Pro / Flash), а также оптимизированная внутренняя модель Ketner Mini. Мы постоянно добавляем новые модели сразу после их официального релиза.',
      en: 'You get access to top global flagships: OpenAI (GPT-6 Astra, GPT-4o), Anthropic (Claude 3.5 Sonnet), Google (Gemini 2.5 Pro / Flash), and optimized Ketner Mini. New state-of-the-art models are added as soon as they release.',
    },
  },
  {
    id: 'speed',
    q: {
      ru: 'Почему ответы приходят так быстро?',
      en: 'Why are responses so fast?',
    },
    a: {
      ru: 'Наша система интеллектуальной маршрутизации анализирует ваш вопрос и направляет его к наиболее быстрому и точному провайдеру, кэширует частые запросы и использует параллельные соединения с облачными кластерами AI.',
      en: 'Our smart routing system classifies your query in milliseconds, sends it to the most efficient provider, caches frequent answers, and connects to high-speed cloud clusters.',
    },
  },
  {
    id: 'manual-model',
    q: {
      ru: 'Могу ли я выбрать модель самостоятельно?',
      en: 'Can I choose the model manually?',
    },
    a: {
      ru: 'Конечно. По умолчанию включён режим «Best AI (Auto)», в котором система сама подбирает идеальную модель под сложность вопроса. Но в любой момент в выпадающем меню чата вы можете переключиться на нужную модель вручную.',
      en: 'Absolutely. By default, "Best AI (Auto)" chooses the best model for the task. However, you can click the model picker at any time to explicitly pick GPT, Claude, or Gemini.',
    },
  },
  {
    id: 'diff-chatgpt',
    q: {
      ru: 'Чем Ketner AI отличается от ChatGPT Plus?',
      en: 'How does Ketner AI differ from ChatGPT Plus?',
    },
    a: {
      ru: 'Подписка ChatGPT Plus стоит $20 и привязывает вас только к одной компании (OpenAI). В Ketner AI за одну доступную подписку вы получаете сразу все ведущие нейросети мира: GPT, Claude и Gemini в едином окне, экономя десятки тысяч рублей на отдельных подписках.',
      en: 'A standard ChatGPT Plus subscription costs $20 and locks you into OpenAI only. With Ketner AI, a single subscription gives you all premier world-class models — GPT, Claude, and Gemini — in one unified interface, saving you time and hundreds of dollars.',
    },
  },
];
