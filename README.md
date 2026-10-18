# Ketner AI

**Одна подписка — все топовые модели.** GPT, Claude, Gemini, Grok, GLM, Qwen и другие в одном чате, режим Auto сам выбирает модель под задачу. Плюс агент для кода, генерация картинок, OpenAI-совместимый API и Telegram-бот с оплатой.

Сайт: [ketner.org](https://ketner.org) · хостинг Render (`ketner-ai.onrender.com`) · БД Supabase Postgres.

---

## Что умеет

| Раздел                | Что внутри                                                                                                                   | Документ                                               |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Чат                   | 15 моделей через OpenRouter, режим Auto, кнопка Max (Ultra), вложения, привязка репозитория GitHub, недельные лимиты моделей | [models-and-pricing.md](docs/models-and-pricing.md)    |
| Ketner Code (`/code`) | Проекты с файлами и агент, который читает и правит код по плану, импорт из ZIP и GitHub                                      | [code-workspace.md](docs/code-workspace.md)            |
| Изображения           | FLUX через Cloudflare Workers AI, платные модели через Runware, обязательная модерация                                       | [models-and-pricing.md §5](docs/models-and-pricing.md) |
| API для программ      | `/v1/chat/completions` в формате OpenAI, ключи `ketner_sk_…` (с тарифа Plus)                                                 | [agent-api.md](docs/agent-api.md)                      |
| Оплата                | Криптовалюта через Trybit, Telegram Stars (с автопродлением), возвраты                                                       | [payments.md](docs/payments.md)                        |
| Telegram              | Бот оплаты и кабинет `/tg`, вход на сайт через Telegram, бот поддержки                                                       | [telegram.md](docs/telegram.md)                        |
| Админка (`/admin`)    | Пользователи и тарифы, расход и маржа, метрики моделей, регистрации по времени и источнику                                   | [operations.md](docs/operations.md)                    |

Тарифы: Free $0 · Plus $9 · Pro $25 · Ultra $49 в месяц. Лимиты, бюджеты и экономика — в [models-and-pricing.md](docs/models-and-pricing.md).

> **Перед любым запуском рекламы прочитайте [roadmap.md](docs/roadmap.md)**: там список того, что ещё не готово, начиная с временной бесплатной выдачи Pro в Telegram.

---

## Быстрый старт

**Требования:** Node.js 22.12+ (рекомендуется 24, как в `Dockerfile`), npm 10+.

```bash
npm install
cp apps/mock-api/.env.example apps/mock-api/.env   # всё необязательно для локального запуска
npm run dev
```

- Фронтенд: http://localhost:5173 (запросы `/api/*` проксирует Vite)
- API: http://localhost:8787 (`GET /api` — список эндпоинтов, только вне production)

Без ключей сервер работает целиком: вместо моделей отвечает локальная заглушка, данные лежат в файлах `apps/mock-api/data/` (в git не попадают), Better Auth — в SQLite (`node:sqlite`). Есть демо-аккаунт `demo@ketner.ai` / `password123` (только вне production).

## Команды

| Команда             | Что делает                                                          |
| ------------------- | ------------------------------------------------------------------- |
| `npm run dev`       | API и фронтенд одновременно (`dev:api`, `dev:web` — по отдельности) |
| `npm run build`     | Сборка обоих воркспейсов (`apps/web/dist`, `apps/mock-api/dist`)    |
| `npm start`         | Сборка и запуск собранного сервера, как на Render                   |
| `npm test`          | Тесты: `node:test` для API (~480) и Vitest для сайта (~250)         |
| `npm run typecheck` | Проверка типов                                                      |
| `npm run lint`      | ESLint по всему репозиторию                                         |
| `npm run format`    | Prettier                                                            |

---

## Устройство

```
apps/
  web/        сайт: React 19 + Vite 8 + Tailwind 4 + React Router 7 + Zustand
  mock-api/   сервер: Express 5 + TypeScript (название историческое — это боевой бэкенд)
docs/         документация
render.yaml   описание сервиса Render · Dockerfile — альтернативный образ
```

Один процесс Node отдаёт и API (`/api/*`, `/v1/*`), и собранный сайт из `apps/web/dist`. Подробно: [architecture.md](docs/architecture.md).

**Важно про `apps/web/dist`:** папка закоммичена в git. Render собирает всё сам (`npm install && npm run build`), но по сложившейся практике пересобранный `dist` коммитится вместе с изменениями фронтенда — так сайт не зависит от того, прошла ли сборка на Render. После правок в `apps/web/src` запускайте `npm run build` и коммитьте `dist`.

## Документация

| Документ                                            | О чём                                                              |
| --------------------------------------------------- | ------------------------------------------------------------------ |
| [architecture.md](docs/architecture.md)             | Как устроены сайт и сервер, путь запроса, хранение данных, стек    |
| [environment.md](docs/environment.md)               | Все переменные окружения: что обязательно в production             |
| [operations.md](docs/operations.md)                 | Деплой на Render, домен, вебхуки, секреты, админка, что проверять  |
| [seo.md](docs/seo.md)                               | Поисковики: метатеги, отрисовка страниц в HTML, sitemap, кабинеты  |
| [api.md](docs/api.md)                               | API сайта (`/api/*`): эндпоинты, формат ошибок, SSE чата           |
| [agent-api.md](docs/agent-api.md)                   | OpenAI-совместимый API (`/v1/*`) для CLI и IDE                     |
| [data-model.md](docs/data-model.md)                 | Сущности и таблицы Postgres                                        |
| [auth-and-security.md](docs/auth-and-security.md)   | Вход и аккаунты, права, защита, известные риски                    |
| [payments.md](docs/payments.md)                     | Trybit, Telegram Stars, возвраты, вебхуки                          |
| [telegram.md](docs/telegram.md)                     | Боты, мини-приложение, вход через Telegram                         |
| [models-and-pricing.md](docs/models-and-pricing.md) | Модели, Auto, лимиты, бюджеты, цены и маржа, картинки              |
| [code-workspace.md](docs/code-workspace.md)         | Ketner Code: проекты и агент                                       |
| [screens.md](docs/screens.md)                       | Карта страниц сайта                                                |
| [ux-checklist.md](docs/ux-checklist.md)             | Дизайн-система и чек-лист интерфейса                               |
| [roadmap.md](docs/roadmap.md)                       | Что не готово и что нужно для полноценного продукта, по приоритету |

## Соглашения

- Импорты в `apps/web` — через алиас `@/`; в `apps/mock-api` — с расширением `.js` (NodeNext, ESM).
- Тексты интерфейса — только через словари `apps/web/src/i18n/ru.ts` (эталон) и `en.ts`; пропущенный ключ — ошибка компиляции.
- Комментарии и тексты — на русском, идентификаторы — на английском.
- Цены и лимиты задаются в одном месте на сервере (`services/pricing.ts`, `services/entitlement.ts`, `services/daily-limits.ts`); совпадение с сайтом проверяют тесты.
- Изменения идут прямо в `main`; Render выкатывает каждый пуш автоматически.
