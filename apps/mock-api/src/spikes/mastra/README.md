# Спайк Mastra (T4.0)

Ветка `claude/mastra-spike`, в `main` не сливается, к маршрутам не подключено.
Отчёт с цифрами и рекомендацией — `docs/MASTRA_SPIKE.md` в ветке `claude/great-euler-rppwsj`.

| Файл | Что это |
| --- | --- |
| `gateway-step.ts` | Один шаг агента через существующий AIGateway (запрос бота + `agentStep` с инструментами) |
| `ketner-language-model.ts` | Модель для Mastra (LanguageModelV2) поверх `gateway-step.ts` |
| `mastra-agent.ts` | Бот для клиентов (AgentSpec) как агент Mastra, `maxRetries: 0` |
| `own-loop.ts` | Для сравнения: собственный цикл поверх того же шага |
| `bot-tools.ts` | Инструмент `knowledge.search` с проверкой прав (общий для обоих вариантов) |
| `mastra-spike.test.ts` | 5 тестов: прежний путь против Mastra и своего цикла, запасные модели, права, повторы |
| `trace-modules.mjs` | Запись всех загруженных модулей (проверка `ee/` и телеметрии) |

Изменение шлюза: `ai/gateway.ts`, `ai/gateway-types.ts` — необязательный `agentStep` (вызов
`streamAgent` с инструментами внутри обычного пути: выбор модели, запасные, цена, учёт, списание).
