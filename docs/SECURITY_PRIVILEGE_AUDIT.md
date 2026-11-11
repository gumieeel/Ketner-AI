# Права ролей API Supabase на таблицах Ketner: аудит и исправление

Составлено 11.11.2026. Статус — **предложение, ждёт одобрения**. В базу проекта ничего не применялось; код приложения не менялся.

| Файл | Что это |
| --- | --- |
| [SECURITY_REMEDIATION_PROPOSAL.sql](SECURITY_REMEDIATION_PROPOSAL.sql) | Исправление: `REVOKE ALL` у `anon`/`authenticated` + `ALTER DEFAULT PRIVILEGES`, с проверками внутри |
| [SECURITY_REMEDIATION_ROLLBACK.sql](SECURITY_REMEDIATION_ROLLBACK.sql) | Откат: возвращает права ровно такими, какими они были |
| [security-review/production-readonly-queries.sql](security-review/production-readonly-queries.sql) | Запросы только для чтения к production (Q1–Q7) |
| [security-review/table-fingerprint.sql](security-review/table-fingerprint.sql) | Отпечаток данных: строки + md5 по каждой таблице (только `SELECT`) |
| [security-review/verify-restore.sh](security-review/verify-restore.sh) | Восстановление копии в одноразовый кластер и сверка с отпечатком production |
| [security-review/run-security-review.sh](security-review/run-security-review.sh) | Полная проверка на одноразовом кластере; результат — [security-review/last-run.txt](security-review/last-run.txt) |

## 1. Итог

- В production RLS включён на **всех** таблицах `public`, а сервер работает ролью-владельцем с BYPASSRLS. Поэтому строки через API Supabase сейчас **не читаются и не вставляются**: политик нет.
- Лишнее — права `anon` и `authenticated`, которые Supabase выдаёт по умолчанию:
  - **`TRUNCATE`**: на него RLS не действует. Через Data API (PostgREST) `TRUNCATE` не выполнить, поэтому сейчас это вторая линия защиты, а не открытая дыра;
  - права по умолчанию: каждая **новая** таблица снова получит всё. Если её создать без RLS, данные сразу откроются через Data API.
- Ketner этими ролями не пользуется. В репозитории нет клиента Supabase (`@supabase/*`, ключа `anon`, `SUPABASE_URL`): вход через Better Auth, к базе обращается только сервер через `DATABASE_URL`.
- Исправление снимает права и меняет права по умолчанию. **RLS не трогает.** Проверено на одноразовом кластере по модели production (раздел 5).
- **Резервных копий нет.** Применять что-либо к production можно только после проверенной копии (раздел 7).

## 2. Production: проверено и не проверено

| Факт | Статус | Источник |
| --- | --- | --- |
| Сервер подключается ролью `postgres`: `rolsuper = false`, `rolbypassrls = true`, `rolcanlogin = true` | **Проверено** 11.11.2026 | Владелец проекта (Supabase, Free plan) |
| `service_role` — BYPASSRLS; `anon`, `authenticated` — без BYPASSRLS | **Проверено** | То же |
| Все таблицы `public` принадлежат `postgres`, RLS включён (`relrowsecurity = true`), `FORCE` выключен | **Проверено** | То же |
| У `anon` и `authenticated` есть `SELECT`, `INSERT`, `TRUNCATE` на каждой таблице | **Проверено** | То же |
| Полный набор прав ролей API (есть ли ещё `UPDATE`, `DELETE`, `REFERENCES`, `TRIGGER`, `MAINTAIN`) и права `service_role` | Не проверено | Q3 |
| Политики и представления в `public` | **Не проверено** — в сообщении стоял шаблон «[вставьте результат последнего запроса]» вместо результата | Q5 |
| Как заданы права по умолчанию (в схеме `public` или глобально; кем) | Не проверено | Q4 |
| Последовательности и функции в `public` и их права | Не проверено | Q5 |
| Какие схемы открыты через Data API | Не проверено | Q6 |
| Версия Postgres (от неё зависит версия `pg_dump` для копии) | Не проверено | Q1 |
| Точный список таблиц в production (есть ли таблицы вне списка ниже, например `billing_events`) | Не проверено | Q3 |

Пока по пунктам «не проверено» нет ответа, исправление применять нельзя. Выполнить [production-readonly-queries.sql](security-review/production-readonly-queries.sql) — все запросы идут в транзакции `READ ONLY` и откатываются — и прислать результат без строк подключения.

## 3. Таблицы

Значения production одинаковы для всех таблиц (раздел 2): владелец `postgres`, RLS включён, `FORCE` выключен, у `anon`/`authenticated` — права по умолчанию. Права `service_role` не проверены.

Кому права нужны (одинаково для каждой таблицы):

- **`postgres` (сервер Ketner)** — нужны все: владелец, читает и пишет, создаёт таблицы и выполняет миграции при старте;
- **`anon`, `authenticated`** — не нужны: в коде нет клиента Supabase;
- **`service_role`** — коду не нужна. Исправление её не трогает: это роль Supabase, ею могут пользоваться панель и служебные функции.

| Таблицы | Откуда | Что хранят (насколько чувствительно) |
| --- | --- | --- |
| `user`, `session`, `account`, `verification` | Better Auth (`auth/better-auth.ts`, `db/sync.ts`) | Учётные записи, **сессии**, OAuth-токены провайдеров входа, коды подтверждения |
| `ketner_users` | `db/sync.ts` | Пользователи, **хеши паролей**, тариф |
| `api_keys`, `revoked_tokens` | `db/sync.ts` | **Ключи API**, отозванные токены |
| `github_connections` | `db/sync.ts` | **Токены GitHub** (зашифрованы) |
| `ketner_docs` | `db/sync.ts` | Документы хранилища: кредиты, начисления, платежи, использование |
| `subscriptions`, `crypto_invoices`, `usage_metrics` | `db/sync.ts` | Подписки, счета, расход |
| `conversations`, `messages`, `feedbacks` | `db/sync.ts` | Переписка пользователей с моделями, отзывы |
| `code_projects`, `code_project_files`, `generated_images` | `code/postgres-driver.ts`, `images/image-store.ts` | Код пользователей, изображения |
| `schema_migrations` | Раннер миграций | Применённые миграции |
| `discovery_analyses`, `discovery_opportunities`, `discovery_budget_days`, `discovery_budget_reservations`, `discovery_plans` | Миграции `0001`–`0003`, `0005` | Анализ бизнеса клиента |
| `solutions`, `solution_versions`, `solution_test_cases`, `solution_test_runs`, `solution_threads`, `solution_messages`, `solution_materials`, `solution_runs`, `solution_attempts` | `0004`, `0007`–`0011` | Решения клиентов, материалы, история |
| `bot_conversations`, `bot_messages`, `bot_leads` | `0006` | **Переписка ботов с клиентами клиентов, контакты лидов** |
| `pricing_versions`, `implementation_estimates`, `implementation_requests`, `pricing_audit_log` | `0012` | Цены, сметы, заявки |
| `billing_events` | Устаревший `0000_init.sql` | Может отсутствовать: сервер её не создаёт |
| `security_remediation_state` | Это исправление | Прежние права для отката |

Таблицы `public`, которых нет в списке, исправление не меняет: оно только перечисляет их в `NOTICE`, если у ролей API на них есть права. Объекты Supabase (схемы `auth`, `storage`, `realtime`, `extensions`, `graphql` и др.) не затрагиваются.

## 4. Исправление

[SECURITY_REMEDIATION_PROPOSAL.sql](SECURITY_REMEDIATION_PROPOSAL.sql), выполняется ролью `postgres` одной транзакцией (`psql -1 -v ON_ERROR_STOP=1`):

1. **Предусловие.** Текущая роль — владелец каждой существующей таблицы из списка. Иначе исключение, и ничего не меняется.
2. **Прежнее состояние.** Права `anon`/`authenticated` по каждой таблице и права по умолчанию записываются в `security_remediation_state`. Повторный запуск запись не перезаписывает.
3. **`REVOKE ALL ON TABLE … FROM anon, authenticated`** на таблицах из списка.
4. **`ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated`** — новые таблицы сервера прав этим ролям не получат.
5. **Самопроверка.** Если хоть одна проверка не прошла — исключение, и вся транзакция откатывается:
   - на таблицах из списка нет ни одной записи прав `anon`/`authenticated`/`PUBLIC`;
   - `has_table_privilege` для обеих ролей возвращает false;
   - пробная таблица, созданная внутри транзакции, не получает их прав. Это ловит права по умолчанию, заданные глобально или другой ролью.

Чего не делает:

- не включает и не выключает RLS — в production он уже включён (таблицы без RLS только перечисляются в `NOTICE`);
- не включает `FORCE`, не создаёт политик;
- не меняет права `service_role` и владельца, не меняет данные.

Повторный запуск безопасен.

Ограничения:

- **Права на отдельные колонки** снимаются вместе с правами на таблицу, а откат их не вернёт. Если такие есть, скрипт сообщает об этом в `NOTICE`; у ролей API в Supabase их обычно нет — проверить по Q3.
- **Последовательности и функции** не входят в согласованный объём. На стенде права по умолчанию для них остаются у `anon` (раздел 6).
- Создание таблицы в Supabase запускает событийный триггер `pgrst_ddl_watch`: PostgREST перечитает схему. Это безвредно.

## 5. Проверка на одноразовом кластере

[run-security-review.sh](security-review/run-security-review.sh), PostgreSQL 16.15. Модель production:

- `ketner_backend` — владелец таблиц, не суперпользователь, BYPASSRLS (как `postgres` в Supabase);
- RLS включён на всех таблицах;
- права по умолчанию как в Supabase: всё на таблицы, последовательности и функции ролям `anon`, `authenticated`, `service_role`.

Таблицы создал **настоящий сервер Ketner** (`db/sync.ts`, миграции `0001`–`0012`): 40 таблиц. Полный вывод — [last-run.txt](security-review/last-run.txt).

| Проверка | Результат |
| --- | --- |
| Смоук через API до исправления: здоровье, вход, создание, список, чтение и удаление решения (каскадом), создание диалога | 7/7 |
| Репетиция резервной копии (раздел 7): снимок экспортирован, `pg_dump` и отпечаток сняты из него, между ними чужая запись | Копия восстановлена без ошибок; 40 таблиц совпали с отпечатком (строки + md5), хотя живая база уже отличалась |
| До исправления: `anon`/`authenticated` | `SELECT` — 0 строк (RLS), **`TRUNCATE` прошёл** на всех 6 проверенных таблицах (`ketner_docs`, `session`, `github_connections`, `solutions`, `bot_leads`, `pricing_versions`) |
| Исправление ролью-владельцем (не суперпользователем), дважды | Прошло; второй запуск сохранил первую запись состояния (42 строки) |
| Права `anon`/`authenticated` после исправления | Нет ни одного права на 41 таблице; чтение и `TRUNCATE` — отказ `42501` |
| RLS, `FORCE`, владелец, права `service_role` | Не изменились |
| Данные | Не изменились (40 таблиц, строки + md5) |
| Новая таблица, созданная владельцем после исправления | Без прав `anon`/`authenticated`; `service_role` права по умолчанию сохранила |
| Отказ: запуск ролью, которая не владелец | Исключение `run this as the owner…`; права не изменились |
| Отказ: права по умолчанию заданы глобально (без `IN SCHEMA`) | Исключение `a new table still receives privileges for: anon`; вся транзакция откатилась, служебной таблицы нет |
| Сервер после исправления: старт (проверка таблиц, раннер миграций) и тот же смоук | 7/7, в журнале сервера ошибок прав нет |
| Откат после реальной работы сервера | Каталог (записи прав отсортированы) идентичен; права и RLS идентичны; `pg_dump --schema-only` отличается только порядком строк `GRANT` |
| Применение и сразу откат | Данные и каталог идентичны; исправление повторно применяется после отката |
| Весь набор тестов сервера (роль-владелец; в базе применено исправление) | 810 тестов: **809 прошло, 0 упало, 1 пропущен** (PGlite не установлен) |

Пояснения:

- **Порядок записей прав.** После `REVOKE` и повторного `GRANT` PostgreSQL добавляет запись роли в конец списка: права те же, порядок другой. Поэтому сырой каталог отличается в 80 строках, а нормализованный (записи отсортированы, [normalize-acl.mjs](security-review/normalize-acl.mjs)) совпадает.
- **Сортировка снимка каталога.** У трёх ограничений `discovery_budget_reservations` одинаковое сокращённое имя, и снимок, отсортированный только по имени, мог менять их порядок. В `persistence-review/catalog-snapshot.sql` добавлена сортировка по свойствам.
- **Тесты используют свои схемы.** Набор создаёт свою схему на каждый тест, поэтому права в `public` его не касаются. Что сервер работает с таблицами `public` после исправления, доказывают смоук-тесты через API и старт сервера.

## 6. Вне объёма (нужно решение)

1. **Последовательности.** Права по умолчанию Supabase выдают `anon` права `USAGE`/`SELECT`/`UPDATE` на новые последовательности, то есть `setval`. В таблицах Ketner последовательностей на стенде нет (ключи — текст и `uuid`). В production — Q5.
2. **Функции.** `EXECUTE` выдаётся `PUBLIC` и `anon` (на стенде: `solutions_legacy_template()` из `0011`). Это триггерная функция, через RPC её не вызвать. Новая `platform_contains_secret(jsonb)` из `0013` была бы вызываема через Data API. Предложение: в будущих миграциях — `REVOKE EXECUTE … FROM PUBLIC, anon, authenticated`.
3. **Data API.** Если он не нужен (Ketner его не использует), можно убрать схему `public` из открытых в настройках Supabase. Это изменение конфигурации проекта, не базы; решает владелец.

## 7. Порядок выката (обязательная проверенная копия)

В проекте (Supabase Free plan) **нет резервных копий**. Ни одна миграция — это исправление, `0013`+ и любые другие — не применяется к production без шагов 1–4.

**1. Запросы только для чтения.** Выполнить Q1–Q7 и прислать результат. Версия из Q1 определяет версию `pg_dump`: та же major-версия или новее.

**2. Копия и отпечаток из одного снимка.** Подключение — прямое (`db.<ref>.supabase.co:5432`) или пулер в режиме сессии. Пулер в режиме транзакций (порт 6543) не подходит. Пароль вводится по запросу `psql`/`pg_dump` или через `~/.pgpass`; в команды и чат его не вставлять.

Терминал A — сессия держит снимок открытым:

```
psql "host=… port=5432 dbname=postgres user=postgres sslmode=require" -X -tA
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT pg_export_snapshot();          -- скопировать идентификатор снимка
```

Терминал B — копия всей базы из этого снимка (не закрывая терминал A):

```
pg_dump "host=… port=5432 dbname=postgres user=postgres sslmode=require" --snapshot=<идентификатор> -Fc -f ketner-<дата>.dump
```

Снова терминал A — отпечаток из того же снимка, затем закрыть транзакцию:

```
\pset fieldsep '|'
\o production-fingerprint.txt
\i docs/security-review/table-fingerprint.sql
\o
COMMIT;
```

**3. Проверка восстановления на одноразовом кластере** (та же или более новая major-версия Postgres, что в Q1):

```
PGBIN=/usr/lib/postgresql/<версия>/bin bash docs/security-review/verify-restore.sh ketner-<дата>.dump production-fingerprint.txt
```

Нужно получить `restore: OK` и `PASS restored copy matches production fingerprint`.

- Восстанавливается схема `public`; схемы Supabase остаются в копии для восстановления в Supabase.
- При `FAIL` — остановиться, ничего не применять.
- Копию хранить вне Supabase и вне репозитория: в ней пользовательские данные и секреты.

Эти шаги отрепетированы на одноразовом кластере (раздел 5): снимок, запись после него, копия, восстановление, совпадение 40 таблиц.

**4. Только после `PASS`:** в окно с малой нагрузкой выполнить ролью `postgres`:

```
psql "…" -X -1 -v ON_ERROR_STOP=1 -f docs/SECURITY_REMEDIATION_PROPOSAL.sql
```

При любой ошибке транзакция откатывается целиком.

**5. Проверка после применения:**

- повторить Q3 и Q4: у `anon`/`authenticated` прав нет; в Q4 для `postgres`/`public`/`r` их тоже нет;
- проверить сайт: вход, список решений, чат.

**6. Откат при проблемах:**

```
psql "…" -X -1 -v ON_ERROR_STOP=1 -f docs/SECURITY_REMEDIATION_ROLLBACK.sql
```

Откат возвращает права ровно такими, какими они были.

## 8. Ошибки в `main`, найденные попутно (не исправлены — вне задачи)

1. **Сервер не стартует на Node ≥ 22.13 с `DATABASE_URL`.**
   - Причина: `initAuthDatabase` (`auth/better-auth.ts`) при доступном `node:sqlite` вызывает Better Auth `getMigrations`, а тот для адаптера drizzle вызывает `process.exit(1)` (`better-auth/dist/db/get-migration.mjs`) — `try/catch` это не ловит.
   - Воспроизведено на Node 22.23.4: сервер завершается с кодом 1 до `listen`. На стенде он запускается с `--no-experimental-sqlite`.
   - `package.json` требует `node >= 22.12.0`, а `node:sqlite` доступен без флага с 22.13. Production работает, значит Render, видимо, использует 22.12 или другую сборку — **не проверено**. Риск: обновление Node на Render остановит сервер.
2. **Демо-пользователь в Postgres не может войти.** `db/sync.ts` записывает хеш `4578b6…`, а `pbkdf2('password123', соль из нулей)` даёт `bbc0bc…`. Вход демо-аккаунтом при `DATABASE_URL` возвращает `500 demo_unavailable`. В production демо отключён, затронуты только разработка и стенды.
