# Аудит проекта перед трансформацией (фаза 0)

Состояние `main` на коммите `19b0aa4` (27.10.2026), проверено 30.10.2026 по коду, а не по прежним описаниям. Проверки на этом коммите: тесты сервера 543 (542 прошли, 1 пропущен, 0 упало), тесты сайта 260 из 260, `tsc` без ошибок, ESLint 0 ошибок и 11 предупреждений, `npm run build` проходит, пересобранный `apps/web/dist` совпадает с закоммиченным (кроме даты сборки).

Документ описывает то, что есть. Что и как менять — [MIGRATION_PLAN.md](MIGRATION_PLAN.md), целевое устройство — [PRODUCT_ARCHITECTURE.md](PRODUCT_ARCHITECTURE.md).

## 1. Общая архитектура

Один процесс Node (`apps/mock-api/dist/server.js`) на Render отдаёт API сайта (`/api/*`), OpenAI-совместимый API (`/v1/*`), SEO-файлы и собранный сайт из `apps/web/dist`. Перед ним Cloudflare (ketner.org). Внешние сервисы: Supabase Postgres (Франкфурт), OpenRouter (все модели), Cloudflare Workers AI и Runware (картинки), Trybit и Telegram Bot API (оплата), SMTP (коды входа).

| Слой                   | Технологии                                                                              | Размер                                     |
| ---------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------ |
| Сайт `apps/web`        | React 19, Vite 8, Tailwind 4, React Router 7, Zustand 5                                 | 47 812 строк, 269 файлов, 36 файлов тестов |
| Сервер `apps/mock-api` | Express 5, TypeScript (NodeNext, ESM), Better Auth, postgres.js, Drizzle (только схема) | 59 115 строк, 204 файла, 61 файл тестов    |

Название `mock-api` историческое: это боевой сервер.

**Главная особенность хранения.** При старте (`server.ts` → `db/sync.ts: initDatabaseSync`) сервер создаёт недостающие таблицы и колонки, загружает почти все данные в память и подключает «драйверы»: каждое изменение пишется в JSON-файл `apps/mock-api/data/*.json` и асинхронно, без ожидания и без повтора при ошибке, в Postgres. Исключения, которые читаются из базы по запросу: проекты Ketner Code и картинки. Следствие: запускать можно только один экземпляр сервера.

## 2. Сервер

### Сборка приложения (`app.ts`)

Порядок middleware: заголовки безопасности и CSP (хеши inline-скриптов считаются из `index.html`) → CORS (`/v1` — любой Origin без cookie; сайт — только свои адреса) → роутер `/v1` → колбэк GitHub → белый список эндпоинтов Better Auth → разбор JSON (1 МБ; 50 МБ только для чата, сравнения, файлов Code и прокси GitHub) → `/api` → SEO-страницы и SPA.

### Маршруты `/api` (`routes/index.ts`)

Все роутеры монтируются за общим `createAuthMiddleware`: он кладёт `req.user` из Bearer-токена (подпись, отзыв, отпечаток пароля) или из сессии Better Auth; заголовки `X-User-*` игнорируются. Закрытые маршруты требуют `requireAuth` (401). Ошибки — единый формат `{ error: { code, message } }` (`middleware/errors.ts`).

| Группа      | Маршруты                                                                                                                                                                                                                                              | Доступ                                                                                                                                  |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Служебные   | `GET /health`, `/status`, `/meta`, `/`                                                                                                                                                                                                                | все                                                                                                                                     |
| Вход        | `/auth/signup[/verify/resend]`, `/auth/login[/verify/resend]`, `/auth/password-reset[/verify/resend/complete]`, `/auth/me`, `/auth/logout`, `/auth/oauth/:provider`, `/auth/demo` (вне production), `/auth/telegram-link`, `/auth/telegram-unlink`    | все / вошедшие                                                                                                                          |
| Диалоги     | `GET/POST /conversations`, `GET/PATCH/DELETE /conversations/:id`                                                                                                                                                                                      | вошедшие или гость с `X-Guest-Id`                                                                                                       |
| Чат         | `POST /chat/completions` (SSE), `POST /chat/feedback`, `GET /chat/feedback/analytics` (админ)                                                                                                                                                         | вошедшие; гости — если `ALLOW_ANONYMOUS_CHAT` не `false` (по умолчанию разрешено и в production), с лимитом 15 в час и 40 в сутки на IP |
| Сравнение   | `POST /chat/compare`, `/compare/pick`, `/compare/judge`, `/compare/judge/save`, `GET /compare/stats` (админ)                                                                                                                                          | вошедшие                                                                                                                                |
| Проверка    | `POST /chat/review`, `GET /chat/review/quota`                                                                                                                                                                                                         | вошедшие                                                                                                                                |
| Ketner Code | `/code/capabilities`, `/code/projects[...]` (CRUD, файлы, импорт ZIP и GitHub, экспорт, `thread`, `run` SSE, `stop`, `review` SSE)                                                                                                                    | вошедшие                                                                                                                                |
| Картинки    | `/images/capabilities`, `POST /images/generate`, `GET /images/:id[/file]`, `DELETE /images/:id`                                                                                                                                                       | вошедшие                                                                                                                                |
| Кредиты     | `GET /usage/credits`                                                                                                                                                                                                                                  | вошедшие                                                                                                                                |
| Оплата      | `GET /packs`, `GET /plans` (снятые подписки), `/billing/crypto/*`, `/billing/telegram-stars/*`, `/billing/trybit/webhook`, `/billing/sbp/*`, `/billing/stripe/create-checkout` (410), `/billing/subscription`, `/billing/checkout`, `/billing/cancel` | разные                                                                                                                                  |
| Вебхуки     | `POST /webhooks` (HMAC `WEBHOOK_SECRET`, подписки прежней системы), `POST /webhooks/stripe`                                                                                                                                                           | подпись                                                                                                                                 |
| Telegram    | `/telegram/webhook`, `/telegram/support/*`, `/telegram/miniapp/*`, `/auth/telegram/*`; `simulate-*` вне production                                                                                                                                    | подпись / initData                                                                                                                      |
| Прочее      | `/keys` (API-ключи), `/github/*` (OAuth и прокси), `/contact`, `/admin/*` (права администратора)                                                                                                                                                      | разные                                                                                                                                  |

`/v1`: `GET /models`, `GET /models/:id`, `GET /usage`, `POST /chat/completions` — авторизация ключом `ketner_sk_…`, свой разбор тела до 8 МБ.

### Авторизация и безопасность

- Вход по коду из письма (регистрация, вход по паролю, сброс пароля), Google и GitHub через Better Auth. Вход через Telegram на сайте убран 18.10.2026; привязка Telegram к аккаунту осталась.
- Пароли — scrypt (старые PBKDF2-хеши перехешируются при входе). Bearer-токен (7 дней) хранится в `localStorage` браузера; при выходе отзывается.
- Лимиты частоты — `middleware/rate-limit.ts`, скользящее окно в памяти процесса (вход, регистрация, гости, Telegram); при перезапуске сбрасываются.
- Гостевой id приходит из заголовка `X-Guest-Id` и обязан иметь вид `guest_…`; сервер его не выдаёт и не подписывает.
- Личность и тариф для запросов к моделям берутся только из сессии (`services/chat-identity.ts`): поля тела запроса игнорируются.

## 3. База данных

Таблицы создаются кодом при старте (`CREATE TABLE IF NOT EXISTS`, `ALTER TABLE … ADD COLUMN IF NOT EXISTS`): в `db/sync.ts`, `code/postgres-driver.ts`, `images/image-store.ts`. Механизма версионных миграций нет. Файл `db/migrations/0000_init.sql` (drizzle-kit) создаёт 10 таблиц и устарел; `db/schema.ts` описывает 11 таблиц из 19.

| Таблица                                      | Что хранит                                                                                                                                                                                                    | Как читается                              |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `user`, `session`, `account`, `verification` | Better Auth                                                                                                                                                                                                   | Better Auth                               |
| `ketner_users`                               | аккаунты: тариф, хеш пароля, VIP, админ, Telegram, способ и источник регистрации                                                                                                                              | в память при старте                       |
| `conversations`, `messages`                  | диалоги и сообщения (статус, `finish_reason`, `can_continue`, оценка, сводка контекста)                                                                                                                       | в память                                  |
| `subscriptions`                              | подписки прежней системы                                                                                                                                                                                      | в память                                  |
| `feedbacks`                                  | лайки и дизлайки                                                                                                                                                                                              | в память                                  |
| `api_keys`                                   | ключи `/v1` (SHA-256 и префикс)                                                                                                                                                                               | в память                                  |
| `revoked_tokens`                             | отозванные Bearer-токены                                                                                                                                                                                      | в память                                  |
| `github_connections`                         | токены GitHub, AES-256-GCM                                                                                                                                                                                    | в память                                  |
| `crypto_invoices`                            | счета Trybit                                                                                                                                                                                                  | в память                                  |
| `ketner_docs`                                | JSON-документы по пространствам: `payments`, `stars_subscriptions`, `notification_prefs`, `credit_grants`, `premium_credits`, `usage`, `contact_messages`, `compare_votes`, `support_tickets`, `support_meta` | в память (`store/doc-store.ts`)           |
| `code_projects`, `code_project_files`        | проекты Ketner Code                                                                                                                                                                                           | по запросу, запросы привязаны к `user_id` |
| `generated_images`                           | картинки (`bytea`, ≤ 300 на пользователя)                                                                                                                                                                     | по запросу                                |
| `usage_metrics`                              | создаётся, не используется                                                                                                                                                                                    | —                                         |

Что живёт только в памяти или в файле и не переживает деплой: прогоны сравнения (`CompareRunStore`, 3 часа), счета Stars и СБП, семантический кэш, счётчики лимитов, обработанные id generic-вебхука (`processedEvents`).

## 4. AI Gateway

Путь запроса чата: `routes/chat.ts` → `AIGateway.stream(request, callbacks, isCancelled)` → выбор модели → `RoutedProvider` (прямой API вендора, если задан ключ, иначе и при сбое OpenRouter) → поток в SSE (`routes/sse.ts`: события `event: … data: …`, сердцебиение каждые 15 с, закрытие соединения отменяет работу).

Внутри `AIGateway.stream` по порядку:

1. **PayloadGuard** — размер сообщений, вложений и контекста проекта.
2. **Тариф и права** — `EntitlementService` (`services/entitlement.ts`); уровень `credits` вычисляется на лету по купленным кредитам (`services/user-plan.ts: applyPurchasedAccess`).
3. **Баланс и стадия** — `CreditService.balance` (выдаёт пробный грант один раз), стадия `normal` или `exhausted`.
4. **Выбор модели** — Auto (`ai/auto-router.ts`, эвристика сложности `classifyPromptComplexity`), замена на бесплатную модель на уровне Free (`ai/plan-substitute.ts`), выбор доступной по кредитам (`services/credit-policy.ts: pickAffordable`).
5. **Fair Use** — запросы в минуту, час, сутки, токены, параллельные запросы (`usageStore.acquireConcurrencySlot`).
6. **Контекст** — `ContextOptimizer`: первое сообщение, сводка, последние 8–13 сообщений; точки кэша промпта по вендору (`ai/prompt-cache.ts`).
7. **Семантический кэш** — только без вложений, проекта и служебных задач.
8. **Вызов с запасными моделями** — цепочка `fallbackModelId`; предохранитель `ai/circuit-breaker.ts` (3 ошибки → 30 с паузы для движка); сторож потока (`ai/stream-watchdog.ts`) обрывает зависший ответ.
9. **Цена и списание** — `computeRequestCost`: приоритет у `usage.cost` из ответа провайдера, запасной вариант — таблица цен реестра. `CreditService.charge` вызывается один раз после ответа, только если ответил платный провайдер; списывает не больше остатка, сперва гранты, сгорающие раньше.
10. **Учёт** — `usageStore.recordUsage` с `kind` (`chat`, `agent`, `image`, `review`) и `runId`.

**Служебные задачи.** `GatewayRequest.task = { kind: 'review', id, systemPrompt, templateOutput? }` заменяет системный промпт, отключает семантический кэш и запись в суточный лимит сообщений; учёт пишется с `kind: 'review'`. На этом механизме работают проверка ответа, судья сравнения и ревью кода (`services/answer-review.ts: runReviewTask` перебирает кандидатов-рецензентов). Структурированный ответ получается промптом «ответь JSON» и терпимым разбором (`extractJsonObject`, `stripThinking`) — режима `response_format`/JSON Schema у шлюза нет.

**`strictModel`** запрещает подмену модели (сравнение): нехватка кредитов даёт `insufficient_credits`, недоступность — `model_unavailable`.

**Агент Ketner Code** — отдельный `AgentGateway` (`ai/agent-gateway.ts`) с вызовами инструментов; использует тот же реестр, кредиты и учёт.

Каталог: 22 модели + Auto (`ai/model-registry.ts`, `/api/meta`), бесплатные `nemotron-ultra` (чат) и `north-mini-code` (агент). Все модели открыты всем, `requiredPlan` у всех `null`.

## 5. Кредиты и права

- 1 кредит = $0.001 себестоимости. Гранты — `store/credit-store.ts` в `ketner_docs` (`credit_grants`): виды `plan`, `bonus`, `free`, `auto`, `pack`, `admin`; начисление идемпотентно по id гранта, списание (`debit`) — нет: защита от двойного списания держится на том, что шлюз вызывает его ровно один раз на ответ.
- Новому аккаунту один раз 200 пробных кредитов на 30 дней; пакет — 365 дней.
- Уровни: `free` (пробные или ноль; 10 сообщений в сутки, 1 параллельный) и `credits` (есть купленные; 4 000 в сутки, 8 параллельных, API-ключи). Прежние `plus`, `pro`, `ultra`, `gpt-pro`, `claude-pro`, `gemini-pro` доживают оплаченный срок.
- Отдельные суточные лимиты: проверки ответов (`services/review-policy.ts`: 2 / 10 / 30 / 80 по рангу), запуски агента (`services/code-limits.ts`), картинки по моделям (`images/models.ts`).
- Цифры для сайта — `apps/web/src/features/billing/plan-facts.json`, совпадение с сервером проверяет `services/plan-facts.test.ts`.

## 6. Платежи

| Канал           | Поток                                                                                                                                       | Начисление                                                            |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Trybit (крипта) | `POST /billing/crypto/create-invoice` → оплата → postback `POST /billing/trybit/webhook` (JWT HS256) + перепроверка `invoice/merchant/info` | `billing/billing-service.ts: grantPack` + бонус 15% отдельным грантом |
| Telegram Stars  | счёт из бота или `/tg` → `successful_payment` в `POST /telegram/webhook`                                                                    | `grantPack`                                                           |
| Stripe          | код есть, `create-checkout` отвечает 410                                                                                                    | —                                                                     |
| СБП             | только счета до 26.10.2026                                                                                                                  | —                                                                     |

Журнал платежей — `ketner_docs` (`payments`), идемпотентность по id платежа. Возврат — заявкой в течение 24 часов, пока кредиты пакета не тронуты, с одобрением администратора. Trybit в тестовом режиме.

## 7. Сайт

- Роутинг — `apps/web/src/router`: `StandaloneLayout` (главная, вход, тарифы, документы, оплата, правовые страницы), `AppShell` с боковой панелью (`/chat[/:id]`, `/code[/:id]`, `/images`, `/settings`, `/api-docs`, `/onboarding`, `/admin`), `/tg` без оболочки. Рабочие страницы грузятся лениво.
- Главная — `pages/landing-page.tsx` и `pages/landing/*`: hero, провайдеры, вкладки разделов, таблица моделей, калькулятор подписок, тарифы, FAQ, CTA.
- Состояние — Zustand (`features/*/…-store.ts`), API — `features/*/api.ts`, общий `ApiError` в `features/chat/api.ts`, SSE-клиент `features/chat/sse.ts`.
- Тексты — только `i18n/ru.ts` и `i18n/en.ts` (пропущенный ключ — ошибка компиляции).
- Дизайн «Графит и нефрит»: тёмная тема `--canvas #1d1f21`, текст `#eceef0`, нефрит для действий; шрифт Geologica; `corner-shape` со срезанными углами.
- SEO: 17 открытых страниц отрисовываются при сборке (`entry-prerender.tsx`, `scripts/prerender.mjs`), список — `apps/mock-api/src/seo/seo-pages.json`.
- Настройки (`pages/settings-page.tsx`): профиль, тема, язык, GitHub, Telegram, API-ключи; локальные предпочтения — `features/preferences/preferences-store.ts` (тема, язык, боковая панель, модель, Max).

## 8. Тесты и деплой

- Сервер: `node:test` через `tsx --test "src/**/*.test.ts"`; приложение собирается `createApp(overrides)` с временными хранилищами, моделей нет — отвечает шаблонный движок. Регрессии безопасности — `security-regressions.test.ts`.
- Сайт: Vitest + Testing Library + jsdom; фейковый сервер `src/tests/fake-api.ts`. Главную проверяют `marketing.test.tsx`, `routes.test.tsx`, `prerender.test.tsx`.
- E2E-тестов и CI нет: проверки запускаются вручную.
- Деплой: каждый пуш в `main` выкатывает Render (`render.yaml`: `plan: free`, `buildCommand: npm install && npm run build`, `startCommand: npm start` — пересборка при каждом старте). `apps/web/dist` закоммичен. Есть `Dockerfile` (Node 24).

## 9. Технические риски

| #   | Риск                                                                                                                                                                                    | Последствие для трансформации                                                                |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| R1  | **`conversationStore.get` переназначает чужой диалог** тому, кто его запросил (`GET /api/conversations/:id`, чат, сравнение). Безопасный `getOwned` есть, но маршруты его не используют | Тот же приём нельзя повторить в новых сущностях; исправить до начала работ                   |
| R2  | Нет версионных миграций: схема меняется кодом при старте, `0000_init.sql` устарел                                                                                                       | Новые таблицы требуют механизма миграций (раздел 3 плана)                                    |
| R3  | Запись в Postgres из памяти — асинхронная, без ожидания и повтора                                                                                                                       | Для анализов и решений нужна запись с подтверждением, а не зеркало                           |
| R4  | Один процесс, лимиты частоты и прогоны в памяти                                                                                                                                         | Долгие анализы и тесты решений теряются при перезапуске; нужен статус в базе и возобновление |
| R5  | У шлюза нет структурированного вывода и нет `task.kind`, кроме `review`                                                                                                                 | Расширить тип задач и добавить валидацию ответа, не создавая второй шлюз                     |
| R6  | `debit` не идемпотентен                                                                                                                                                                 | Повтор запроса клиента не должен повторять вызов модели: идемпотентность на уровне операции  |
| R7  | Free: 10 сообщений в сутки и бесплатная модель с общим лимитом OpenRouter (20/мин, 1 000/сутки)                                                                                         | Анализ на Free нужно считать отдельно и защитить от исчерпания общего пула                   |
| R8  | Нет CI, мониторинга, резервных копий; изменения сразу у пользователей                                                                                                                   | Каждая фаза рискует сломать работающий продукт                                               |
| R9  | Bearer-токен в `localStorage`                                                                                                                                                           | Новые страницы с пользовательскими данными расширяют поверхность XSS                         |
| R10 | Главная участвует в SEO-пререндере и тестах                                                                                                                                             | Замена главной требует обновить `seo-pages.json`, пререндер и три набора тестов              |
| R11 | `npm audit`: исправимые уязвимости, в том числе высокая в `body-parser`                                                                                                                 | Обновить зависимости до начала работ                                                         |
| R12 | Валидационной библиотеки в зависимостях нет (`zod` 4.6.5 приходит только транзитивно)                                                                                                   | Решение: добавить `zod` явной зависимостью или писать валидаторы вручную                     |

## 10. Расхождения с прежними описаниями

- `README.md` и запись проекта `GitHub-Setup.md` называют срочным `TG_FREE_PRO`; временный бесплатный Pro убран 18.10.2026 (`52f6f54`).
- `README.md`: «15 моделей» — в каталоге 22 и Auto.
- `docs/data-model.md` не упоминает `compare_votes` в `ketner_docs`.
- В `README.md` цены и лимиты указаны в `services/daily-limits.ts` — файл удалён 25.10.2026.
- Ответ `/api/health` называет сервис `ketner-mock-api`.
