import planFacts from '../billing/plan-facts.json';
import type { Language } from '../preferences/preferences-store';

export interface FaqItem {
  id: string;
  q: Record<Language, string>;
  a: Record<Language, string>;
}

/** Число с разделителем тысяч: «2 300» по-русски, «2,300» по-английски. */
function num(value: number, language: Language): string {
  return value
    .toLocaleString(language === 'en' ? 'en-US' : 'ru-RU')
    .replace(/[\u00a0\u202f]/g, ' ');
}

// Числа берутся из plan-facts.json: его сверяет с сервером тест plan-facts.test.ts.
const FIRST_PACK = planFacts.packs[0];
const LAST_PACK = planFacts.packs[planFacts.packs.length - 1];
const TRIAL_CREDITS = planFacts.trial.credits;
const TRIAL_DAYS = planFacts.trial.days;
const VALID_DAYS = planFacts.packValidDays;
const BONUS_PERCENT = Math.round(planFacts.cryptoBonusRate * 100);
const FREE_PER_DAY = planFacts.levels.free.messagesPerDay;
const CREDITS_PER_DAY = planFacts.levels.credits.messagesPerDay;
const FREE_IMAGES = Object.values(planFacts.levels.free.imagesPerDay)[0] ?? 0;

export const FAQ_ITEMS: FaqItem[] = [
  {
    id: 'credits',
    q: {
      ru: 'Как работают кредиты?',
      en: 'How do credits work?',
    },
    a: {
      ru: `Кредиты покупаются пакетами: от $${FIRST_PACK.priceUsd} (${num(FIRST_PACK.credits, 'ru')} кредитов) до $${LAST_PACK.priceUsd} (${num(LAST_PACK.credits, 'ru')}), и чем больше пакет, тем дешевле кредит. Подписки нет: платите один раз и тратите, когда нужно. Кредит — это одна тысячная доллара реальной стоимости запроса, поэтому каждый запрос списывает ровно столько, сколько он стоил: вопрос к Ketner Mini — около 2 кредитов, к Claude Opus — десятки. Чат, картинки и Ketner Code тратят общий баланс. Купленные кредиты действуют ${VALID_DAYS} дней, первыми тратятся те, что сгорают раньше; при оплате криптовалютой добавляем ещё +${BONUS_PERCENT}% кредитов. Новому пользователю дарим ${TRIAL_CREDITS} пробных кредитов на ${TRIAL_DAYS} дней. Цена запроса каждой модели — на странице «Модели».`,
      en: `Credits are bought in packs: from $${FIRST_PACK.priceUsd} (${num(FIRST_PACK.credits, 'en')} credits) to $${LAST_PACK.priceUsd} (${num(LAST_PACK.credits, 'en')}), and the bigger the pack, the cheaper a credit. There is no subscription: pay once and spend when you need to. A credit is a thousandth of a dollar of the real cost of a request, so every request is charged exactly what it cost: a question to Ketner Mini is about 2 credits, to Claude Opus tens. Chat, images and Ketner Code spend one shared balance. Purchased credits are valid for ${VALID_DAYS} days, and the ones expiring first are spent first; paying with crypto adds another +${BONUS_PERCENT}% credits. A new user gets ${TRIAL_CREDITS} trial credits for ${TRIAL_DAYS} days. The price of every model is on the Models page.`,
    },
  },
  {
    id: 'unlimited',
    q: {
      ru: 'Что будет, когда кредиты закончатся?',
      en: 'What happens when I run out of credits?',
    },
    a: {
      ru: `Ответы не прекращаются: в чате отвечает бесплатная Nemotron 3 Ultra, в Ketner Code — бесплатная North Mini Code, кредиты не тратятся. Картинки — только FLUX.1 schnell, до ${FREE_IMAGES} в сутки. Платные модели вернутся после пополнения. Если кредитов не хватает на выбранную дорогую модель, но хватает на другую, ответит модель подешевле — какая именно, видно под ответом. Кроме кредитов есть защитные лимиты от перегрузки: без купленных кредитов до ${num(FREE_PER_DAY, 'ru')} сообщений в сутки, пока купленные кредиты есть — до ${num(CREDITS_PER_DAY, 'ru')}. Все числа — на странице «Кредиты».`,
      en: `Answers do not stop: free Nemotron 3 Ultra answers in chat and free North Mini Code in Ketner Code, and no credits are spent. Images fall back to FLUX.1 schnell, up to ${FREE_IMAGES} a day. Paid models come back after you top up. If your balance is too low for the selected premium model but enough for another, a cheaper model answers; which one is shown under the reply. Besides credits there are overload limits: up to ${num(FREE_PER_DAY, 'en')} messages a day without purchased credits, and up to ${num(CREDITS_PER_DAY, 'en')} while you have purchased credits. All numbers are on the Credits page.`,
    },
  },
  {
    id: 'models',
    q: {
      ru: 'Какие модели доступны в Ketner AI?',
      en: 'Which AI models are included in Ketner AI?',
    },
    a: {
      ru: 'Все, сразу после регистрации: модель определяет только цена запроса в кредитах. Это Ketner Mini (GPT-6 Luna от OpenAI), Ketner Pro (MiMo-V2.6 Pro от Xiaomi), Claude Haiku 5.5, Sonnet 5.5 и Opus 5.5 (Anthropic), GPT-6.1 Sol, GPT-6 Astra, GPT-5.6 Sol и GPT-5.6 Terra (OpenAI), Grok 4.7 (xAI), Gemini 3.7 Flash (Google), DeepSeek V4.1 Flash и другие. Режим Max, где модели думают глубже, и все модели картинок тоже открыты всем, запрос в Max стоит дороже обычного. Когда кредиты кончаются, отвечает бесплатная NVIDIA Nemotron 3 Ultra. Ketner AI своих моделей не обучает: все они от сторонних разработчиков и подключены через OpenRouter. Полный список с ценой запроса — на странице «Модели».',
      en: 'All of them, right after sign-up: only the credit price of a request differs. That includes Ketner Mini (GPT-6 Luna by OpenAI), Ketner Pro (MiMo-V2.6 Pro by Xiaomi), Claude Haiku 5.5, Sonnet 5.5 and Opus 5.5 (Anthropic), GPT-6.1 Sol, GPT-6 Astra, GPT-5.6 Sol and GPT-5.6 Terra (OpenAI), Grok 4.7 (xAI), Gemini 3.7 Flash (Google), DeepSeek V4.1 Flash and more. Max mode, where models think deeper, and every image model are open to everyone too, and a Max request costs more than a regular one. When credits run out, free NVIDIA Nemotron 3 Ultra answers. Ketner AI does not train its own models: all of them come from third-party developers via OpenRouter. The full list with the price of a request is on the Models page.',
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
      ru: `ChatGPT Plus стоит $20 в месяц и привязывает вас к одной компании (OpenAI). В Ketner AI подписки нет: вы покупаете кредиты один раз (пакет от $${FIRST_PACK.priceUsd}) и тратите их на GPT, Claude, Gemini, Grok и другие модели в одном окне. Платите только за запросы, а неиспользованные кредиты не сгорают в конце месяца, а действуют ${VALID_DAYS} дней.`,
      en: `ChatGPT Plus costs $20 a month and ties you to one company (OpenAI). Ketner AI has no subscription: you buy credits once (a pack from $${FIRST_PACK.priceUsd}) and spend them on GPT, Claude, Gemini, Grok and other models in one window. You pay only for requests, and unused credits do not vanish at the end of the month: they last ${VALID_DAYS} days.`,
    },
  },
  {
    id: 'refund',
    q: {
      ru: 'Можно ли вернуть деньги?',
      en: 'Can I get a refund?',
    },
    a: {
      ru: 'Да, в течение 24 часов после оплаты — если вы ещё не потратили кредиты этого пакета (пробные кредиты возврат не закрывают). Оформите заявку кнопкой «Подать заявку на возврат» в кабинете бота @Robo_kassa_bot (раздел «Платежи») или напишите в поддержку @ketner_support_bot. Заявку проверяет администратор, обычно в течение суток; после одобрения звёзды возвращаются на баланс Telegram, а криптовалюта — на ваш кошелёк, кредиты пакета списываются. Если кредиты пакета уже тратились или прошло больше 24 часов, оплата не возвращается.',
      en: 'Yes, within 24 hours of paying — if you have not spent this pack’s credits yet (trial credits do not block a refund). Use “Request a refund” in the @Robo_kassa_bot account (the “Payments” tab) or message support at @ketner_support_bot. An administrator reviews every request, usually within a day; once approved, Stars go back to your Telegram balance and crypto to your wallet, and the pack’s credits are removed. If the pack’s credits were already used or more than 24 hours have passed, the payment is not refunded.',
    },
  },
];
