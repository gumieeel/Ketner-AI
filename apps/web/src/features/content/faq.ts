import planFacts from '../billing/plan-facts.json';
import type { Language } from '../preferences/preferences-store';
import { TIERS } from '../billing/tiers';
import { REFUND_DAYS } from './legal';

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
const FREE_PER_DAY = planFacts.levels.free.messagesPerDay;
const CREDITS_PER_DAY = planFacts.levels.credits.messagesPerDay;
const FREE_IMAGES = Object.values(planFacts.levels.free.imagesPerDay)[0] ?? 0;

export const FAQ_ITEMS: FaqItem[] = [
  {
    id: 'pricing',
    q: {
      ru: 'Сколько стоит Ketner AI?',
      en: 'How much does Ketner AI cost?',
    },
    a: {
      ru: `Анализ задачи, создание и проверка помощников и ботов — бесплатно, в пределах бесплатного лимита. Платно — тариф на работающие решения: ${TIERS.map((tier) => `${tier.name} — $${tier.priceUsd}`).join(', ')} в месяц, по числу ботов и обращений клиентов. Тариф подключает команда Ketner по заявке, автоматических списаний нет. Пакеты кредитов больше не продаются.`,
      en: `Analysing the task and building and testing assistants and bots are free, within the free allowance. You pay for a plan for working solutions: ${TIERS.map((tier) => `${tier.name} $${tier.priceUsd}`).join(', ')} per month, by the number of bots and customer requests. The Ketner team connects a plan on request, and there are no automatic charges. Credit packs are no longer sold.`,
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
    id: 'refund',
    q: {
      ru: 'Можно ли вернуть деньги?',
      en: 'Can I get a refund?',
    },
    a: {
      ru: `За пакеты кредитов, купленные до 20 ноября 2026 г., — да. В течение ${REFUND_DAYS} дней после оплаты пакет можно вернуть полностью, если вы ещё не потратили его кредиты (пробные кредиты возврат не закрывают). Оформите заявку кнопкой «Подать заявку на возврат» в кабинете бота @Robo_kassa_bot (раздел «Платежи») или напишите в поддержку @ketner_support_bot. Заявку проверяет администратор, обычно в течение суток; после одобрения звёзды возвращаются на баланс Telegram, а криптовалюта — на ваш кошелёк (комиссию сети за возврат платим мы), кредиты пакета списываются. Если кредиты пакета уже тратились или прошло больше ${REFUND_DAYS} дней, оплата не возвращается, кроме случаев сбоя или двойного списания. Права покупателей из ЕС и Великобритании на отказ от договора описаны на странице «Оплата и возврат».`,
      en: `For credit packs bought before November 20, 2026, yes. Within ${REFUND_DAYS} days of paying you can get a pack refunded in full, if you have not spent its credits yet (trial credits do not block a refund). Use “Request a refund” in the @Robo_kassa_bot account (the “Payments” tab) or message support at @ketner_support_bot. An administrator reviews every request, usually within a day; once approved, Stars go back to your Telegram balance and crypto to your wallet (we pay the network fee for the refund), and the pack’s credits are removed. If the pack’s credits were already used or more than ${REFUND_DAYS} days have passed, the payment is not refunded, except in case of a failure or a double charge. The withdrawal rights of buyers in the EU and UK are described on the Payments and Refunds page.`,
    },
  },
];
