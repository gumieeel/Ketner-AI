# Модель данных

Сервер держит данные в памяти, пишет их в файлы `apps/mock-api/data/` и зеркалирует в Postgres (см. [architecture.md](architecture.md#хранение-данных-память--postgres)). Типы — `apps/mock-api/src/types.ts`; схема для справки — `db/schema.ts`; настоящие `CREATE TABLE` — `db/sync.ts`, `code/postgres-driver.ts`, `images/image-store.ts`.

Общие правила: `id` — строка (обычно UUID), даты — ISO 8601 в UTC, роли сообщений — `user` и `assistant`, удаление диалога удаляет его сообщения.

## Основные сущности

```ts
type PlanId = 'free' | 'plus' | 'pro' | 'ultra' | 'gpt-pro' | 'claude-pro' | 'gemini-pro'; // три последних — старые, приравнены к Pro

interface User {
  id: string;
  email: string; // у старых Telegram-аккаунтов служебный tg-<id>@telegram.invalid
  name: string;
  plan: PlanId; // источник правды о тарифе; срок проверяется по подписке
  createdAt: string;
  isVip?: boolean; // тариф Ultra без оплаты
  isAdmin?: boolean;
  telegramChatId?: number | string;
  telegramUsername?: string;
}
// В хранилище также: salt и passwordHash (scrypt), signupMethod и signupAttribution (источник регистрации).

interface Subscription {
  userId: string;
  plan: PlanId;
  status: 'active' | 'trialing' | 'past_due' | 'canceled';
  renewsAt: string | null; // конец оплаченного периода; после него + 24 ч льготы тариф сводится к free
}

interface Conversation {
  id: string;
  userId: string; // id аккаунта или подписанный гостевой guest_…
  title: string;
  createdAt: string;
  updatedAt: string;
  contextSummary?: string; // сводка старой истории для окна контекста
}

interface Message {
  id: string; // id сообщения пользователя приходит с клиента — правка и перегенерация не плодят дубли
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  status: 'pending' | 'streaming' | 'complete' | 'error';
  modelId?: string; // модель, которая реально ответила
  attachments?: MessageAttachment[];
  workspaceContext?: WorkspaceContext; // привязанный репозиторий или проект
  finishReason?: 'stop' | 'length' | 'cancelled' | 'error';
  canContinue?: boolean; // кнопка «Продолжить»
  feedback?: 'like' | 'dislike';
}
```

Порядок сообщений задаёт история из запроса: `POST /api/chat/completions` присылает её целиком, и сервер заменяет ею сохранённую. На этом держатся правка, перегенерация и сохранение частичного ответа при остановке.

Права тарифа (лимиты, бюджеты, квоты) не хранятся у пользователя: они вычисляются из `plan` (`services/entitlement.ts`) с учётом бонуса за оплату криптой и купленных пакетов.

## Таблицы Postgres

| Таблица                                      | Что хранит                                                                                                                                                                                                                                                     |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `user`, `session`, `account`, `verification` | Better Auth: вход через Google и GitHub, cookie-сессии                                                                                                                                                                                                         |
| `ketner_users`                               | Аккаунты сайта: тариф, хеш пароля, VIP, админ, Telegram, способ и источник регистрации                                                                                                                                                                         |
| `conversations`, `messages`                  | Диалоги и сообщения                                                                                                                                                                                                                                            |
| `subscriptions`                              | Текущая подписка и срок                                                                                                                                                                                                                                        |
| `feedbacks`                                  | Лайки и дизлайки ответов                                                                                                                                                                                                                                       |
| `api_keys`                                   | Ключи `/v1`: только SHA-256 и префикс                                                                                                                                                                                                                          |
| `revoked_tokens`                             | Bearer-токены, отозванные при выходе (SHA-256 и срок)                                                                                                                                                                                                          |
| `github_connections`                         | Токены GitHub, зашифрованные AES-256-GCM                                                                                                                                                                                                                       |
| `crypto_invoices`                            | Счета Trybit                                                                                                                                                                                                                                                   |
| `ketner_docs`                                | Документы по пространствам: `payments` (журнал платежей), `stars_subscriptions`, `notification_prefs`, `premium_credits` (кредиты пакетов), `usage` (учёт расхода — от него считаются бюджеты и лимиты), `contact_messages`, `support_tickets`, `support_meta` |
| `code_projects`, `code_project_files`        | Проекты Ketner Code (рабочая копия на диске поднимается отсюда)                                                                                                                                                                                                |
| `generated_images`                           | Картинки (байты в `bytea`), не больше 300 на пользователя                                                                                                                                                                                                      |
| `usage_metrics`                              | Создаётся, но не используется: учёт живёт в `ketner_docs` (`usage`)                                                                                                                                                                                            |

Таблицы и новые колонки создаются при старте сервера. Отдельных миграций нет: `db/migrations/0000_init.sql` и `drizzle-kit` остались от первого этапа и не отражают текущую схему.

## Что не переживает деплой

На Render диск стирается при каждом деплое, поэтому эти данные теряются:

| Данные                                              | Где                        | Последствие                                                                                                              |
| --------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Неоплаченные счета Stars и СБП                      | `data/invoices.json`       | Ссылка на счёт, выставленный до деплоя, не найдёт его; оплата звёздами всё равно проходит — данные лежат в самом платеже |
| Семантический кэш ответов                           | `data/semantic-cache.json` | Кэш начинается заново                                                                                                    |
| Счётчики лимитов частоты (вход, регистрация, гости) | память                     | Сбрасываются                                                                                                             |
| Запросы входа через Telegram и коды привязки        | память                     | Начатый вход или привязку нужно повторить                                                                                |
| Рабочие копии проектов Ketner Code                  | `data/projects`            | Поднимаются из Postgres при первом открытии                                                                              |

Без `DATABASE_URL` (локально) всё хранится только в файлах `data/*.json`.

## Браузер

Ключи `localStorage` с префиксом `ketner.`: `session` и `user` (вход), `theme`, `language`, выбранная модель и состояние сайдбара. Ключ администратора панели — `ketner_admin_key`. Cookie `ketner_src` (90 дней) — источник посетителя для учёта регистраций.
