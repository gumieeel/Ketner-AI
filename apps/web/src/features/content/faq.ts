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
      ru: 'Есть ли ограничения?',
      en: 'Are there any limits?',
    },
    a: {
      ru: 'Тарифы рассчитаны на обычную работу человека: переписку, код, документы и картинки. Действует политика честного использования — она защищает сервис от автоматических массовых запросов, а не от вас.',
      en: 'Plans are built for normal human use: chat, code, documents and images. A fair-use policy applies; it protects the service from automated bulk traffic, not from you.',
    },
  },
  {
    id: 'models',
    q: {
      ru: 'Какие модели доступны в Ketner AI?',
      en: 'Which AI models are included in Ketner AI?',
    },
    a: {
      ru: 'На тарифе Free доступна Ketner Mini. Plus добавляет Ketner Pro, GPT-6.1 Sol (OpenAI), Claude Haiku 5.5 (Anthropic) и DeepSeek V4.1 Flash. Pro открывает Claude Opus 5.5 и Sonnet 5.5 (Anthropic), GPT-6 Astra, GPT-5.6 Sol и GPT-5.6 Terra xhigh (OpenAI) и Grok 4.7 xhigh (xAI). Ultra добавляет режим Max, в котором модели думают глубже, и лучшие модели картинок. Новые модели появляются вскоре после официального релиза.',
      en: 'The Free plan includes Ketner Mini. Plus adds Ketner Pro, GPT-6.1 Sol (OpenAI), Claude Haiku 5.5 (Anthropic) and DeepSeek V4.1 Flash. Pro unlocks Claude Opus 5.5 and Sonnet 5.5 (Anthropic), GPT-6 Astra, GPT-5.6 Sol and GPT-5.6 Terra xhigh (OpenAI) and Grok 4.7 xhigh (xAI). Ultra adds Max mode, where models think deeper, and the best image models. New models arrive soon after their official release.',
    },
  },
  {
    id: 'speed',
    q: {
      ru: 'Почему ответы приходят так быстро?',
      en: 'Why are responses so fast?',
    },
    a: {
      ru: 'Ketner подключается к моделям напрямую и передаёт ответ потоком, по мере того как модель его пишет, — не нужно ждать конца генерации.',
      en: 'Ketner connects to the models directly and streams the reply as the model writes it, so you never wait for the whole answer.',
    },
  },
  {
    id: 'manual-model',
    q: {
      ru: 'Могу ли я выбрать модель самостоятельно?',
      en: 'Can I choose the model manually?',
    },
    a: {
      ru: 'Да. По умолчанию включён режим Auto: он сам подбирает модель под вопрос. В любой момент в меню чата можно выбрать модель вручную.',
      en: 'Yes. Auto is on by default and picks a model for each question. You can pick a model yourself in the chat menu at any time.',
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
