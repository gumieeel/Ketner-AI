/**
 * Что из продукта сейчас открыто (решения владельца 14.11.2026). Те же значения, что на сервере:
 * apps/mock-api/src/product-switches.ts (совпадение проверяет тест сервера product-switches.test.ts).
 * Одна константа на возможность, без переменных окружения. Закрытая возможность: входы спрятаны,
 * адрес показывает «временно недоступно», сервер отвечает 503 `feature_unavailable`.
 */

/** Оплата Telegram Stars (новые счета; возвраты прежних платежей остаются). */
export const STARS_ENABLED = false;
/** Общий чат с моделями. */
export const CHAT_ENABLED = false;
/** Ketner Code. */
export const CODE_ENABLED = false;
/** Генерация картинок (раздел «Изображения»). */
export const IMAGES_ENABLED = false;
/** API для разработчиков (/v1, ключи, документация API). */
export const DEVELOPER_API_ENABLED = false;
/** Проверка ответа чата моделью другой компании. */
export const ANSWER_REVIEW_ENABLED = false;
/** Сравнение ответов моделей. */
export const MODEL_COMPARE_ENABLED = false;

export const PRODUCT_SWITCHES = {
  stars: STARS_ENABLED,
  chat: CHAT_ENABLED,
  code: CODE_ENABLED,
  images: IMAGES_ENABLED,
  developerApi: DEVELOPER_API_ENABLED,
  answerReview: ANSWER_REVIEW_ENABLED,
  modelCompare: MODEL_COMPARE_ENABLED,
} as const;

export type ProductFeature = keyof typeof PRODUCT_SWITCHES;

let testOverrides: Partial<Record<ProductFeature, boolean>> = {};

/** Только для тестов спящего кода закрытых возможностей; сайт в production их не меняет. */
export function setProductSwitchesForTests(
  overrides: Partial<Record<ProductFeature, boolean>>,
): void {
  testOverrides = { ...overrides };
}

export function productSwitch(feature: ProductFeature): boolean {
  return testOverrides[feature] ?? PRODUCT_SWITCHES[feature];
}

/** Куда вести после входа и с кнопок «в приложение»: чат закрыт — к своим решениям. */
export function appHomePath(): string {
  return productSwitch('chat') ? '/chat' : '/solutions';
}
