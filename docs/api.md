# API сайта (`/api/*`)

Этот API обслуживает сайт и мини-приложение. Для программ и IDE есть отдельный OpenAI-совместимый `/v1` — [agent-api.md](agent-api.md).

## Общее

- **Авторизация:** `Authorization: Bearer <токен входа>` или cookie Better Auth (вход через Google и GitHub). Гость передаёт `X-Guest-Id: guest_…`.
- **Ошибки:** `{ "error": { "code": "…", "message": "…" } }` с HTTP-статусом. Частые коды: `401 unauthorized`, `403 upgrade_required`, `403 admin_access_denied`, `404 not_found`, `429 too_many_requests` / `rate_limited` (с `Retry-After`).
- **Тело** — JSON до 1 МБ (до 50 МБ у вложений и импорта).
- `GET /api` вне production отдаёт список эндпоинтов; `GET /api/health` — проверка живости для Render.

## Чат (SSE)

`POST /api/chat/completions`

```json
{
  "conversationId": "uuid",
  "modelId": "auto",
  "language": "ru",
  "reasoningMode": "standard",
  "messages": [
    { "id": "uuid", "role": "user", "content": "…", "attachments": [], "workspaceContext": null }
  ]
}
```

`messages` — вся история: сервер заменяет ею сохранённую (так работают правка, перегенерация и остановка). `reasoningMode: "max"` действует только на Ultra.

Ответ — `text/event-stream`:

```
event: delta
data: {"content":"порция текста"}

event: done
data: {"messageId":"uuid","selectedModel":{"id":"glm-5.3","name":"GLM-5.3"},"routingReason":"…","source":"…",
       "finishReason":"stop","canContinue":false,"reasoningMode":"standard","usage":{"inputTokens":123,"outputTokens":456}}

event: error
data: {"code":"upgrade_required","message":"…"}
```

`selectedModel` — модель, которая реально ответила; `routingReason` — почему (Auto, лимит, квота, бюджет). Интерфейс обязан показывать её пользователю.

Также: `POST /api/chat/feedback` (`messageId`, `rating: like|dislike`, `reason`, `comment`), `GET /api/chat/feedback/analytics` (админ).

## Эндпоинты

| Группа          | Эндпоинты                                                                                                                                                                                                                                                                                                                                                              | Доступ             |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| Служебные       | `GET /health`, `GET /meta` (каталог моделей, лимиты, тарифы), `GET /plans`                                                                                                                                                                                                                                                                                             | все                |
| Аккаунт         | `POST /auth/signup`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`, `GET /auth/telegram-link`, `POST /auth/telegram-unlink`                                                                                                                                                                                                                                  | вход для `me`      |
| Вход Telegram   | `POST /auth/telegram/start`, `GET /auth/telegram/poll/:id`, `POST /auth/telegram/claim`, `POST /auth/telegram/magic`                                                                                                                                                                                                                                                   | все / вход         |
| Better Auth     | `GET /auth/get-session`, `POST /auth/sign-in/email`, `POST /auth/sign-in/social`, `POST /auth/sign-out`, `/auth/callback/*`, сессии — остальное закрыто                                                                                                                                                                                                                | все                |
| Диалоги         | `GET/POST /conversations`, `GET/PATCH/DELETE /conversations/:id`                                                                                                                                                                                                                                                                                                       | вход или гость     |
| Расход          | `GET /usage/quota` — остаток лимитов модели, бюджета и квоты                                                                                                                                                                                                                                                                                                           | вход               |
| Оплата          | `GET /billing/subscription`, `GET /billing/packs`, `GET /billing/crypto-bonus`, `POST /billing/crypto/create-invoice`, `GET /billing/crypto/status/:id`, `POST /billing/crypto/confirm/:id`, `POST /billing/telegram-stars/create-invoice`, `GET /billing/telegram-stars/status/:id`, `POST /billing/cancel`                                                           | вход               |
| Вебхуки оплаты  | `POST /billing/trybit/webhook`, `POST /webhooks`, `POST /webhooks/stripe`, `POST /telegram/webhook`, `POST /telegram/support/webhook`                                                                                                                                                                                                                                  | подпись            |
| Без интерфейса  | `POST /billing/checkout`, `/billing/sbp/*`, `POST /billing/telegram-stars/confirm/:id`, `POST /billing/stripe/create-checkout`, `POST /telegram/simulate-payment`, `POST /telegram/support/simulate-message` — заглушки разработки и каналы, которых нет на странице оплаты (клиентские функции в `features/billing/api.ts` остались); в production заглушки отключены | —                  |
| Мини-приложение | `/telegram/miniapp/*`: `session`, `email-code`, `email-verify`, `link`, `link-code`, `state`, `invoice`, `auto-renew`, `payments/:id/refund`, `prefs`, `site-login`, `unlink`, `admin/refunds`                                                                                                                                                                         | подпись `initData` |
| Telegram        | `GET /telegram/status`, `GET /telegram/support/status`, `GET /telegram/support/tickets` (админ)                                                                                                                                                                                                                                                                        |                    |
| Ketner Code     | `/code/capabilities`, `/code/projects` (CRUD, `import-github`, `:id/files`, `:id/file`, `:id/move`, `:id/import`, `:id/export.zip`, `:id/thread`, `:id/run` — SSE, `:id/stop`)                                                                                                                                                                                         | вход               |
| Картинки        | `GET /images/capabilities`, `GET /images`, `POST /images/generate`, `DELETE /images/:id`, `GET /images/:id/file?exp&sig` (подписанная ссылка)                                                                                                                                                                                                                          | вход               |
| GitHub          | `GET /github/status`, `GET /github/connect-url`, `POST /github/confirm`, `DELETE /github/connection`, `ALL /github/api/*` (прокси с белым списком)                                                                                                                                                                                                                     | вход               |
| Ключи `/v1`     | `GET /keys`, `POST /keys`, `DELETE /keys/:id`                                                                                                                                                                                                                                                                                                                          | вход, Plus+        |
| Контакты        | `POST /contact`                                                                                                                                                                                                                                                                                                                                                        | все                |
| Админ           | `/admin/models` (+ `PATCH :id`), `/admin/providers`, `/admin/circuit-breaker` (+ `reset`), `/admin/usage`, `/admin/metrics`, `/admin/feedback-analytics`, `/admin/escalation/override`, `/admin/profitability/:userId`, `/admin/user-usage/:userId`, `/admin/exchange-rate`, `/admin/users` (+ `:id`, `PATCH :id`), `/admin/registrations`                             | админ              |

Все пути выше — относительно `/api`. Формат событий агента Ketner Code — [code-workspace.md](code-workspace.md#как-идёт-запуск).
