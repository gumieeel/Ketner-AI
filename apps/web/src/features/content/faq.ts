import type { Language } from '../preferences/preferences-store';

export interface FaqItem {
  id: string;
  q: Record<Language, string>;
  a: Record<Language, string>;
}

export const FAQ_ITEMS: FaqItem[] = [
  {
    id: 'what-is',
    q: {
      ru: 'Что такое Ketner AI?',
      en: 'What is Ketner AI?',
    },
    a: {
      ru: 'Ketner AI — сервис, в котором модели разных разработчиков (OpenAI, Anthropic, Google, xAI, DeepSeek и других) доступны в одном чате на русском языке по одной подписке. Режим Auto сам подбирает модель под вопрос, есть генерация изображений и Ketner Code для программирования. Собственных моделей Ketner AI не обучает.',
      en: 'Ketner AI is a service where models from different developers (OpenAI, Anthropic, Google, xAI, DeepSeek and others) are available in one chat on a single subscription. Auto mode picks a model for each question, and there are image generation and Ketner Code for programming. Ketner AI does not train its own models.',
    },
  },
  {
    id: 'price',
    q: {
      ru: 'Сколько стоит Ketner AI?',
      en: 'How much does Ketner AI cost?',
    },
    a: {
      ru: 'Есть бесплатный тариф: 10 сообщений в сутки. Платные тарифы стоят в месяц (30 дней): Plus — $9 (500 сообщений в сутки), Pro — $25 (1 500 сообщений в сутки), Ultra — $49 (4 000 сообщений в сутки и режим Max). Подробности по моделям — на странице «Тарифы».',
      en: 'There is a free plan: 10 messages a day. Paid plans cost per month (30 days): Plus is $9 (500 messages a day), Pro is $25 (1,500 messages a day), Ultra is $49 (4,000 messages a day and Max mode). Model details are on the Pricing page.',
    },
  },
  {
    id: 'payment',
    q: {
      ru: 'Как оплатить подписку?',
      en: 'How do I pay for a subscription?',
    },
    a: {
      ru: 'Оплата звёздами Telegram или криптовалютой. Платёж разовый, автоматических списаний нет: автопродление звёздами включается только по вашему желанию и отключается в любой момент.',
      en: 'Pay with Telegram Stars or crypto. Payment is one-off with no automatic charges: Stars auto-renewal is only on if you turn it on, and you can turn it off at any time.',
    },
  },
  {
    id: 'unlimited',
    q: {
      ru: 'Есть ли ограничения?',
      en: 'Are there any limits?',
    },
    a: {
      ru: 'Ответы не заканчиваются, когда кончился лимит сильной модели. Например, на Pro можно отправить 21 запрос Claude Opus 5.5 в неделю, не больше 8 в сутки, — дальше отвечает модель попроще (какая именно, указано на странице «Модели»). Общий предел тарифа — сообщения в сутки: Free — 10, Plus — 500, Pro — 1 500, Ultra — 4 000. Все числа — на странице «Тарифы».',
      en: 'Answers do not stop when a strong model hits its limit. On Pro, for example, you can send 21 Claude Opus 5.5 requests a week, at most 8 a day; after that a simpler model answers (which one is shown on the Models page). The overall plan limit is messages per day: Free 10, Plus 500, Pro 1,500, Ultra 4,000. All numbers are on the Pricing page.',
    },
  },
  {
    id: 'models',
    q: {
      ru: 'Какие модели доступны в Ketner AI?',
      en: 'Which AI models are included in Ketner AI?',
    },
    a: {
      ru: 'На тарифе Free отвечают бесплатные версии моделей (сейчас NVIDIA Nemotron 3 Ultra), запасная — Ketner Mini (это GPT-6 Luna от OpenAI). Plus добавляет Ketner Pro (MiMo-V2.6 Pro от Xiaomi), GPT-6.1 Sol (OpenAI), Claude Haiku 5.5 (Anthropic) и DeepSeek V4.1 Flash. Pro открывает Claude Opus 5.5 и Sonnet 5.5 (Anthropic), GPT-6 Astra, GPT-5.6 Sol и GPT-5.6 Terra xhigh (OpenAI) и Grok 4.7 xhigh (xAI). Ultra добавляет режим Max, в котором модели думают глубже, и лучшие модели картинок. Ketner AI своих моделей не обучает: все они от сторонних разработчиков и подключены через OpenRouter. Полный список — на странице «Модели».',
      en: 'On Free, free model versions answer (currently NVIDIA Nemotron 3 Ultra), with Ketner Mini (GPT-6 Luna by OpenAI) as backup. Plus adds Ketner Pro (MiMo-V2.6 Pro by Xiaomi), GPT-6.1 Sol (OpenAI), Claude Haiku 5.5 (Anthropic) and DeepSeek V4.1 Flash. Pro unlocks Claude Opus 5.5 and Sonnet 5.5 (Anthropic), GPT-6 Astra, GPT-5.6 Sol and GPT-5.6 Terra xhigh (OpenAI) and Grok 4.7 xhigh (xAI). Ultra adds Max mode, where models think deeper, and the best image models. Ketner AI does not train its own models: all of them come from third-party developers via OpenRouter. The full list is on the Models page.',
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
  {
    id: 'refund',
    q: {
      ru: 'Можно ли вернуть деньги?',
      en: 'Can I get a refund?',
    },
    a: {
      ru: 'Да, в течение 24 часов после оплаты — если вы ещё не сделали ни одного запроса к моделям. Оформите заявку кнопкой «Подать заявку на возврат» в кабинете бота @Robo_kassa_bot (раздел «Платежи») или напишите в поддержку @ketner_support_bot. Заявку проверяет администратор, обычно в течение суток; после одобрения звёзды возвращаются на баланс Telegram, а криптовалюта — на ваш кошелёк. Если моделями уже пользовались или прошло больше 24 часов, оплата не возвращается. После возврата дни этой оплаты снимаются с подписки, автопродление отключается.',
      en: 'Yes, within 24 hours of paying — if you have not made a single request to the models yet. Use “Request a refund” in the @Robo_kassa_bot account (the “Payments” tab) or message support at @ketner_support_bot. An administrator reviews every request, usually within a day; once approved, Stars go back to your Telegram balance and crypto to your wallet. If the models were already used or more than 24 hours have passed, the payment is not refunded. After a refund, the days from that payment are removed from the subscription and auto-renewal turns off.',
    },
  },
];
