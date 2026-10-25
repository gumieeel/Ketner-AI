import type { Language } from '../preferences/preferences-store';

export interface FaqItem {
  id: string;
  q: Record<Language, string>;
  a: Record<Language, string>;
}

export const FAQ_ITEMS: FaqItem[] = [
  {
    id: 'credits',
    q: {
      ru: 'Как работают кредиты?',
      en: 'How do credits work?',
    },
    a: {
      ru: 'Тариф даёт кредиты на 30 дней: Plus — 3 000, Pro — 11 000, Ultra — 22 000, Free — 300. Кредит — это одна тысячная доллара реальной стоимости запроса, поэтому каждый запрос списывает ровно столько, сколько он стоил: вопрос к Ketner Mini — около 2 кредитов, к Claude Opus — десятки. Чат, картинки и Ketner Code тратят общий пул. Неизрасходованный остаток переносится ещё на один период. Цена запроса каждой модели — на странице «Модели».',
      en: 'Your plan gives you credits for 30 days: Plus 3,000, Pro 11,000, Ultra 22,000, Free 300. A credit is a thousandth of a dollar of the real cost of a request, so every request is charged exactly what it cost: a question to Ketner Mini is about 2 credits, to Claude Opus tens. Chat, images and Ketner Code spend one shared pool. Unused credits carry over for one more period. The price of every model is on the Models page.',
    },
  },
  {
    id: 'unlimited',
    q: {
      ru: 'Что будет, когда кредиты закончатся?',
      en: 'What happens when I run out of credits?',
    },
    a: {
      ru: 'Ответы не прекращаются: в чате отвечает бесплатная Nemotron 3 Ultra, в Ketner Code — бесплатная North Mini Code, кредиты не тратятся. Картинки — только FLUX.1 schnell, до 5 в сутки. Платные модели вернутся с новыми кредитами; дату видно в строке под полем ввода. Если кредитов не хватает на выбранную дорогую модель, но хватает на другую, ответит модель подешевле — какая именно, видно под ответом. Кроме кредитов есть лимиты от перегрузки: сообщения в сутки — Free 10, Plus 500, Pro 1 500, Ultra 4 000. Все числа — на странице «Тарифы».',
      en: 'Answers do not stop: free Nemotron 3 Ultra answers in chat and free North Mini Code in Ketner Code, and no credits are spent. Images fall back to FLUX.1 schnell, up to 5 a day. Paid models come back with new credits; the date is shown in the line under the chat input. If your balance is too low for the selected premium model but enough for another, a cheaper model answers; which one is shown under the reply. Besides credits there are overload limits: messages per day, Free 10, Plus 500, Pro 1,500, Ultra 4,000. All numbers are on the Pricing page.',
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
