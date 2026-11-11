# Сервер не стартует на Node ≥ 22.13 с `DATABASE_URL`: причина и исправление

Составлено 11.11.2026. Статус: исправление принято владельцем. В `main` не переносилось. Блокировало T4.0: Mastra требует Node ≥ 22.13.

**Отдельная ветка для `main`: `claude/fix-node-startup`** (от текущего `main`, коммит `01d07ec`; PR не открыт — по указанию владельца). В ней только:

- `apps/mock-api/src/auth/better-auth.ts` — исправление;
- `apps/mock-api/src/auth/better-auth-init.test.ts` — тест;
- `.node-version` — `24.22.1`. Та же major-версия, что в CI (`node-version: 24`) и в `Dockerfile` (`node:24-alpine`); на ней проверено.

Проверка ветки:

| Проверка | Node 22.23.4 | Node 24.22.1 |
| --- | --- | --- |
| Старт с `DATABASE_URL` (пустая база и повторный старт) + смоук | 7/7 | 7/7 |
| Тесты с `TEST_DATABASE_URL` | 768: 767 прошло, 0 упало, 1 пропущен | то же |
| Тесты без Postgres | 768: 752 прошло, 0 упало, 16 пропущено | то же |

Учитывает ли Render файл `.node-version`, проверить по журналу сборки после выката: строка о версии Node в начале сборки. Документация Render из этой сессии недоступна. Если не учитывает — задать `NODE_VERSION=24.22.1` в настройках сервиса.

## 1. Симптом

Сервер с `DATABASE_URL` на Node 22.23.4 и Node 24.22.1:

1. синхронизирует базу;
2. пишет `[Better Auth]: Only kysely adapter is supported for migrations…`;
3. завершается с кодом 1, не открыв порт.

Воспроизведено на одноразовом Postgres: [security-review/server-start-check.sh](security-review/server-start-check.sh).

| Node | `node:sqlite` | До исправления (2 старта) | После исправления (2 старта + смоук 7/7) |
| --- | --- | --- | --- |
| 22.23.4 | доступен | оба старта: код 1, порт не открыт | старт за 3–4 с, смоук 7/7 |
| 24.22.1 | доступен | оба старта: код 1, порт не открыт | старт за 4 с, смоук 7/7 |

## 2. Точная причина

1. **Модуль `node:sqlite`** доступен без флага начиная с Node 22.13 (и 23.4+). При загрузке `auth/better-auth.ts` импорт `node:sqlite` удаётся, и `DatabaseSyncClass` указывает на `DatabaseSync`. На Node 22.12 и ниже импорт падает, `DatabaseSyncClass = null`.
2. **`createBetterAuth()` при `DATABASE_URL`** (`usePostgres`) передаёт Better Auth `database: drizzleAdapter(pgDb, …)`. Это фабрика адаптера (функция), а не подключение к базе.
3. **`initAuthDatabase()`** (вызывается в `server.ts` до `app.listen`) проверяла только `if (DatabaseSyncClass)` и вызывала `getMigrations(authInstance.options)`, не глядя, какая база у экземпляра.
4. **`getMigrations`** (`better-auth/dist/db/get-migration.mjs`, Better Auth 1.7.14):
   - вызывает `createKyselyAdapter(config)` из `@better-auth/kysely-adapter`;
   - та ищет у `config.database` признаки подключения или диалекта Kysely: `db`, `dialect`, `createDriver`, `connect`, `aggregate`, `createSession` и др.;
   - у фабрики drizzle их нет, поэтому `kysely: null`;
   - тогда `getMigrations` пишет `Only kysely adapter is supported for migrations…` и вызывает **`process.exit(1)`**.
5. **`try/catch` в `initAuthDatabase` не помогает:** `process.exit` не бросает исключение, а сразу завершает процесс.

Итог:
- на Node ≤ 22.12 миграции Better Auth для Postgres тихо пропускались — шаг 1 не выполнялся;
- на Node ≥ 22.13 сервер с Postgres всегда завершается при старте.

Таблицы Better Auth в Postgres создаёт `db/sync.ts` (`CREATE TABLE IF NOT EXISTS "user"`, `"session"`, `"account"`, `"verification"`), поэтому миграции Better Auth для Postgres не нужны.

## 3. Исправление (минимальное)

`apps/mock-api/src/auth/better-auth.ts`, +11 −1:

- `createBetterAuth` запоминает экземпляры на Postgres (`WeakSet postgresAuthInstances`);
- `initAuthDatabase` запускает миграции Better Auth только для экземпляров на локальной SQLite: `if (DatabaseSyncClass && !postgresAuthInstances.has(authInstance))`.

Для Postgres поведение становится таким же, как сейчас на Node ≤ 22.12. Без `DATABASE_URL` (локальная SQLite) ничего не меняется. Сигнатуры функций и вызовы не меняются.

Что не меняется и остаётся как было:
- при доступном `node:sqlite` `createBetterAuth` по-прежнему открывает локальный файл SQLite (`data/auth.sqlite`), даже если работает через Postgres;
- цикл VIP в `initAuthDatabase` пишет в этот файл.

Обе вещи безвредны и к падению не относятся.

## 4. Проверка

| Проверка | Node 22.23.4 | Node 24.22.1 |
| --- | --- | --- |
| Тест `auth/better-auth-init.test.ts` (подменяет `process.exit` и проверяет, что вызова не было) до исправления | **падает**: `process.exit(1)` | **падает** |
| Тот же тест после исправления | проходит | проходит |
| Старт сервера с `DATABASE_URL` (пустая база и повторный старт) + смоук через API | 7/7 | 7/7 |
| Весь набор тестов сервера с `TEST_DATABASE_URL` (одноразовый Postgres 16.15) | 811: 810 прошло, 0 упало, 1 пропущен | 811: 810 прошло, 0 упало, 1 пропущен |
| Весь набор без Postgres | 811: 795 прошло, 0 упало, 16 пропущено (тесты Postgres) | то же |
| `tsc --noEmit`, `eslint` изменённых файлов | без ошибок | — |

Тест пропускается (`skip`), если `node:sqlite` недоступен: на Node ≤ 22.12 условие ошибки не возникает.

## 5. Какую версию Node использует production (Render)

По репозиторию версия не закреплена:
- нет `.node-version` и `.nvmrc`;
- в `package.json` — диапазон `"engines": { "node": ">=22.12.0" }`;
- в `render.yaml` — `runtime: node`, без `NODE_VERSION`.

Какую конкретную версию Render выбирает для диапазона, по документации Render проверить не удалось: render.com закрыт сетью этой сессии. **Не проверено.**

Как узнать факт:

1. **Журнал сборки.** Render → сервис `ketner-ai` → Events → последний успешный deploy → журнал сборки. В начале сборки Render пишет, какую версию Node он использует и откуда её взял.
2. **Shell сервиса** (Render → сервис → Shell, если доступен на тарифе): `node -v`.
3. **Признак в журнале сервера.** Если в журналах запуска есть `ExperimentalWarning: SQLite is an experimental feature`, то `node:sqlite` доступен, то есть Node ≥ 22.13. Тогда текущий `main` с `DATABASE_URL` упал бы — значит, production либо на Node ≤ 22.12, либо работает не с этой версией кода.

Рекомендация (не сделано, решает владелец): закрепить версию явно — `.node-version` или переменная `NODE_VERSION` на Render. Тогда обновление Node не произойдёт незаметно. Если готовиться к Mastra — после переноса этого исправления в `main`.
