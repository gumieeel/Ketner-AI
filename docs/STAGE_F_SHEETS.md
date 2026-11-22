# Этап F, первое внешнее действие: заявка в Google Таблицу

Статус — **в работе, выключено** (переключатель `googleSheets` в `product-switches.ts`): шаги 1–4 — миграция, шифрование токена, подключение Google, доставка заявок и кабинет (`google/delivery*.ts`, `pages/solutions/google-sheet-card.tsx`). Шаг 5 — проверка на настоящем аккаунте Google, затем включение. Решения владельца (20.11.2026): первое внешнее действие — запись
заявки бота в Google Таблицу владельца; только разрешение `drive.file`; Ketner вызывает Google сам,
без n8n; календарь — после. Миграция — [`docs/stage-f/0016_google_sheets.proposal.sql`](stage-f/0016_google_sheets.proposal.sql):
проверена на ревью 21.11.2026 (PostgreSQL 16.15 и 17.6, пустые базы с ролями `anon` / `authenticated`)
и перенесена в `migration-list.ts` как `0016_google_sheets` дословно; совпадение и поведение
ограничений проверяет `db/stage-f-migration.test.ts`. Миграции применяются при запуске сервера:
перед выкатом — свежая резервная копия базы.

## 1. Что получает владелец

1. В кабинете бота (раздел «Заявки») — кнопка «Записывать заявки в Google Таблицу».
2. Вход в Google на странице Google, согласие: «Просматривать, создавать, изменять и удалять только
   те файлы Google Диска, которые вы используете в этом приложении».
3. Ketner создаёт в Диске владельца таблицу «Заявки Ketner» с заголовками и показывает ссылку.
4. Каждая новая заявка любого бота аккаунта дописывается строкой. Посетитель ничего не ждёт:
   запись идёт после сохранения заявки, в фоне.
5. У каждой заявки в кабинете — отметка «в таблице» / «записывается» / «не записано, повторить».
6. «Отключить таблицу» — одна кнопка; доступ Ketner к Google отзывается.

Заявки по-прежнему сохраняются в Ketner и приходят письмом (#57): таблица — копия, не замена.
Сбой Google заявку не теряет.

**Одна таблица на аккаунт**, колонка «Бот» различает ботов. Таблица на каждого бота — позже, если
попросят.

Колонки: `Дата` · `Бот` · `Имя` · `Контакт` · `Вопрос` · `Диалог` (ссылка в кабинет) ·
`ID заявки`. Последняя нужна для сверки при неясном исходе записи (раздел 5.3). Владелец может её
скрыть, но не удалять.

## 2. Подключение: данные и шифрование

### 2.1. Таблица `google_connections` (одна строка на аккаунт)

| Поле                                                        | Что хранит                                                                                     |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `user_id` (PK)                                              | аккаунт Ketner                                                                                 |
| `google_sub`                                                | постоянный id аккаунта Google (из `id_token`) — понять, тот ли аккаунт подключён снова         |
| `google_email`                                              | почта Google — показать владельцу, какой аккаунт подключён                                     |
| `scopes`                                                    | выданные разрешения, как вернул Google (проверяем, что есть `drive.file`)                      |
| `refresh_token_enc`                                         | refresh-токен, **зашифрован**; `NULL` после отключения                                         |
| `spreadsheet_id`                                            | id таблицы; `spreadsheet_url` — ссылка для кабинета                                            |
| `status`                                                    | `connected` · `reconnect_required` · `sheet_missing` · `disconnected`                          |
| `last_error_code`                                           | последний код сбоя (`invalid_grant`, `not_found`, `trashed`, `quota`, `http_5xx`…), без текста |
| `last_ok_at`, `last_error_at`, `connected_at`, `updated_at` | для кабинета и поддержки                                                                       |

Access-токен (живёт около часа) **не хранится**: держится в памяти процесса до истечения и
обновляется по refresh-токену. Ничего из этого не уходит на сайт, в логи, журнал, промпты и знания.

### 2.2. Шифрование — то же, что у GitHub

`github/connection-store.ts`: AES-256-GCM, случайный IV 12 байт, тег, формат
`v1.<iv>.<tag>.<body>` (base64url). Ключ — `sha256('ketner:github-token:' + BETTER_AUTH_SECRET)`.

План: вынести `encryptToken` / `decryptToken` в `platform/token-crypto.ts` с меткой назначения —
`keyFrom(secret, 'google-token')`. Метка разделяет ключи: токен GitHub не расшифровать ключом
Google и наоборот. GitHub остаётся на прежней метке, его данные не трогаем.

Следствие (как и у GitHub): смена `BETTER_AUTH_SECRET` делает сохранённые токены нечитаемыми.
Подключения переходят в `reconnect_required`, владельцы подключают Google заново. Отдельный ключ
`CONNECTIONS_SECRET` — позже, вместе с ротацией ключей.

## 3. Вход в Google: OAuth 2.0 на ketner.org

Отдельный OAuth-клиент (раздел 9), не клиент входа через Google. Маршруты (после входа в Ketner):

1. `POST /api/integrations/google/start` → `{ url }`. Сервер:
   - создаёт `state`: HMAC-подпись `{ userId, nonce, exp: +10 мин, returnTo }` — как
     `github/oauth.ts`, с меткой `ketner:google-state:`;
   - создаёт `code_verifier` (43–128 символов, `crypto.randomBytes(32)` → base64url) и кладёт его
     **на сервер**: `ketner_docs`, namespace `google_oauth`, id = `nonce`, срок 10 минут. В `state`
     и в браузер verifier не попадает — иначе PKCE ничего не защищает;
   - адрес авторизации `https://accounts.google.com/o/oauth2/v2/auth`:
     - `response_type=code`;
     - `scope=openid email https://www.googleapis.com/auth/drive.file`;
     - `access_type=offline`, `prompt=consent` — чтобы пришёл refresh-токен;
     - `code_challenge=base64url(sha256(verifier))`, `code_challenge_method=S256` — S256 указываем
       явно, по умолчанию Google считает `plain`;
     - `state`, `redirect_uri`, `include_granted_scopes=false`.
2. `GET /api/integrations/google/callback?code&state` (адрес из Google Cloud) — без входа:
   - проверяет подпись и срок `state`;
   - возвращает человека на `returnTo` с `#google_code=…&google_state=…` **во фрагменте** адреса:
     код не попадает в логи сервера и Referer;
   - отказ человека или ошибка Google → `#google_error=denied` / `failed`, испорченный `state` →
     `#google_error=state` на `/settings`; без деталей.
3. `POST /api/integrations/google/confirm { code, state }` — в сессии Ketner:
   - `state` того же пользователя, что вошёл; иначе отказ, verifier владельца не тратится;
   - забирает verifier по `nonce` **и удаляет запись** (одноразово);
   - обменивает `code` на токены (`https://oauth2.googleapis.com/token`, `client_secret` + `code_verifier`);
   - проверяет выданные разрешения: `drive.file` обязателен (иначе отказ «не выдано разрешение на
     файлы»); всё сверх `openid` / `email` (`userinfo.email`) / `drive.file` — отказ. При отказе
     выданный доступ сразу отзывается;
   - берёт `sub` и почту из `id_token` (получен напрямую из token endpoint по TLS — проверяем
     издателя, получателя и срок, подпись не нужна: OpenID Connect Core, п. 3.1.3.7);
   - сохраняет подключение, создаёт таблицу (раздел 4). Таблица не создалась — подключение
     сохраняется со статусом `sheet_missing` и кодом сбоя.

**Почему колбэк не обменивает код сам (изменено при реализации, шаг 3).** Сессия сайта Ketner — это
Bearer-токен в приложении, а не cookie (вход по паролю cookie не ставит). На переходе от Google
запрос несёт только cookie, поэтому колбэк не знает, кто вошёл. Поток повторяет подключение GitHub
(`routes/github.ts`): обмен — `POST /confirm` из сайта, в той сессии, что начала подключение. Сайту
(шаг 4) нужно на странице возврата прочитать фрагмент и вызвать `/confirm`.

4. `GET /api/integrations/google` — статус для кабинета (без токенов и `sub`);
   `DELETE /api/integrations/google/connection` — отключение (раздел 7).

Повторное подключение того же `google_sub` сохраняет `spreadsheet_id`. Другой аккаунт Google
даёт новую таблицу: к таблице прежнего аккаунта доступа нет.

Сверить при реализации по документации Google (страница web-server OAuth из этой среды не
открылась): параметры refresh-токена и поддержку PKCE у web-клиента с секретом. PKCE и `S256`
описаны в документации Google для установленных приложений; веб-клиент отправляет и секрет, и
verifier.

## 4. Таблица

- Создание: Sheets API `spreadsheets.create` — разрешает `drive.file`. Название «Заявки Ketner»,
  лист «Заявки», строка заголовков, первая строка закреплена.
- Запись: `spreadsheets.values.append`, диапазон `Заявки!A:G`, `valueInputOption=RAW`,
  `insertDataOption=INSERT_ROWS` — тоже разрешает `drive.file`.
  - **`RAW`, не `USER_ENTERED`**: поля заполняет посетитель. Строка `=IMPORTXML(...)` или
    `+cmd|...` при `USER_ENTERED` стала бы формулой (formula injection); при `RAW` это просто текст.
  - Поля посетителя (имя, контакт, вопрос), начинающиеся с `=`, `+`, `-`, `@`, табуляции или
    возврата каретки, пишутся с апострофом впереди (`google/sheets.ts`, `neutralizeFormula`): `RAW`
    защищает саму Google Таблицу, апостроф — выгрузку в CSV, открытую в Excel. Исключения — значение
    целиком номер телефона (`+` впереди по желанию, дальше цифры, пробелы, скобки, точки, дефисы, не
    меньше 5 цифр) или целиком ник (`@` и 3–32 латинские буквы, цифры, `_`, `.`): они пишутся как
    есть — вызвать функцию в Excel они не могут.
- Сверка: `spreadsheets.values.get` колонки `G` (ID заявки).
- Проверка корзины: Drive API `files.get?fields=trashed` — `drive.file` даёт метаданные файлов
  приложения.

`drive.file` ограничивает Ketner файлами, которые он создал или которые выбрал владелец. Выбор
своей существующей таблицы (Google Picker) — не в первом срезе.

## 5. Действие `sheet.append_row`: риск и журнал

### 5.1. Риск (`platform/risk.ts`)

Новая запись в `ACTIONS`:

```ts
'sheet.append_row': {
  id: 'sheet.append_row',
  consequences: { effect: 'write', reach: 'external', audience: 'single', reversible: true, impact: 'routine' },
  requires: ['spreadsheets_sync'],
  description: 'Строка в таблице владельца (одна заявка)',
},
```

`classifyRisk` → **LOW** (внешняя запись одной строки, обратимая, обычная).
`approvalRequirement` → `none`: выполняется сразу, без одобрения. Владелец дал согласие, подключив
таблицу. Тест в `risk.test.ts` закрепляет LOW и `none`.

### 5.2. Журнал: reserve → dispatch → commit

Запись идёт отдельным исполнением на заявку, не внутри исполнения бота. Заявка может прийти из
формы без модели, а запись — позже и с повторами.

| Поле `executions`                | Значение                                                                     |
| -------------------------------- | ---------------------------------------------------------------------------- |
| `id`                             | `delivery:<leadId>`                                                          |
| `kind`                           | `delivery` (**новое значение**, миграция)                                    |
| `trigger_kind`                   | `lead_created` (**новое**, миграция); в `COUNTED_TRIGGERS` его **нет**       |
| `trigger_ref`                    | `lead:<leadId>`                                                              |
| `solution_id`                    | решение бота (требует триггер `executions_insert_refs`)                      |
| `idempotency_key`                | `sheet:<leadId>` — **ключ идемпотентности = id заявки**; уникален на аккаунт |
| `runtime`, `agent_deployment_id` | `NULL`                                                                       |

Эффект `execution_effects`: `step_key = 'sheet_append'`, `action = 'sheet.append_row'`,
`external = true`, `authorized_by = 'risk_low'`, `provider_supports_idempotency = false`
(у `values.append` нет ключа идемпотентности).

Ход (машина состояний — триггер `execution_effects_guard`):

1. Заявка сохранена → `start` с `idempotency_key = sheet:<leadId>`. Повтор (двойной вызов, рестарт)
   даёт `duplicate` и второй строки не будет.
2. `reserveEffect` → `reserved`, аренда 2 минуты.
3. Перед запросом к Google → `dispatched` (`dispatched_at`).
4. Ответ 200 → `committed`, `result_ref = <updatedRange>`.
   Ответ 4xx/5xx → `failed`, `failure_stage = provider_rejected`.
   Таймаут или обрыв после отправки → **`unknown`** (строка могла записаться).
5. `unknown` нельзя повторить вслепую: у Sheets нет ключа идемпотентности, переход
   `unknown → reserved` триггер не разрешает. Сверка (раздел 5.3) переводит в `committed` или в
   `failed (reconciled_not_done)`.
6. Не получили токен или нет подключения → `failed`, `failure_stage = before_dispatch`: запрос не
   уходил.

В `result_meta` — только `{ http: 200, rows: 1 }` или код ошибки, без данных заявки. Это проверяет
`execution_effects_no_secrets`. Значения строки в журнал не пишутся.

### 5.3. Сверка неясного исхода

`values.get` по колонке `G`: если в ней есть `leadId`, эффект → `committed`
(`resolved_by = 'reconcile:sheet_id_column'`), иначе → `failed (reconciled_not_done)`, затем
обычный повтор. Поэтому колонка «ID заявки» обязательна.

## 6. Повторы и что видит владелец

- Попытка сразу после сохранения заявки, без ожидания посетителем.
- Повтор `failed → reserved` (`attempts + 1`, база разрешает **не больше 4 попыток**). Паузы:
  1 мин, 5 мин, 30 мин. Повторяет фоновый обход раз в минуту (как `execution-reaper.ts`): берёт
  `failed` с `attempts < 4` и истёкшей паузой, `unknown` — на сверку, `reserved`/`dispatched` с
  истёкшей арендой. Аренда исключает двойную отправку при нескольких процессах.
- Не повторяем при `invalid_grant`, `not_found`, `trashed`, `403 insufficient permissions` — это не
  временный сбой. Подключение переходит в `reconnect_required` или `sheet_missing`, а записи ждут
  исправления.
- 429/5xx — повторяем. Лимит Sheets API на проект и пользователя в минуту при нашем объёме не
  достигается, но 429 обрабатываем.

Владелец видит:

| Состояние                                                   | В кабинете                                                                             | Уведомление                                                      |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| запись идёт или повторяется                                 | у заявки «записывается в таблицу»                                                      | —                                                                |
| 4 попытки не удались                                        | «не записано в таблицу» и кнопка «повторить»                                           | —                                                                |
| `reconnect_required` (доступ отозван, токен недействителен) | баннер «Доступ к Google отозван — подключите таблицу снова», заявки «ждут подключения» | письмо и Telegram один раз за поломку (отметка-claim, как в #57) |
| `sheet_missing` (таблица удалена или в корзине)             | баннер «Таблица удалена — создать новую?»                                              | так же                                                           |

Заявки, пришедшие при поломке подключения (`reconnect_required`, `sheet_missing`), получают
исполнение со сбоем «до отправки» и отметку «ждёт подключения»; «дописать пропущенные» после
исправления берёт все заявки, чья последняя запись не удалась. Обход раз в минуту идёт только с
журналом в Postgres (как reaper исполнений агента).

Кнопка «повторить» после 4 попыток создаёт новый шаг: `step_key = sheet_append_r<n>`, у него свои
4 попытки, `n ≤ 5`. Первые 4 попытки в истории не теряются. После восстановления подключения
владелец может нажать «дописать пропущенные»: повтор для всех незаписанных заявок с момента сбоя,
по одной, с той же идемпотентностью.

## 7. Отключение, отзыв, удаление

- **Отключение в Ketner:**
  - `POST https://oauth2.googleapis.com/revoke` с refresh-токеном (по документации RFC 7009 у
    Google — сверить формат при реализации). Если отзыв не прошёл, это не мешает отключению: только
    строка в логе.
  - `refresh_token_enc = NULL`, `status = disconnected`.
  - Таблица остаётся у владельца: Ketner её не удаляет.
  - Новые заявки в таблицу не пишутся. Незаконченные эффекты → `failed (before_dispatch)` с
    кодом `disconnected`, без повторов.
- **Владелец отозвал доступ в аккаунте Google** (myaccount.google.com → «Сторонние приложения»):
  обновление токена даёт `invalid_grant` → `reconnect_required`, уведомление. Записи ждут, после
  переподключения — «дописать пропущенные».
- **Владелец удалил таблицу:**
  - удаление насовсем: запись даёт 404 → `sheet_missing`;
  - в корзине: Sheets API продолжает писать в файл из корзины. Поэтому перед записью (не чаще раза
    в 10 минут на аккаунт — добавлено в шаге 5a, иначе заявки уходили бы в корзину до суточной
    проверки), при каждом `failed`, раз в сутки и перед «дописать пропущенные» проверяем
    `files.get?fields=trashed` → `trashed: true` → `sheet_missing`;
  - владелец выбирает: «Создать новую таблицу» (новый `spreadsheet_id`, затем «дописать
    пропущенные»), «Я восстановил таблицу — проверить» (таблица вернулась из корзины — подключение
    снова к ней, шаг 5a) или «Отключить».
- **Удаление аккаунта Ketner:** отзыв токена, строка `google_connections` удаляется вместе с
  аккаунтом. Исполнения доставки удаляются со своим решением по существующим правилам журнала.
  Реализовано в шаге 3: `google/erasure.ts` — первая регистрация в `eraseAccount(userId)`
  (`platform/account-erasure.ts`); отзыв по возможности — сбой только в лог, строка удаляется.
  Поддержка вызывает `npm run erase-account -- --user <id>` (по умолчанию — сводка без изменений,
  `--confirm` — удаление).
- **Сброс `BETTER_AUTH_SECRET`:** токен не расшифровывается → `reconnect_required` (раздел 2.2).

Подтвердить на стенде: после отзыва и повторного согласия тем же аккаунтом `drive.file` снова даёт
доступ к таблице, которую Ketner создал раньше. Если нет — при переподключении создаём новую
таблицу и честно говорим об этом.

## 8. Тесты

**Чистый код (без сети):**

- `risk.test.ts`: `sheet.append_row` → LOW, одобрение `none`, требует `spreadsheets_sync`.
- `token-crypto.test.ts`:
  - шифрование туда и обратно;
  - чужая метка (github ↔ google) не расшифровывает;
  - испорченный тег → `undefined`;
  - токен GitHub в прежнем формате читается.
- OAuth:
  - `state`: подпись, срок, другой пользователь → отказ;
  - verifier: одноразовый, просрочен → отказ;
  - `code_challenge = base64url(sha256(verifier))`, метод `S256`;
  - нет `drive.file` в выданных → отказ.
- Строка таблицы:
  - `RAW`, порядок колонок, `ID заявки` последней;
  - значения `=...`, `+...`, `@...` уходят текстом;
  - длинный вопрос обрезается до лимита ячейки.
- Классификация ошибок Google → повторять / не повторять / статус подключения (`invalid_grant`,
  404, trashed, 403, 429, 5xx, таймаут).

**Журнал (память и Postgres, как `journal.test.ts`):**

- доставка: `reserved → dispatched → committed`, повтор `start` с тем же `sheet:<leadId>` →
  `duplicate`, вторая строка не пишется;
- 5xx: `failed (provider_rejected)` → повтор через паузу → `committed`; 4-й сбой — без пятой попытки;
- таймаут → `unknown` → сверка нашла id → `committed (resolved_by)`; не нашла → `failed
(reconciled_not_done)` → повтор;
- `unknown → reserved` отвергается базой (нет идемпотентности у провайдера);
- исполнение доставки **не засчитывается** обращением тарифа (`request-count.ts`, оба варианта
  правила);
- `result_meta` без данных заявки (`execution_effects_no_secrets` не срабатывает, в метаданных
  только коды).

**Маршруты** (`startTestServer` и поддельный Google на `fetch`):

- start → callback → подключение `connected`, таблица создана;
- заявка → строка в поддельной таблице;
- отключение отзывает токен;
- чужая сессия на callback → отказ;
- повторный callback тем же `state` → отказ.

**Переключатель:** без `GOOGLE_SHEETS_CLIENT_ID` / флага выпуска кнопки нет, маршруты отвечают
503 `feature_unavailable`.

## 9. Что сделать владельцу в Google Cloud Console

**Как сделано (21.11.2026).** Проект — не тот, где настроен вход через Google, как предполагал
этот раздел, а отдельный: **project-ketner-english** (аудитория External, статус In production, бренд
проверен: главная `https://ketner.org`, политика `/privacy`, условия `/terms`, авторизованный домен
`ketner.org`). В нём создан клиент «Ketner Sheets» (Web application); `GOOGLE_SHEETS_CLIENT_ID` и
`GOOGLE_SHEETS_CLIENT_SECRET` заданы в Render.

Вход на сайт через Google (`GOOGLE_CLIENT_ID`) — клиент **другого** проекта; владелец сейчас не
находит этот проект в консоли. Следствия:

- экран согласия Google Таблиц показывает бренд **project-ketner-english** (название, логотип,
  ссылки на политику и условия этого проекта);
- вход через Google это не затрагивает: его клиент, экран согласия и разрешения остаются в своём
  проекте;
- прежний клиент «Ketner English Auth» в project-ketner-english (адрес возврата — Supabase Auth) не
  трогали; Ketner его не использует.

Шаги ниже — что настроено в project-ketner-english.

1. **APIs & Services → Library:** включить **Google Sheets API** и **Google Drive API** (Drive — для
   проверки корзины).
2. **Google Auth Platform → Data access (Scopes):** добавить
   `https://www.googleapis.com/auth/drive.file`. Google относит его к **non-sensitive** (не
   чувствительным): проверки чувствительных разрешений (sensitive scope verification) он не требует.
   `openid` и `email` там уже есть для входа.
3. **Google Auth Platform → Clients → Create client:** тип **Web application**, имя «Ketner Sheets».
   - Authorized redirect URI: `https://ketner.org/api/integrations/google/callback`.
   - JavaScript origins не нужны: поток серверный.
   - Отдельный клиент: свой секрет и свой адрес возврата, отзыв не задевает вход.
4. Client ID и секрет — в Render, переменные `GOOGLE_SHEETS_CLIENT_ID` и
   `GOOGLE_SHEETS_CLIENT_SECRET`. Секрет не пересылать в чат и в задачи.
5. **Audience:** приложение должно быть в статусе **In production**. В статусе Testing работают
   только тестовые пользователи, а refresh-токен истекает через 7 дней.
6. **Branding:** проверить «Verification status». Google требует проверку бренда (brand
   verification, обычно 2–3 рабочих дня), если приложение для внешних пользователей показывает на
   экране согласия название или логотип. Проверяются и домены главной страницы, политики и условий
   (ketner.org — в Search Console).
   - В project-ketner-english бренд проверен; `drive.file` (не чувствительное разрешение) новой
     проверки не требует.
7. Политика конфиденциальности на ketner.org уже содержит пункт о Google Таблицах и Limited Use
   (#60). Google проверяет его при проверке бренда.

**Меняется ли экран входа через Google?** Нет. Вход — клиент другого проекта, его настройки здесь не
менялись. Better Auth при входе просит `openid email profile`, как и раньше. `drive.file` появляется
только при нажатии «Записывать заявки в Google Таблицу», у клиента «Ketner Sheets» в
project-ketner-english.

## 10. Порядок работы (каждый — отдельный PR, без слияния до ревью)

1. Миграция `0016` — после одобрения владельцем SQL из `docs/stage-f/`; только тогда в
   `migration-list.ts`.
2. `token-crypto.ts` (вынос из GitHub без изменения формата) + `sheet.append_row` в `risk.ts` +
   тесты.
3. OAuth-поток и хранилище подключения, флаг выпуска выключен.
4. Доставка: исполнение, эффект, повторы, сверка, обход; кабинет: подключение, статусы, повтор.
5. Проверка на настоящем аккаунте Google (подключение, запись, корзина, отзыв, повторное
   подключение):
   - 5a — пилот: `GOOGLE_SHEETS_PILOT_ACCOUNTS` в `product-switches.ts` (сервер и сайт, один
     список); остальным — 503 и нет карточки. Ответы Google на обмен кода, обновление токена и
     отзыв пишутся в лог строками `[google:diag]` (коды и наличие refresh-токена, без токенов);
   - 5b — переключатель `GOOGLE_SHEETS_ENABLED = true` для всех, после удачной проверки 5a.

Источники (Google):

- [Sheets API scopes](https://developers.google.com/workspace/sheets/api/scopes)
- [spreadsheets.create](https://developers.google.com/sheets/api/reference/rest/v4/spreadsheets/create)
- [spreadsheets.values.append](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/append)
- [Drive API scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)
- [Brand verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification)
- [Sensitive scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification)
- [OAuth 2.0 и PKCE (установленные приложения)](https://developers.google.com/accounts/docs/OAuth2InstalledApp)
