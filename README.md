# Ketner AI

**Единый интерфейс для работы со всеми топовыми AI-моделями.** GPT, Claude, Gemini, Grok, DeepSeek и другие — в одном месте, без отдельных подписок на каждого провайдера.

> **Live Demo**: [https://ketner-ai.onrender.com](https://ketner-ai.onrender.com)

---

## Что это

Ketner AI — это production-ready SaaS-платформа с полноценным AI-шлюзом, системой тарифов и интегрированными платёжными провайдерами. Архитектурно продукт готов к реальной нагрузке: если передать ключи AI-провайдеров и подключить Stripe/ЮKassa — всё заработает без изменения фронтенда.

При отсутствии ключей система автоматически падает в fallback-режим: отвечает шаблонными ответами и сохраняет диалоги локально. Этот режим называется «Demo» в UI.

---

## Стек

| Слой | Технология | Версия |
|---|---|---|
| **Фронтенд** | React + TypeScript | 19.3 / 6.0.3 |
| **Сборка** | Vite | 8.3 |
| **Стили** | Tailwind CSS | 4.3 |
| **Маршрутизация** | React Router | 7.18 |
| **Состояние** | Zustand | 5.0 |
| **Бэкенд** | Node.js + Express | 24 / 5.2 |
| **Аутентификация** | Better Auth + SQLite | — |
| **БД (prod)** | PostgreSQL через Drizzle ORM | — |
| **Тесты** | Vitest + Testing Library | 5.0 / 16.3 |
| **Монорепо** | npm workspaces | npm 11 |

---

## Быстрый старт

**Требования:** Node.js 20+ (разрабатывалось на 24.21), npm 10+

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

| Команда | Что делает |
|---|---|
| `npm run dev` | Фронтенд + API одновременно |
| `npm run build` | Production-сборка обоих воркспейсов |
| `npm run typecheck` | Проверка типов без эмита |
| `npm run lint` | ESLint по всему монорепо |
| `npm test` | Тесты фронтенда + smoke-тесты API |
| `npm run format` | Prettier с автоисправлением |

---

## Переменные окружения

Все переменные опциональны. При отсутствии AI-ключей сервер отвечает шаблонными ответами. При отсутствии ключей Stripe/Telegram включается mock-биллинг.

### AI-провайдеры

| Переменная | Провайдер | Назначение |
|---|---|---|
| `OPENAI_API_KEY` | OpenAI | GPT-4o, GPT-4o mini |
| `ANTHROPIC_API_KEY` | Anthropic | Claude 3.5 Sonnet, Haiku |
| `GOOGLE_API_KEY` | Google | Gemini 2.5 Flash, Gemini 3.8 Flash |
| `OPENROUTER_API_KEY` | OpenRouter | Пул: DeepSeek, Grok, Qwen, Nemotron, GLM |

### Аутентификация

| Переменная | Назначение | По умолчанию |
|---|---|---|
| `BETTER_AUTH_SECRET` | Секрет для подписи сессий Better Auth | `dev-secret-change-me` |
| `BETTER_AUTH_URL` | Публичный URL сервиса | `http://localhost:8787` |
| `DATABASE_URL` | PostgreSQL (Supabase). Если не задан — SQLite | — |

### Платёжные провайдеры

| Переменная | Назначение |
|---|---|
| `STRIPE_SECRET_KEY` | Stripe API-ключ (если не задан — mock-биллинг) |
| `STRIPE_WEBHOOK_SECRET` | Секрет для верификации вебхуков Stripe |
| `STRIPE_PRICE_PLUS` | Stripe Price ID для тарифа Plus |
| `STRIPE_PRICE_PRO` | Stripe Price ID для тарифа Pro |
| `STRIPE_PRICE_ULTRA` | Stripe Price ID для тарифа Ultra |
| `TELEGRAM_BOT_TOKEN` | Токен Telegram-бота для оплаты Stars и СБП |
| `TELEGRAM_PAYMENT_PROVIDER_TOKEN` | Провайдер-токен для платежей в боте |

### Прочее

| Переменная | Назначение | По умолчанию |
|---|---|---|
| `PORT` | Порт API-сервера | `8787` |
| `CORS_ORIGIN` | Разрешённый origin | `http://localhost:5173` |
| `WEB_APP_URL` | URL фронтенда (для редиректов Stripe) | `http://localhost:5173` |
| `STORE_FILE` | Файл для хранения диалогов (fallback) | `apps/mock-api/data/store.json` |
| `MOCK_AI_FAILURE_RATE` | Доля запросов с ошибкой (для тестов) | `0` |
| `VIP_EMAILS` | Email-адреса с автоматическим Ultra-тарифом | — |

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
      db/              Drizzle ORM: схема PostgreSQL, миграции, Supabase-клиент
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
5. **Auto-router** — классификация задачи (кодинг / математика / рассуждение / творчество) и выбор оптимальной модели
6. **Double-pass pipeline** — для улучшенных ответов: черновик от дешёвой модели → полировка флагманом
7. **Провайдеры с Failover** — если основной провайдер недоступен, автоматически переключается на OpenRouter или следующий в цепочке
8. **Usage Accounting** — атомарная запись токенов, стоимости (\$ за запрос), задержки

#### Engine-роутинг для флагманских моделей

| Запрошенная модель | Лёгкие задачи | Средние | Сложные |
|---|---|---|---|
| GPT-6 Astra | DeepSeek Chat | GPT-6 Luna Pro | GPT-6 Sol Pro |
| Claude Fable 5.5 | DeepSeek Chat | Claude Haiku 4.5 | Claude Opus 5.5 |
| Gemini 3.8 Flash | DeepSeek Chat | Gemini 3.8 Flash | Gemini 3.8 Flash |
| Grok 4.7 | DeepSeek Chat | Grok 4.7 | Grok 4.7 |

### Тарифы и Fair Use

| Тариф | Цена | Контекст | Параллельных | Токенов/день | Флагманы |
|---|---|---|---|---|---|
| **Free** | 0 ₽ | 20 сообщ. | 1 | 150 000 | ✗ |
| **Plus** | 990 ₽/мес | 60 сообщ. | 2 | 1 500 000 | ✗ |
| **Pro** | 1 990 ₽/мес | 120 сообщ. | 4 | 6 000 000 | ✓ |
| **Ultra** | 2 499 ₽/мес | 500 сообщ. | 8 | 20 000 000 | ✓ |

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

| Таблица | Назначение |
|---|---|
| `user`, `session`, `account`, `verification` | Better Auth (управляется автоматически) |
| `ketner_users` | Пользователи Ketner AI с токенами и стоимостью |
| `conversations` | Диалоги с архивированием и метаданными |
| `messages` | Сообщения с трекингом токенов, стоимости и edit-истории |
| `subscriptions` | Подписки с полной интеграцией Stripe |
| `billing_events` | Лог платёжных событий с идемпотентностью |
| `usage_metrics` | Метрики использования по модели, пользователю, диалогу |

---

## Экраны

| Путь | Экран |
|---|---|
| `/` | Лендинг |
| `/chat` | Новый чат |
| `/chat/:id` | Открытый диалог |
| `/login` | Вход |
| `/signup` | Регистрация |
| `/pricing` | Тарифы |
| `/checkout/:planId` | Оформление подписки (Stripe / СБП / Stars) |
| `/settings` | Настройки: профиль, тема, язык, подписка |
| `/docs`, `/docs/api` | Документация и API-справка |
| `/onboarding` | Онбординг нового пользователя |
| `/admin` | Административная панель |

---

## Тестирование

| Файл | Что покрывает |
|---|---|
| `auth-flow.test.tsx` | Вход, регистрация, OAuth, выход, независимые лимиты по аккаунтам |
| `chat-flow.test.tsx` | Отправка, стриминг, остановка, правка, перегенерация, платные модели, лимиты |
| `billing-flow.test.tsx` | Чекаут, подписка, отмена, маски карты |
| `sidebar.test.tsx` | История диалогов, поиск, переименование, удаление |
| `markdown.test.ts` | Парсер markdown |
| `preferences.test.tsx` | Тема, язык, сохранение |
| `tokens.test.ts` | CSS-токены дизайн-системы |
| `routes.test.tsx` | Маршруты |
| `marketing.test.tsx` | Лендинг, страница тарифов |

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

- [`docs/tech-stack.md`](docs/tech-stack.md) — стек и причины выбора
- [`docs/screens.md`](docs/screens.md) — карта экранов и переходов
- [`docs/data-model.md`](docs/data-model.md) — модель данных и соответствие эндпоинтам
- [`docs/ux-checklist.md`](docs/ux-checklist.md) — чек-лист UX-паттернов
- [`docs/ai-integration-todo.md`](docs/ai-integration-todo.md) — архитектура AI Gateway
- [`docs/auth-integration-todo.md`](docs/auth-integration-todo.md) — Better Auth, продакшн-чек-лист
- [`docs/payment-integration-todo.md`](docs/payment-integration-todo.md) — Stripe, СБП, вебхуки
