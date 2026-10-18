/**
 * Заголовки открытых страниц. Должны совпадать с теми, что сервер кладёт в HTML
 * (apps/mock-api/src/seo/pages.ts): иначе после загрузки скриптов заголовок вкладки
 * и заголовок в выдаче расходятся. Совпадение проверяет тест seo/pages.test.ts.
 */
export const PAGE_TITLES: Readonly<Record<string, string>> = {
  '/': 'Ketner AI — ChatGPT, Claude, Gemini и Grok в одном ИИ-чате на русском',
  '/pricing': 'Тарифы Ketner AI — ChatGPT, Claude и Gemini по одной подписке',
  '/docs': 'Как пользоваться Ketner AI — модели, тарифы и возможности',
  '/docs/plans/free': 'Бесплатный тариф Ketner AI — ИИ-чат без оплаты',
  '/docs/plans/plus': 'Тариф Plus в Ketner AI — GPT и сильные модели недорого',
  '/docs/plans/pro': 'Тариф Pro в Ketner AI — Claude Opus, Sonnet, GPT и Grok',
  '/docs/plans/ultra': 'Тариф Ultra в Ketner AI — все модели и режим Max',
  '/docs/api': 'API Ketner AI — OpenAI-совместимый API для GPT и Claude',
  '/models': 'Модели Ketner AI — кто разработал каждую нейросеть и какие лимиты',
  '/about': 'О проекте Ketner AI — кто мы и что делаем',
  '/changelog': 'Что нового в Ketner AI — журнал обновлений',
  '/status': 'Статус Ketner AI — работа сервиса и сбои',
  '/signup': 'Регистрация в Ketner AI — начать бесплатно',
  '/contacts': 'Контакты Ketner AI — поддержка',
  '/terms': 'Пользовательское соглашение — Ketner AI',
  '/privacy': 'Политика конфиденциальности — Ketner AI',
  '/payment-terms': 'Условия оплаты и возврата — Ketner AI',
};
