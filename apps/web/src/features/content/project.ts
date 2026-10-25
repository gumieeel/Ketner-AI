/**
 * Сведения о проекте для страниц «О проекте», «Статус», «Что нового» и «Контакты».
 * Даты — по истории репозитория.
 */
export const PROJECT = {
  name: 'Ketner AI',
  team: 'команда Ketner',
  stage: 'Открытая бета',
  /** Первый коммит: каркас сайта. */
  developmentStarted: '22 сентября 2026 г.',
  /** Сайт начал отвечать настоящими моделями — дата запуска. */
  launched: '2 октября 2026 г.',
  /** Оплата Trybit на сайте, API и бот для оплаты звёздами. */
  paymentsStarted: '13 октября 2026 г.',
  supportTelegram: 'ketner_support_bot',
} as const;

export const SUPPORT_TELEGRAM_URL = `https://t.me/${PROJECT.supportTelegram}`;
