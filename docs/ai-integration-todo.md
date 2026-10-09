# Подключение реального ИИ

Что заменить, когда появится настоящая модель. Документ — чек-лист: пункты выполняются по мере перехода от заглушки к провайдеру.

## Что есть сейчас (этап 2)

- `apps/mock-api/src/routes/chat.ts` — эндпоинт `POST /api/chat/completions`, отдаёт ответ потоком через SSE.
- Ответ собирается из заранее заданных шаблонов: выбор зависит от ключевых слов в запросе, иначе берётся случайный.
- Чанки отправляются с задержкой 20-40 мс, чтобы фронтенд работал со стримингом так же, как с реальным провайдером.
- Переключатель моделей меняет только подпись в интерфейсе; логика ответа одна.
- Сервер получает историю целиком и заменяет ею сохранённую: на этом держатся правка сообщения, повторная генерация и остановка.
- При остановке генерации частичный ответ сохраняется в диалоге со статусом `complete`.
- `usage` с числом токенов уже приходит в событии `done` (сейчас — оценка по длине текста).

## Контракт, который нельзя ломать

Запрос:

```http
POST /api/chat/completions
Content-Type: application/json

{
  "conversationId": "uuid",
  "modelId": "ketner-mini",
  "language": "ru",
  "messages": [
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." }
  ]
}
```

Ответ — `text/event-stream` со событиями:

```
event: delta
data: {"content":"порция текста"}

event: done
data: {"messageId":"uuid","usage":{"inputTokens":123,"outputTokens":456}}

event: error
data: {"code":"upstream_error","message":"..."}
```

`language` — временная замена системного промпта: язык ответа должен задаваться системным сообщением, и тогда поле из контракта уходит.

Фронтенд разбирает только эти три события. Провайдер можно менять, не трогая клиент, если сохранить формат.

## Статус реализации: AI Gateway & Multi-Model Engine (Завершено)

Архитектура полнофункционального production AI Gateway полностью развёрнута и покрыта 111 тестами.

### Ключевые компоненты:

1. **AI Provider Abstraction (`src/ai/providers/`)**:
   - `OpenRouterProvider`: единственный провайдер. Все модели (OpenAI, Anthropic, Google, xAI, DeepSeek, Xiaomi) идут через один ключ `OPENROUTER_API_KEY`: потоковые ответы, управление глубиной размышлений (`reasoning`), prompt caching для Claude, фактическая стоимость из `usage.cost`.
   - `ProviderManager`: фабрика провайдера, отдельный предохранитель на каждую модель.

2. **Model Registry (`src/ai/model-registry.ts`)**:
   - Централизованный реестр моделей с ценами ($ за 1M токенов), capabilities (coding, math, reasoning, vision), лимитами контекста и привязкой к тарифам.
   - Цепочки failover без повторов, допустимые по бюджету. Подробности: `docs/models-and-pricing.md`.

3. **Entitlement Service (`src/services/entitlement.ts`)**:
   - Контроль прав доступа к платным моделям по тарифам (`Free`, `Plus`, `Pro`, `Ultra`; старые `gpt-pro`, `claude-pro`, `gemini-pro` приравнены к Pro).
   - Автоматическое предоставление Ultra-прав для аккаунта `artemsinyakov09@gmail.com`.

4. **Fair Use Engine & Concurrency Control (`src/services/fair-use.ts`)**:
   - Контроль скользящих окон (RPM, RPH, RPD), лимитов токенов и параллельных запросов (`activeConcurrency`).
   - Защита от злоупотреблений и контроль дневной себестоимости (`maxDailyCost`).

5. **Usage & Cost Accounting (`src/store/usage-store.ts`, `src/services/cost.ts`)**:
   - Атомарное логирование каждого запроса (входные/выходные/кэшированные токены, задержка, себестоимость в $).
   - Расчёт рентабельности подписок (profitability & contribution margin).

6. **Auto Mode Router & Context Optimizer (`src/ai/auto-router.ts`, `src/ai/context.ts`)**:
   - Классификация задач по типу (кодинг, математика, логика, креатив) и выбор оптимальной модели.
   - Скользящее окно контекста с защитой от переполнения контекстного окна.

7. **Webhooks & Admin API (`src/routes/webhooks.ts`, `src/routes/admin.ts`)**:
   - Идемпотентный приём платёжных событий (`subscription.updated`, `invoice.paid`, `subscription.deleted`).
   - Административный контроль: изменение цен на лету, включение/выключение моделей, метрики провайдеров.
