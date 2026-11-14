# Бот на пути платформы: после слияния PR (b)

Коротко для владельца. Слияние PR (b) в `main` и деплой на Render применяют миграции 0013–0015
(таблицы Slice A) при старте сервера. Флаг `BOT_PLATFORM_RUNTIME` остаётся выключенным: все боты
отвечают прежним путём, новые таблицы пустые.

## 1. Лог старта на Render

Render → сервис `ketner-ai` → Logs, первый старт после деплоя. Должны быть строки:

```text
[db] миграция 0013_platform_agent_specs применена
[db] миграция 0014_platform_agent_deployments применена
[db] миграция 0015_platform_agent_executions применена
🎉 [db] Все данные успешно синхронизированы с PostgreSQL / Supabase!
[mock-api] ketner-ai слушает http://127.0.0.1:…
```

При следующих стартах строк «миграция … применена» для 0013–0015 нет: миграции уже записаны.

**Плохие признаки:**

- `❌ [db] Версионные миграции не применены:` — сервер работает (чат, оплата, Code), но
  Builder, решения и боты выключены, пока миграции не пройдут. Каждая миграция идёт в своей
  транзакции: 0013 могла примениться, а 0014 — нет. Действие — откат (раздел 4), затем прислать
  текст ошибки из лога.
- `MigrationChecksumError` — текст применённой миграции изменился. Ничего не менять в базе руками,
  прислать лог.

## 2. Три запроса только на чтение

Supabase → SQL Editor. Запросы ничего не меняют.

Записи миграций (ожидается три строки):

```sql
SELECT id, applied_at FROM schema_migrations
WHERE id IN ('0013_platform_agent_specs', '0014_platform_agent_deployments', '0015_platform_agent_executions')
ORDER BY id;
```

Таблицы есть и RLS включён (ожидается пять строк, везде `rls = true`):

```sql
SELECT c.relname AS table_name, c.relrowsecurity AS rls
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('solution_version_specs', 'agent_deployments', 'executions', 'execution_events', 'execution_effects')
ORDER BY c.relname;
```

Таблицы пустые, пока флаг выключен (ожидается пять нулей):

```sql
SELECT
  (SELECT count(*) FROM solution_version_specs) AS specs,
  (SELECT count(*) FROM agent_deployments) AS deployments,
  (SELECT count(*) FROM executions) AS executions,
  (SELECT count(*) FROM execution_events) AS events,
  (SELECT count(*) FROM execution_effects) AS effects;
```

## 3. Включить путь платформы для ОДНОГО решения

1. Id решения — в адресе страницы бота в Builder: `…/solutions/<id>`.
2. Render → `ketner-ai` → Environment → переменная `BOT_PLATFORM_RUNTIME` = `<id>` — ровно один
   id, не `all` и не список. Save: Render перезапускает сервис.
3. В логе старта новых строк миграций нет — это нормально. Reaper зависших исполнений запускается
   сам, когда флаг не `off`.
4. Задать боту вопросы в его виджете: `…/b/<адрес бота>`. Ответы списываются с кредитов владельца
   бота, как сейчас: не больше 30 кредитов на ответ. Проба в Builder тоже идёт путём платформы.
5. Результат — в браузере, войдя администратором (адрес из `ADMIN_EMAILS`):
   `…/api/admin/platform/executions/view?solution=<id>`. Там видны статус, причина остановки,
   шаги, инструменты, себестоимость, списанные кредиты, длительность и модели каждого ответа.
   Текста сообщений на странице нет. Тот же отчёт в JSON: `…/api/admin/platform/executions?solution=<id>`.

**На что смотреть:**

- статус `succeeded`, причина `answer` или `escalated`;
- «последний шаг без инструментов» — редко;
- списано на ответ не больше 0,03 $;
- нет статуса `running` дольше нескольких минут (через 15 минут такие исполнения закроет reaper с
  ошибкой `reaped_stale_running`).

**Выключить:** `BOT_PLATFORM_RUNTIME` = `off` (или удалить переменную) → Save. Бот сразу отвечает
прежним путём. Записи журнала остаются — их видно на той же странице.

## 4. Откат

Порядок важен: сначала код, потом SQL. Если сначала выполнить SQL, а код с миграциями 0013–0015
останется, следующий старт создаст таблицы заново.

1. Флаг: `BOT_PLATFORM_RUNTIME` = `off`, если включали.
2. Код: Render → `ketner-ai` → Events → Rollback на деплой до слияния PR (b) (или revert слияния в
   `main`). Старый код новые таблицы не трогает и стартует при их наличии: записи 0013–0015 в
   `schema_migrations`, которых нет в его списке, он пропускает.
3. Схема, если нужно убрать таблицы: Supabase → SQL Editor, одним запуском — `BEGIN;`, затем
   содержимое [PERSISTENCE_SLICE_A_ROLLBACK.sql](PERSISTENCE_SLICE_A_ROLLBACK.sql) целиком, затем
   `COMMIT;`. При любой ошибке ничего не меняется. Удаляются пять таблиц, четыре функции, ограничение
   `solutions_id_user_key` и записи 0013–0015 в `schema_migrations`. Существующие таблицы и данные
   не меняются (проверено на стенде: каталог, данные и `pg_dump` — идентично). Теряется только журнал
   исполнений пути платформы.
4. Проверка — запрос 2 из раздела 2 возвращает ноль строк.
