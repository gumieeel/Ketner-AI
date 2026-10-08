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
      ru: 'На тарифе Free доступна Ketner Mini. Plus добавляет Ketner Pro, GPT-6.1 Sol (OpenAI), Claude Haiku 5.5 (Anthropic) и DeepSeek V4.1 Flash. Pro и Ultra открывают также Claude Opus 5.5, Grok 4.7 (xAI) и Gemini 3.8 Flash (Google). Сильные модели — GPT-6.1 Sol, Claude Opus 5.5, Grok 4.7 и Gemini 3.8 Flash — расходуют ежемесячную квоту премиум-запросов вашего тарифа. Мы постоянно добавляем новые модели сразу после их официального релиза.',
      en: 'The Free plan includes Ketner Mini. Plus adds Ketner Pro, GPT-6.1 Sol (OpenAI), Claude Haiku 5.5 (Anthropic) and DeepSeek V4.1 Flash. Pro and Ultra also unlock Claude Opus 5.5, Grok 4.7 (xAI) and Gemini 3.8 Flash (Google). The strong models — GPT-6.1 Sol, Claude Opus 5.5, Grok 4.7 and Gemini 3.8 Flash — draw from your plan\'s monthly premium-request quota. New state-of-the-art models are added as soon as they release.',
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
      ru: 'Конечно. По умолчанию включён режим «Best AI (Auto)», в котором система сама подбирает модель под вопрос: на тарифе Free и для простых вопросов — Ketner Mini, для обычных задач — Ketner Pro, а для сложной математики, логики и кода на Pro и Ultra — GPT-6.1 Sol, пока не израсходована квота премиум-запросов; после этого отвечает Ketner Pro. Но в любой момент в выпадающем меню чата вы можете переключиться на нужную модель вручную.',
      en: 'Absolutely. By default, "Best AI (Auto)" picks the model for you: Ketner Mini on the Free plan and for simple questions, Ketner Pro for everyday tasks, and GPT-6.1 Sol for hard maths, logic and code on Pro and Ultra while your premium-request quota lasts — after that Ketner Pro answers instead. You can open the model picker at any time to pick a model yourself.',
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
