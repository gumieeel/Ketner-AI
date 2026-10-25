# Модель данных

Сущности описаны так, чтобы mock-хранилище и будущая реальная база данных совпадали по форме. Типы — целевые: на этапе 1 часть полей ещё не используется.

Общие правила:

- `id` — строка UUID v4.
- Все даты — ISO 8601 в UTC (`2026-09-22T16:41:57.000Z`).
- `Message.role` — только `user` или `assistant`.
- Порядок сообщений задаёт история из запроса, а не сортировка по `createdAt`: часы клиента и сервера расходятся, и сортировка ломала бы ленту после правки. `createdAt` нужен только для отображения.
- Удаление диалога каскадно удаляет его сообщения.

## User

```ts
interface User {
  id: string;
  email: string;
  name: string;
  plan: 'free' | 'plus' | 'pro';
  createdAt: string;
}
```

Хранится: mock-API (в памяти или SQLite) + профиль в `localStorage` для мгновенной отрисовки. Пароль в открытом виде не хранится даже в заглушке: на этапе 3 сохраняется только его хеш (или запись делегируется реальной auth-системе).

## Conversation

```ts
interface Conversation {
  id: string;
  userId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}
```

`title` формируется из первого сообщения пользователя, обрезается до 60 символов. `updatedAt` меняется при добавлении сообщения и используется для сортировки списка.

## Message

```ts
type MessageRole = 'user' | 'assistant';
type MessageStatus = 'pending' | 'streaming' | 'complete' | 'error';

interface Message {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  createdAt: string;
  status: MessageStatus;
  modelId?: string;
}
```

`status` нужен интерфейсу: во время стриминга сообщение существует в состоянии `streaming`, при остановке генерации или ошибке — `error`. На бэкенде сохраняется только итоговый вариант (`complete`).

`id` сообщения пользователя приходит с клиента: так правка и повторная генерация не создают дублей. Ответ ассистента сохраняется с тем `id`, который сервер вернул в событии `done` — интерфейс заменяет им локальный идентификатор.

Запрос `POST /api/chat/completions` передаёт историю целиком, и сервер заменяет ею сохранённую. Это опорный контракт этапа 2: остановка генерации сохраняет частичный ответ, правка переписывает контекст, повторная генерация просто присылает ту же историю ещё раз.

## Subscription

```ts
type SubscriptionStatus = 'active' | 'trialing' | 'past_due' | 'canceled';

interface Subscription {
  userId: string;
  plan: 'free' | 'plus' | 'pro';
  status: SubscriptionStatus;
  renewsAt: string | null;
}
```

Даже в заглушке статусы совпадают с тем, что отдают платёжные системы (см. `payment-integration-todo.md`), чтобы после подключения реальной оплаты не переписывать интерфейс.

## Plan

```ts
interface Plan {
  id: 'free' | 'plus' | 'pro';
  nameKey: string;
  priceMonthly: number;
  popular?: boolean;
  bullets: Record<'ru' | 'en', string[]>;
}
```

Сейчас — статический каталог `apps/web/src/features/billing/plans.ts`. На этапе 4 переезжает в `GET /api/plans` без изменения формы.

## Session

```ts
interface Session {
  token: string;
  userId: string;
  expiresAt: string;
}
```

На этапе 1 не используется. На этапе 3 появится мок-JWT: три части, где подпись — фиктивная строка, а payload содержит `sub`, `email`, `plan`, `iat`, `exp`. Структура payload сохраняется при переходе на реальный провайдер.

## Где что хранится

| Данные               | Этап 1         | Этап 2-3                                                                              | Продакшн                      |
| -------------------- | -------------- | ------------------------------------------------------------------------------------- | ----------------------------- |
| Пользователи         | —              | `localStorage` + память mock-API                                                      | Postgres / Supabase Auth      |
| Диалоги и сообщения  | —              | JSON-файл mock-API (`apps/mock-api/data/store.json`); в браузере — состояние в памяти | Postgres                      |
| Настройки интерфейса | `localStorage` | `localStorage`                                                                        | `localStorage` + профиль      |
| Подписка             | `localStorage` | `localStorage` + память mock-API                                                      | Платёжный провайдер + вебхуки |

Ключи в `localStorage` имеют префикс `ketner.` и не смешиваются с чужими данными: `ketner.theme`, `ketner.language`, далее `ketner.conversations`, `ketner.session`.

## Соответствие эндпоинтам

| Сущность     | Эндпоинты                                                                                                            |
| ------------ | -------------------------------------------------------------------------------------------------------------------- |
| Conversation | `GET /api/conversations`, `POST /api/conversations`, `PATCH /api/conversations/:id`, `DELETE /api/conversations/:id` |
| Message      | `GET /api/conversations/:id`, `POST /api/chat/completions` (SSE)                                                     |
| User         | `POST /api/auth/signup`, `POST /api/auth/login`, `GET /api/auth/me`                                                  |
| Plan         | `GET /api/plans`                                                                                                     |
| Subscription | `POST /api/billing/checkout`, `GET /api/billing/subscription`, `POST /api/billing/cancel`                            |

Актуальный список с пометками готовности отдаёт сам сервис: `GET /api`.
