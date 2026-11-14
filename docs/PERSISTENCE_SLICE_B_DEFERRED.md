# Отложенные срезы хранения

Составлено 12.11.2026. В первую веху (Slice A, [PERSISTENCE_SLICE_A.sql](PERSISTENCE_SLICE_A.sql)) не входят. SQL — в полном варианте [PERSISTENCE_MIGRATIONS_PROPOSAL.sql](PERSISTENCE_MIGRATIONS_PROPOSAL.sql); перед применением каждый срез оформляется отдельным файлом и проверяется стендом так же, как Slice A.

## Срез разрешений

| Таблица                | Когда нужна                                                                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `authorization_grants` | Первое действие агента, которое требует заранее выданного разрешения владельца сверх включения бота (например, `message.send` по каналу клиента) |
| `approval_requests`    | Первое действие, которому нужно одобрение каждого раза (риск HIGH или «одобрять всегда»)                                                         |
| `authorization_events` | Вместе с двумя таблицами выше                                                                                                                    |

Изменения Slice A в этом срезе:

- колонки `grant_id` и `approval_request_id` в `executions` и `execution_effects` (`ALTER TABLE ADD COLUMN`) с внешними ключами;
- статус `waiting_approval`;
- проверка `authorized_by` расширяется на `grant:<id>` и `approval:<id>`;
- неизменяемость ссылок на разрешение в `execution_effects_guard`.

## Slice B — процессы и подключения (n8n)

Откладывается до ответа n8n о лицензии ([LICENSE_INQUIRIES.md](LICENSE_INQUIRIES.md), пункты 2, 4, 7) и первого настоящего процесса.

| Таблица                        | Что хранит                                                                       |
| ------------------------------ | -------------------------------------------------------------------------------- |
| `integration_connections`      | Подключения клиентов: провайдер, вид авторизации, ссылка на учётные данные в n8n |
| `workflow_templates`           | Шаблоны процессов команды Ketner                                                 |
| `workflow_template_artifacts`  | Артефакты шаблона (JSON процесса n8n)                                            |
| `workflow_definitions`         | Процессы решения клиента                                                         |
| `workflow_definition_versions` | Версии процесса                                                                  |
| `workflow_connection_bindings` | Какое подключение клиента в каком слоте процесса                                 |
| `provider_workflows`           | Процесс у исполнителя (n8n): id, вебхук, версия                                  |

Изменения Slice A в этом срезе:

- `executions.kind` расширяется на `workflow`;
- колонки `workflow_definition_id`, `workflow_definition_version`, `provider`, `provider_execution_id` с ограничениями и индексами.

Проверка секретов на JSON процессов и определениях **не ставится**: там свободный текст и имена полей (как у спецификаций, [PERSISTENCE_DESIGN.md](PERSISTENCE_DESIGN.md), 9.3).
