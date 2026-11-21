/**
 * Что из продукта сейчас открыто (решения владельца 14.11.2026). Одна константа на возможность,
 * без переменных окружения: включить снова — только правкой кода и ревью.
 *
 * Главный продукт — решения для бизнеса (анализ, создание, проверка, боты). Возможности ниже
 * закрыты: код и данные остаются, сервер отвечает 503 `feature_unavailable`, сайт прячет входы.
 * Сайт держит те же значения в apps/web/src/lib/product-switches.ts (их сверяет
 * product-switches.test.ts).
 */

import type { NextFunction, Request, Response } from 'express';

/** Оплата Telegram Stars: новые счета не выставляются; возвраты прежних платежей работают. */
export const STARS_ENABLED = false;
/**
 * Продажа пакетов кредитов (задача 0b): новых счетов нет — ни криптовалютой, ни звёздами. Платно —
 * тариф (services/tiers.ts). Статус и подтверждение уже выставленных счетов и вебхуки оплаты
 * работают: оплаченный ранее счёт зачисляется.
 */
export const PACKS_ENABLED = false;
/** Общий чат с моделями (`/api/chat`, `/api/conversations`). Диалоги в базе остаются. */
export const CHAT_ENABLED = false;
/** Ketner Code (`/api/code`). Проекты в базе остаются. */
export const CODE_ENABLED = false;
/** Генерация картинок (`/api/images`, кроме выдачи готовых файлов — их показывает чат помощника). */
export const IMAGES_ENABLED = false;
/** API для разработчиков (`/v1`, выпуск новых ключей `POST /api/keys`). */
export const DEVELOPER_API_ENABLED = false;
/** Проверка ответа чата моделью другой компании (`/api/chat/review`). */
export const ANSWER_REVIEW_ENABLED = false;
/** Сравнение ответов моделей (`/api/chat/compare`). */
export const MODEL_COMPARE_ENABLED = false;
/**
 * Запись заявок в Google Таблицу владельца (этап F, docs/STAGE_F_SHEETS.md). Выключено до проверки
 * на настоящем аккаунте Google; кроме переключателя нужны GOOGLE_SHEETS_CLIENT_ID / _SECRET.
 */
export const GOOGLE_SHEETS_ENABLED = false;
/**
 * Пилот Google Таблиц (этап F, шаг 5a): аккаунты, для которых запись заявок работает при
 * выключенном `GOOGLE_SHEETS_ENABLED` — проверка на настоящем аккаунте Google. Остальные получают
 * 503 и не видят карточку: сайт решает по ответу `GET /api/integrations/google`, поэтому список
 * живёт только на сервере и в код сайта (открытый) не попадает.
 */
export const GOOGLE_SHEETS_PILOT_ACCOUNTS: readonly string[] = [
  // Владелец
  'c4b78d88-6aee-4183-bd19-33a40e9ffece',
];

export const PRODUCT_SWITCHES = {
  stars: STARS_ENABLED,
  packs: PACKS_ENABLED,
  chat: CHAT_ENABLED,
  code: CODE_ENABLED,
  images: IMAGES_ENABLED,
  developerApi: DEVELOPER_API_ENABLED,
  answerReview: ANSWER_REVIEW_ENABLED,
  modelCompare: MODEL_COMPARE_ENABLED,
  googleSheets: GOOGLE_SHEETS_ENABLED,
} as const;

export type ProductFeature = keyof typeof PRODUCT_SWITCHES;

/**
 * Включение закрытой возможности только для тестов её спящего кода (каждый файл тестов — свой
 * процесс). В production не работает: там действуют только константы выше.
 */
const testOverrides = new Map<ProductFeature, boolean>();

export function setProductSwitchForTests(feature: ProductFeature, enabled: boolean): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('product switches cannot be changed in production');
  }
  testOverrides.set(feature, enabled);
}

export function productSwitch(feature: ProductFeature): boolean {
  return testOverrides.get(feature) ?? PRODUCT_SWITCHES[feature];
}

const MESSAGES: Record<ProductFeature, string> = {
  stars: 'Оплата звёздами Telegram больше не принимается.',
  packs:
    'Пакеты кредитов больше не продаются. Платно — тариф на работающие решения: ketner.org/pricing.',
  chat: 'Чат временно недоступен. Ketner сейчас — решения для бизнеса: анализ, боты и агенты.',
  code: 'Ketner Code временно недоступен.',
  images: 'Генерация картинок временно недоступна.',
  developerApi: 'API для разработчиков временно недоступен.',
  answerReview: 'Проверка ответов временно недоступна.',
  modelCompare: 'Сравнение моделей временно недоступно.',
  googleSheets: 'Запись заявок в Google Таблицу пока недоступна.',
};

let pilotOverride: readonly string[] | null = null;

/** Только для тестов: свой список пилота; `null` — список из кода. */
export function setGoogleSheetsPilotForTests(accounts: readonly string[] | null): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('product switches cannot be changed in production');
  }
  pilotOverride = accounts;
}

function pilotAccounts(): readonly string[] {
  return pilotOverride ?? GOOGLE_SHEETS_PILOT_ACCOUNTS;
}

/** Google Таблицы для аккаунта: переключатель открыт для всех или аккаунт в пилоте. */
export function googleSheetsEnabledFor(userId: string | null | undefined): boolean {
  if (productSwitch('googleSheets')) return true;
  return Boolean(userId) && pilotAccounts().includes(userId!);
}

/** Есть ли хоть кто-то, для кого Google Таблицы работают (обход доставки). */
export function googleSheetsEnabledForAnyone(): boolean {
  return productSwitch('googleSheets') || pilotAccounts().length > 0;
}

/** Ответ закрытой возможности: 503 `feature_unavailable` с понятным сообщением. */
export function sendFeatureUnavailable(response: Response, feature: ProductFeature): void {
  response.status(503).json({
    error: { code: 'feature_unavailable', message: MESSAGES[feature], details: { feature } },
  });
}

/** Middleware: возможность закрыта — 503 до любых проверок и обработчиков роутера. */
export function requireFeature(feature: ProductFeature) {
  return (_request: Request, response: Response, next: NextFunction): void => {
    if (productSwitch(feature)) {
      next();
      return;
    }
    sendFeatureUnavailable(response, feature);
  };
}
