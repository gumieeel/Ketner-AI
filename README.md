# Ketner AI

**Единый интерфейс для работы со всеми топовыми AI-моделями.** GPT, Claude, Gemini, Grok, DeepSeek и другие — в одном месте, без отдельных подписок на каждого провайдера.

> **Live Demo**: [https://ketner-ai.onrender.com](https://ketner-ai.onrender.com)

---

## Что это

Ketner AI — это production-ready SaaS-платформа с полноценным AI-шлюзом, системой тарифов и интегрированными платёжными провайдерами. Архитектурно продукт готов к реальной нагрузке: если передать ключи AI-провайдеров и подключить Stripe/ЮKassa — всё заработает без изменения фронтенда.

При отсутствии ключей система автоматически падает в fallback-режим: отвечает шаблонными ответами и сохраняет диалоги локально. Этот режим называется «Demo» в UI.

---

## Стек

| Слой               | Технология                   | Версия       |
| ------------------ | ---------------------------- | ------------ |
| **Фронтенд**       | React + TypeScript           | 19.3 / 6.0.3 |
| **Сборка**         | Vite                         | 8.3          |
| **Стили**          | Tailwind CSS                 | 4.3          |
| **Маршрутизация**  | React Router                 | 7.18         |
| **Состояние**      | Zustand                      | 5.0          |
| **Бэкенд**         | Node.js + Express            | 24 / 5.2     |
| **Аутентификация** | Better Auth + SQLite         | —            |
| **БД (prod)**      | PostgreSQL через Drizzle ORM | —            |
| **Тесты**          | Vitest + Testing Library     | 5.0 / 16.3   |
| **Монорепо**       | npm workspaces               | npm 11       |

---

## Быстрый старт

**Требования:** Node.js 22.12+ (нужен встроенный `node:sqlite`; разрабатывалось на 24.21), npm 10+

```bash
npm install
npm run dev
```

Запустятся два процесса:

- **Фронтенд** → http://localhost:5173
- **Backend API** → http://localhost:8787 (контракт: `GET /api`)

Запросы с фронтенда на `/api/*` проксируются через Vite, CORS в разработке не мешает.

```bash
# Запустить по отдельности
npm run dev:web   # только фронтенд
npm run dev:api   # только API
```

---

## Команды

| Команда             | Что делает                          |
| ------------------- | ----------------------------------- |
| `npm run dev`       | Фронтенд + API одновременно         |
| `npm run build`     | Production-сборка обоих воркспейсов |
| `npm run typecheck` | Проверка типов без эмита            |
| `npm run lint`      | ESLint по всему монорепо            |
| `npm test`          | Тесты фронтенда + smoke-тесты API   |
| `npm run format`    | Prettier с автоисправлением         |

---

## Переменные окружения

Все переменные опциональны. При отсутствии AI-ключей сервер отвечает шаблонными ответами. При отсутствии ключей Stripe/Telegram включается mock-биллинг.

### ИИ

Все модели идут через один канал, OpenRouter, по одному ключу. Прямые ключи OpenAI, Anthropic и Google не нужны.

| Переменная            | Назначение                                                                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `OPENROUTER_API_KEY`  | Единый ключ для GPT, Claude, Grok, Gemini, DeepSeek и MiMo. Следите за балансом счёта: при нуле перестают работать все платные модели сразу |
| `OPENROUTER_BASE_URL` | Адрес API (по умолчанию `https://openrouter.ai/api/v1`)                                                                                     |

### Аутентификация

| Переменная           | Назначение                                    | По умолчанию            |
| -------------------- | --------------------------------------------- | ----------------------- |
| `BETTER_AUTH_SECRET` | Секрет для подписи сессий Better Auth         | `dev-secret-change-me`  |
| `BETTER_AUTH_URL`    | Публичный URL сервиса                         | `http://localhost:8787` |
| `DATABASE_URL`       | PostgreSQL (Supabase). Если не задан — SQLite | —                       |

### Платёжные провайдеры

| Переменная                        | Назначение                                     |
| --------------------------------- | ---------------------------------------------- |
| `STRIPE_SECRET_KEY`               | Stripe API-ключ (если не задан — mock-биллинг) |
| `STRIPE_WEBHOOK_SECRET`           | Секрет для верификации вебхуков Stripe         |
| `STRIPE_PRICE_PLUS`               | Stripe Price ID для тарифа Plus                |
| `STRIPE_PRICE_PRO`                | Stripe Price ID для тарифа Pro                 |
| `STRIPE_PRICE_ULTRA`              | Stripe Price ID для тарифа Ultra               |
| `TELEGRAM_BOT_TOKEN`              | Токен Telegram-бота для оплаты Stars и СБП     |
| `TELEGRAM_PAYMENT_PROVIDER_TOKEN` | Провайдер-токен для платежей в боте            |

### Прочее

| Переменная                          | Назначение                                        | По умолчанию                    |
| ----------------------------------- | ------------------------------------------------- | ------------------------------- |
| `PORT`                              | Порт API-сервера                                  | `8787`                          |
| `CORS_ORIGIN`                       | Разрешённый origin                                | `http://localhost:5173`         |
| `WEB_APP_URL`                       | URL фронтенда (для редиректов Stripe)             | `http://localhost:5173`         |
| `STORE_FILE`                        | Файл для хранения диалогов (fallback)             | `apps/mock-api/data/store.json` |
| `MOCK_AI_FAILURE_RATE`              | Доля запросов с ошибкой (для тестов)              | `0`                             |
| `VIP_EMAILS`                        | Email-адреса с автоматическим Ultra-тарифом       | —                               |
| `CODE_PROJECTS_DIR`                 | Каталог проектов Ketner Code                      | `apps/mock-api/data/projects`   |
| `SANDBOX_MODE`                      | Запуск команд агентом: `off` · `docker` · `local` | `off`                           |
| `SANDBOX_DOCKER_IMAGE`              | Образ для режима `docker`                         | `node:22-bookworm`              |
| `SANDBOX_ALLOW_NETWORK`             | Сеть внутри команд агента                         | `false`                         |
| `SANDBOX_ALLOW_LOCAL_IN_PRODUCTION` | Разрешить режим `local` в production              | `false`                         |

---

## Архитектура

### Монорепо

```
apps/
  web/                 Фронтенд (Vite + React)
    src/
      app/             Провайдеры, синхронизация темы
      components/      UI-примитивы, layout-каркасы, иконки
      features/        auth, billing, chat, preferences, models
      i18n/            Типизированные словари ru/en
      lib/             Утилиты: cn, storage, SSE-клиент
      pages/           Экраны
      router/          Маршруты
      tests/           Тесты (Vitest + Testing Library)
  mock-api/            Backend (Express + Node.js 24)
    src/
      ai/              AI Gateway, Model Registry, провайдеры, Auto-router
      auth/            Better Auth, JWT
      db/              Drizzle ORM: схема PostgreSQL, миграции
      middleware/       Аутентификация, ошибки
      routes/          Эндпоинты: auth, chat, billing, webhooks, admin
      services/        Stripe, Entitlement, Fair Use, Cost, VIP
      store/           Файловое хранилище (conversations, users, subscriptions)
      telegram/        Telegram-бот (Stars, СБП, long polling / webhook)
docs/                  Проектная документация
```

### AI Gateway

Центральный шлюз оркестрирует все запросы к AI:

1. **Проверка прав (Entitlement Service)** — тарифный план пользователя, доступные модели, лимиты контекста
2. **Fair Use Engine** — скользящие окна RPM / RPH / RPD, лимиты токенов, параллельные запросы
3. **Context Optimizer** — обрезка истории до `maxContextMessages` с сохранением релевантности
4. **Semantic Cache** — кэш запросов для снижения расходов
5. **Auto-router** — детерминированный выбор модели: Free и простые вопросы → Ketner Mini, обычные задачи → Ketner Pro, тяжёлая математика, логика и код на Pro/Ultra → GPT-6.1 Sol, пока не израсходована квота премиум-запросов
6. **Политика размышлений** — глубина размышлений (`reasoning.effort`) выбирается по сложности запроса, тарифу, остатку бюджета и тому, что поддерживает конкретная модель; потолок ответа зависит от тарифа и бюджета
7. **Failover** — если модель не ответила, шлюз берёт запасную из цепочки реестра (только допустимую по бюджету), а предохранитель ведётся отдельно на каждую модель. HTTP 401 / 402 от OpenRouter (ключ, баланс) не перебирает цепочку и громко пишется в лог
8. **Usage Accounting** — токены и фактическая стоимость (`usage.cost` от OpenRouter) записываются по той модели, которая реально ответила

Подробности: [docs/models-and-pricing.md](docs/models-and-pricing.md).

#### Модели

| Модель              | Класс  | Тариф | OpenRouter                     |
| ------------------- | ------ | ----- | ------------------------------ |
| Ketner Mini         | lite   | Free  | `openai/gpt-6-luna`            |
| Ketner Pro          | work   | Plus  | `xiaomi/mimo-v2.6-pro`         |
| Claude Haiku 5.5    | lite   | Plus  | `anthropic/claude-haiku-5.5`   |
| DeepSeek V4.1 Flash | lite   | Plus  | `deepseek/deepseek-v4.1-flash` |
| GPT-6.1 Sol         | strong | Plus  | `openai/gpt-6.1-sol`           |
| Gemini 3.8 Flash    | strong | Pro   | `google/gemini-3.8-flash`      |
| Grok 4.7            | strong | Pro   | `x-ai/grok-4.7`                |
| Claude Opus 5.5     | top    | Pro   | `anthropic/claude-opus-5.5`    |

Модели классов strong и top расходуют квоту премиум-запросов тарифа (скользящие 30 дней). Когда квота кончилась, отвечает Ketner Pro, а в ответе указана реальная модель.

### Тарифы и Fair Use

| Тариф     | Цена (USD/мес)     | Сообщений/сутки | Параллельных | Токенов/сутки | Бюджет расхода на модели | Квота премиум-запросов |
| --------- | ------------------ | --------------- | ------------ | ------------- | ------------------------ | ---------------------- |
| **Free**  | $0                 | 10              | 1            | 150 000       | $0.30                    | нет                    |
| **Plus**  | $9                 | 500             | 2            | 1 500 000     | $2.75                    | $0.45                  |
| **Pro**   | $25                | 1 500           | 4            | 6 000 000     | $10.00                   | $3.50                  |
| **Ultra** | $49 (скидка с $59) | 4 000           | 8            | 20 000 000    | $20.00                   | $9.00                  |

Цены тарифов хранятся в долларах в одном месте: `apps/mock-api/src/services/pricing.ts` (сайт берёт те же числа из `apps/web/src/features/billing/plans.ts`, их совпадение проверяет тест). Рубли нужны только для СБП (890 / 2 490 / 4 890 ₽), Telegram Stars считаются в `telegram/bot.ts` (500 / 1 350 / 2 650 ⭐️).

Бюджет и квота считаются по фактической стоимости запросов за скользящие 30 дней. Стадии бюджета: 80% — экономный режим, 100% — только дешёвые модели, 125% — запросы отклоняются.

### SSE-контракт

```http
POST /api/chat/completions
Content-Type: application/json

{
  "conversationId": "uuid",
  "modelId": "auto",
  "language": "ru",
  "messages": [{ "role": "user", "content": "..." }]
}
```

Ответ — `text/event-stream`:

```
event: delta
data: {"content":"порция текста"}

event: done
data: {"messageId":"uuid","selectedModel":{"id":"...","name":"..."},"routingReason":"...","usage":{"inputTokens":123,"outputTokens":456}}

event: error
data: {"code":"upgrade_required","message":"..."}
```

---

## Платёжная система

Реализованы три способа оплаты:

### Stripe (международные платежи)

- Создание Checkout Session → редирект на hosted checkout
- Вебхуки: `checkout.session.completed`, `customer.subscription.deleted`
- При успешной оплате: обновление подписки в in-memory store + PostgreSQL/Supabase (если подключено)
- Graceful fallback: если `STRIPE_SECRET_KEY` не задан — активируется локальный mock

### Telegram Bot (`@KetnerAIBot`)

- Оплата через **Telegram Stars** (XTR) — нативные счета `sendInvoice`, авто-подтверждение через `answerPreCheckoutQuery`
- Оплата через **СБП** — генерация deeplink в банковское приложение, QR-код, подтверждение через callback
- Команды: `/start`, `/plans`, `/status`, `/help`
- Поддержка deep-link параметров: `/start pay_pro__userId`
- Long Polling (локально) / Webhook (production на HTTPS)

### Mock-биллинг (fallback)

- Активируется автоматически при отсутствии ключей
- Полная эмуляция API с файловым хранилищем

---

## Аутентификация

Используется [Better Auth](https://www.better-auth.com/):

- **Локально**: SQLite через `node:sqlite` (`DatabaseSync`) — автоматические миграции, seed демо-пользователя `demo@ketner.ai` / `password123`
- **Production**: PostgreSQL через Drizzle ORM (Supabase или любой Postgres)
- Хеширование паролей: PBKDF2-SHA256
- Сессии через cookie `better-auth.session_token`
- Middleware с fallback на Bearer mock-JWT для обратной совместимости
- Эндпоинты: `/api/auth/sign-up/email`, `/api/auth/sign-in/email`, `/api/auth/get-session`, `/api/auth/sign-out`

---

## База данных

Drizzle ORM + PostgreSQL/Supabase. Таблицы:

| Таблица                                      | Назначение                                              |
| -------------------------------------------- | ------------------------------------------------------- |
| `user`, `session`, `account`, `verification` | Better Auth (управляется автоматически)                 |
| `ketner_users`                               | Пользователи Ketner AI с токенами и стоимостью          |
| `conversations`                              | Диалоги с архивированием и метаданными                  |
| `messages`                                   | Сообщения с трекингом токенов, стоимости и edit-истории |
| `subscriptions`                              | Подписки с полной интеграцией Stripe                    |
| `billing_events`                             | Лог платёжных событий с идемпотентностью                |
| `usage_metrics`                              | Метрики использования по модели, пользователю, диалогу  |

---

## Экраны

| Путь                 | Экран                                                                 |
| -------------------- | --------------------------------------------------------------------- |
| `/`                  | Лендинг                                                               |
| `/chat`              | Новый чат                                                             |
| `/chat/:id`          | Открытый диалог                                                       |
| `/login`             | Вход                                                                  |
| `/signup`            | Регистрация                                                           |
| `/pricing`           | Тарифы                                                                |
| `/checkout/:planId`  | Оформление подписки (Stripe / СБП / Stars)                            |
| `/settings`          | Настройки: профиль, тема, язык, подписка                              |
| `/docs`, `/docs/api` | Документация и API-справка                                            |
| `/code`, `/code/:id` | Ketner Code: проекты и ИИ-агент ([подробнее](docs/code-workspace.md)) |
| `/onboarding`        | Онбординг нового пользователя                                         |
| `/admin`             | Административная панель                                               |

---

## Тестирование

| Файл                    | Что покрывает                                                                |
| ----------------------- | ---------------------------------------------------------------------------- |
| `auth-flow.test.tsx`    | Вход, регистрация, OAuth, выход, независимые лимиты по аккаунтам             |
| `chat-flow.test.tsx`    | Отправка, стриминг, остановка, правка, перегенерация, платные модели, лимиты |
| `billing-flow.test.tsx` | Чекаут, подписка, отмена, маски карты                                        |
| `sidebar.test.tsx`      | История диалогов, поиск, переименование, удаление                            |
| `markdown.test.ts`      | Парсер markdown                                                              |
| `preferences.test.tsx`  | Тема, язык, сохранение                                                       |
| `tokens.test.ts`        | CSS-токены дизайн-системы                                                    |
| `routes.test.tsx`       | Маршруты                                                                     |
| `code-flow.test.tsx`    | Ketner Code: проекты, запуск агента, diff, сохранение перед запуском         |
| `code-import.test.ts`   | Импорт папки и ZIP: фильтры, лимиты, разбиение на части                      |
| `code-tree.test.ts`     | Дерево файлов и группировка ленты агента                                     |
| `marketing.test.tsx`    | Лендинг, страница тарифов                                                    |

Fake API в `test-utils.tsx` конфигурируется параметрами: `reply`, `replies`, `chunkDelayMs`, `failTimes`, `enforcePlans`.

---

## Дизайн-система

Направление **«Открытый контур»**:

- **6 семантических токенов** — `canvas`, `surface`, `text`, `muted`, `stroke`, `accent` — светлая и тёмная темы
- **Шрифт** — WOFF2 `Golos Text` локально, системный моноширинный стек для кода
- **Мотив `CornerMark`** — Г-образный штрих в 3 местах: старт нового чата, активный диалог, рамка композера
- **Иерархия скруглений** — 6 px → 10 px → 16 px
- **Анимации** — 180 мс (шторка сайдбара), 240 мс (пульс маркера); `prefers-reduced-motion` подавляет всё
- **Бандл** — ≈383 КБ (117 КБ gzip), markdown — отдельный чанк

---

## Локализация

Два языка — **русский** и **английский** — через типизированные словари:

- [`src/i18n/ru.ts`](apps/web/src/i18n/ru.ts) — эталон (определяет тип `TranslationKey`)
- [`src/i18n/en.ts`](apps/web/src/i18n/en.ts) — перевод (типизирован относительно `ru`)
- Пропущенный ключ → ошибка компиляции
- Даты через `Intl.DateTimeFormat` с локалью

---

## Соглашения

- Импорты внутри `apps/web` — через алиас `@/` (настроен в `vite.config.ts` и `tsconfig.json`)
- В `apps/mock-api` импорты с расширением `.js` (NodeNext / ESM)
- Комментарии и UI-тексты — на русском; идентификаторы и код — на английском
- Пользовательские строки не хардкодятся в компонентах — только через `useTranslation`

---

## Документация

- [`docs/code-workspace.md`](docs/code-workspace.md) — Ketner Code: проекты, агент, безопасность и что ещё нужно
- [`docs/tech-stack.md`](docs/tech-stack.md) — стек и причины выбора
- [`docs/screens.md`](docs/screens.md) — карта экранов и переходов
- [`docs/data-model.md`](docs/data-model.md) — модель данных и соответствие эндпоинтам
- [`docs/ux-checklist.md`](docs/ux-checklist.md) — чек-лист UX-паттернов
- [`docs/ai-integration-todo.md`](docs/ai-integration-todo.md) — архитектура AI Gateway
- [`docs/auth-integration-todo.md`](docs/auth-integration-todo.md) — Better Auth, продакшн-чек-лист
- [`docs/payment-integration-todo.md`](docs/payment-integration-todo.md) — Stripe, СБП, вебхуки
