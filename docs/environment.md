# Переменные окружения

Сервер читает переменные из окружения и из файла `.env` (корень репозитория или `apps/mock-api/.env`). Шаблон — `apps/mock-api/.env.example`. На Render переменные задаются в Environment сервиса; `render.yaml` описывает их список для Blueprint.

Обозначения: **обяз.** — без неё сервер в production не запустится; **нужна** — запустится, но часть продукта не работает.

## Сервер и адреса

| Переменная                                        | Назначение                                                                                                            | По умолчанию                    |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| `NODE_ENV`                                        | `production` включает строгие проверки секретов и выключает все заглушки                                              | `development`                   |
| `PORT`                                            | Порт сервера                                                                                                          | `8787`                          |
| `BETTER_AUTH_URL`                                 | Публичный адрес сервиса: OAuth-колбэки, ссылки. Иначе берётся `RENDER_EXTERNAL_URL` или `BASE_URL`                    | `http://localhost:8787`         |
| `WEB_APP_URL`                                     | Адрес сайта для ссылок из бота и редиректов оплаты                                                                    | `http://localhost:5173`         |
| `SITE_URL`                                        | Адрес для canonical и `sitemap.xml`                                                                                   | `WEB_APP_URL`, иначе ketner.org |
| `CORS_ORIGIN`                                     | Основной разрешённый origin                                                                                           | `http://localhost:5173`         |
| `CORS_EXTRA_ORIGINS`                              | Дополнительные origin через запятую (если сайт открывается не только на ketner.org и Render)                          | —                               |
| `TRUST_PROXY`                                     | Сколько прокси перед сервером (для реального IP клиента); `CF-Connecting-IP` учитывается только от адресов Cloudflare | `1` в production                |
| `GOOGLE_SITE_VERIFICATION`, `YANDEX_VERIFICATION` | Мета-теги подтверждения сайта в поисковиках                                                                           | —                               |

## Секреты

| Переменная                  | Назначение                                                                                              |           |
| --------------------------- | ------------------------------------------------------------------------------------------------------- | --------- |
| `BETTER_AUTH_SECRET`        | Корневой секрет: сессии Better Auth, шифрование токенов GitHub, секреты вебхуков Telegram. ≥ 32 символа | **обяз.** |
| `AUTH_JWT_SECRET`           | Подпись Bearer-токенов; если пусто — выводится из `BETTER_AUTH_SECRET`                                  |           |
| `WEBHOOK_SECRET`            | Подпись общего вебхука `/api/webhooks`, ≥ 32 символа                                                    | **обяз.** |
| `ADMIN_API_KEY`             | Ключ админ-API (`x-admin-key`), ≥ 32 символа                                                            | **обяз.** |
| `ALLOW_COMPROMISED_SECRETS` | `true` разрешает секреты, которые когда-то лежали в репозитории. Только как временная мера              |           |

Смена `BETTER_AUTH_SECRET` разлогинит всех, сломает расшифровку сохранённых токенов GitHub (пользователям придётся подключить GitHub заново) и поменяет секреты вебхуков Telegram (бот переустановит их при старте). Сгенерировать: `openssl rand -base64 32`.

## База данных и Better Auth

| Переменная                                                                                                                                                                                       | Назначение                                                                                                                                                                                                                                              |           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `DATABASE_URL`                                                                                                                                                                                   | Postgres (Supabase). Без неё данные хранятся только в файлах и на Render теряются при деплое                                                                                                                                                            | **нужна** |
| `BETTER_AUTH_API_KEY`                                                                                                                                                                            | Ключ панели Better Auth Infra (необязательно)                                                                                                                                                                                                           |           |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`                                                                                                                                                       | Вход через Google. Колбэк: `<BETTER_AUTH_URL>/api/auth/callback/google`                                                                                                                                                                                 |           |
| `DODO_PAYMENTS_API_KEY`, `DODO_PAYMENTS_WEBHOOK_KEY`, `DODO_PAYMENTS_ENVIRONMENT` (`test_mode` по умолчанию / `live_mode`), `DODO_SUBSCRIPTION_PRODUCT_ID`, `AUTOMATION_SUBSCRIPTION_REQUIRED=1` | Подписка «Автоматизации» через Dodo Payments (docs/AUTOMATION_PLAN.md, этап E). Вебхук: `<сайт>/api/webhooks/dodo`. Без ключа и продукта оплата картой недоступна; `AUTOMATION_SUBSCRIPTION_REQUIRED` — «Приступить к автоматизации» только с подпиской |           |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`                                                                                                                                                       | Вход через GitHub и привязка репозиториев. Колбэк: `<BETTER_AUTH_URL>/api/auth/callback/github`                                                                                                                                                         |           |
| `GITHUB_REPO_CLIENT_ID`, `GITHUB_REPO_CLIENT_SECRET`, `GITHUB_REPO_REDIRECT_URI`                                                                                                                 | Отдельное OAuth-приложение для доступа к репозиториям (если не хотите использовать приложение входа)                                                                                                                                                    |           |

## Доступ и аккаунты

| Переменная                                | Назначение                                                                                                                                                                                       | По умолчанию              |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------- |
| `ADMIN_EMAILS`                            | Почты администраторов через запятую                                                                                                                                                              | —                         |
| `VIP_EMAILS`                              | Почты с тарифом Ultra без оплаты                                                                                                                                                                 | —                         |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` | Создать первого администратора при старте (пароль ≥ 12 символов). После входа очистите переменные                                                                                                | —                         |
| `ENABLE_DEMO_ACCOUNT`                     | `true` включает `demo@ketner.ai` в production (вне production включён всегда)                                                                                                                    | выключен                  |
| `ALLOW_ANONYMOUS_CHAT`                    | `false` закрывает чат для гостей                                                                                                                                                                 | включён                   |
| `DISCOVERY_ENABLED`                       | Платформа решений (главная «Что вы хотите улучшить?», анализ, отчёт, планы, Builder, [ACCEPTANCE.md](ACCEPTANCE.md)); `false` выключает — возвращается лендинг агрегатора, маршруты отвечают 404 | включена                  |
| `DISCOVERY_FREE_DAILY_USD`                | Суточный бюджет бесплатных анализов, $ (отдельно от остальных расходов)                                                                                                                          | 5                         |
| `DISCOVERY_BUDGET_TZ`                     | Часовой пояс суток бюджета и квот анализов (IANA)                                                                                                                                                | `UTC` (сброс в 03:00 МСК) |
| `TEST_DATABASE_URL`                       | Только для тестов: Postgres, на котором проверяются SQL анализа и бюджета (в CI задан)                                                                                                           | —                         |

## Модели

| Переменная                                              | Назначение                                                                                                        |                                |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `OPENROUTER_API_KEY`                                    | Единый ключ всех моделей. При нулевом балансе перестают работать все платные модели                               | **нужна**                      |
| `OPENROUTER_BASE_URL`                                   | Адрес API OpenRouter                                                                                              | `https://openrouter.ai/api/v1` |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY` | Прямые API вендоров; без ключа путь выключен ([models-and-pricing.md](models-and-pricing.md#прямые-api-вендоров)) |                                |
| `OPENAI_BASE_URL`, `GOOGLE_AI_BASE_URL`                 | Свои адреса прямых API (прокси)                                                                                   |                                |
| `SEMANTIC_CACHE_PATH`                                   | Файл семантического кэша                                                                                          | `data/semantic-cache.json`     |
| `USD_TO_RUB_RATE`                                       | Курс для справочных рублёвых сумм в админке                                                                       | `95`                           |

## Картинки

| Переменная                                      | Назначение                                                                                     |               |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------- |
| `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` | Workers AI (FLUX). Без них страница «Изображения» недоступна (токен с правом Workers AI: Read) | **нужна**     |
| `RUNWARE_API_KEY`                               | Платные модели картинок; нужен баланс от $5                                                    |               |
| `IMAGES_DIR`                                    | Папка картинок без БД                                                                          | `data/images` |

## Оплата

| Переменная                                                                                                  | Назначение                                                                                  |                          |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------ |
| `TRYBIT_API_KEY`, `TRYBIT_SHOP_ID`, `TRYBIT_SECRET_KEY`                                                     | Приём криптовалюты ([payments.md](payments.md)). Старые имена `CRYPTOCLOUD_*` тоже читаются | **нужна**                |
| `TRYBIT_API_URL`                                                                                            | Адрес API Trybit                                                                            | `https://api.trybit.com` |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PLUS`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_ULTRA` | Stripe: код есть, на странице оплаты не показывается                                        |                          |
| `BILLING_LEDGER_DIR`                                                                                        | Папка файлов журнала платежей без БД                                                        | рядом с `users.json`     |

## Telegram

| Переменная                                                    | Назначение                                                                                                                                                                                 | По умолчанию         |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------- |
| `TELEGRAM_BOT_TOKEN`                                          | Бот оплаты и кабинета. Пусто — бот выключен                                                                                                                                                | —                    |
| `TELEGRAM_BOT_USERNAME`                                       | Имя бота                                                                                                                                                                                   | `Robo_kassa_bot`     |
| `TELEGRAM_WEBHOOK_URL`                                        | Базовый https-адрес для вебхуков (к нему добавляется `/api/telegram/webhook`). Без него берётся `RENDER_EXTERNAL_URL` или `BETTER_AUTH_URL`; если адрес не https — long polling (локально) | —                    |
| `TELEGRAM_PAYMENT_PROVIDER_TOKEN`                             | Провайдер платежей бота (для Stars не нужен)                                                                                                                                               | —                    |
| `TELEGRAM_SUPPORT_BOT_TOKEN`, `TELEGRAM_SUPPORT_BOT_USERNAME` | Бот поддержки                                                                                                                                                                              | `ketner_support_bot` |
| `SUPPORT_ADMIN_CHAT_ID`                                       | Chat id оператора поддержки. Задавайте обязательно: иначе права даёт username                                                                                                              | —                    |
| `SUPPORT_ADMIN_USERNAME`                                      | Username оператора (запасной вариант)                                                                                                                                                      | `gumieeel`           |
| `STARS_USD_RATE`                                              | Курс цены в звёздах, $ за звезду                                                                                                                                                           | официальный $0.01999 |
| `STARS_RATE_FEED_URL`                                         | Источник рыночного курса звёзд (для сравнения)                                                                                                                                             | Fragment             |

## Почта

`SMTP_HOST`, `SMTP_PORT` (587), `SMTP_SECURE` (`true` для 465), `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` — любой SMTP. Сейчас почта нужна только для кода привязки Telegram по email; без SMTP в production эта привязка отключена.

## Ketner Code

| Переменная                          | Назначение                                      | По умолчанию       |
| ----------------------------------- | ----------------------------------------------- | ------------------ |
| `CODE_PROJECTS_DIR`                 | Рабочие копии проектов                          | `data/projects`    |
| `SANDBOX_MODE`                      | Запуск команд агентом: `off`, `docker`, `local` | `off`              |
| `SANDBOX_DOCKER_IMAGE`              | Образ для `docker`                              | `node:22-bookworm` |
| `SANDBOX_ALLOW_NETWORK`             | Сеть внутри команд                              | `false`            |
| `SANDBOX_ALLOW_LOCAL_IN_PRODUCTION` | Разрешить `local` в production (небезопасно)    | `false`            |

## Файлы хранилищ и отладка

`STORE_FILE`, `USER_STORE_FILE`, `SUBSCRIPTION_STORE_FILE`, `USAGE_STORE_FILE`, `INVOICE_STORE_FILE`, `SUPPORT_STORE_FILE`, `API_KEY_STORE_FILE`, `REVOKED_TOKEN_STORE_FILE`, `GITHUB_CONNECTION_STORE_FILE`, `FEEDBACK_STORE_FILE`, `CONTACT_STORE_FILE`, `AUTH_DB_FILE` (SQLite Better Auth без БД) — пути файлов, по умолчанию `apps/mock-api/data/*`.

`MOCK_AI_THINKING_MIN_MS`, `MOCK_AI_THINKING_MAX_MS`, `MOCK_AI_CHUNK_MIN_MS`, `MOCK_AI_CHUNK_MAX_MS`, `MOCK_AI_FAILURE_RATE` — поведение заглушки модели без ключа (в production сбои заглушки выключены).

## Сайт

`VITE_API_URL` (`apps/web/.env`) — адрес API при отдельном деплое фронтенда. В текущей схеме (один сервис) оставьте пустым: запросы идут на тот же домен.
