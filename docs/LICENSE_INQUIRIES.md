# Запросы по лицензиям (T0.4)

Черновики писем для владельца. Отправлять от имени Ketner; ответы сохранить сюда же (дата, кто ответил, цитата) — от них зависит задача T6.10 в [TRANSFORMATION_TASKS.md](TRANSFORMATION_TASKS.md). Обоснование вопросов к n8n — [N8N_DEPLOYMENT.md](N8N_DEPLOYMENT.md), раздел 1; к Activepieces — [WORKFLOW_ENGINE_DECISION.md](WORKFLOW_ENGINE_DECISION.md), раздел 3.

## 1. n8n — license@n8n.io (отправить первым)

**Тема:** Sustainable Use License: confirming our use of self-hosted n8n as an internal workflow engine

> Hello,
>
> We are Ketner AI (ketner.org), a commercial SaaS for small businesses. Customers describe their business; our product analyses it, recommends automations and AI agents, and our team implements and maintains them. We plan to run self-hosted n8n Community Edition (no license key, no `.ee.` features) as an internal execution engine. n8n runs as a private service with no public address: only our backend calls it, our staff build workflows on a local instance and deploy them through our backend, and customers never see n8n, its UI, its API or its workflow logic.
>
> Based on your license FAQ we understand these uses are permitted. Could you please confirm each in writing?
>
> 1. Workflows for our own operations (notifications, reports), using our own credentials.
> 2. A catalogue of pre-built workflows designed, reviewed and deployed by our staff. Customers can only choose one, trigger it, connect their own accounts (OAuth or API keys) and provide input data (for example, which chat to notify). The workflow logic is identical for all customers and they cannot change it.
> 3. Bespoke workflows built manually by our staff for a specific customer as a paid implementation service, which the customer cannot edit.
>
> And please advise on these:
>
> 4. Our backend creating a separate copy of a fixed, staff-authored workflow for each customer, automatically and without an AI model, only to attach that customer's own credentials. The logic is never changed. Is this permitted under the Community License?
> 5. We understand that AI-generated or AI-modified workflow logic for a specific customer is not permitted under the Community License. If we later want our AI to design workflows for individual customers (always validated by our code against an allow-list of nodes and never edited by the customer), which commercial license covers it, and what are the price and terms?
> 6. We sell a monthly subscription for "automations". Its value is the business analysis, AI agents and our implementation and support; n8n is one internal component. Is this compatible with the Sustainable Use License, given the "Automation-as-a-service" example in your FAQ?
>
> Thank you,
> Ketner AI

## 2. Activepieces — sales@activepieces.com (не отправлять, пока n8n подходит)

**Тема:** Licensing question: Activepieces as an internal execution engine for a multi-tenant SaaS

> Hello,
>
> We are building Ketner AI (ketner.org), a commercial SaaS for small businesses. Our product designs and configures automations for each customer; customers never see or use the Activepieces UI. We are evaluating self-hosted Activepieces as an internal workflow and integration execution engine behind our own interface.
>
> Planned setup: one self-hosted instance operated only by our team; flows are created and published by our backend through a service user; each customer's connections (OAuth tokens or API keys for their own services) would be stored in Activepieces and used only by that customer's flows. We do not plan to embed the builder or offer white-labelled Activepieces.
>
> Could you please confirm in writing:
>
> 1. The root LICENSE places `packages/server/api/src/app/ee` under the Enterprise License, and the COMMUNITY edition registers `ee/projects/platform-project-module` at startup. Does running the official Community Edition image in production require an Enterprise subscription because of this?
> 2. Is the setup above (Community Edition, multi-tenant SaaS, our customers' credentials processed by our flows) permitted without an Enterprise agreement?
> 3. If we need the Enterprise edition (API keys, a project per customer, piece sets, audit logs): what is the price, and how are "user seats" counted when end customers never log in to Activepieces?
> 4. Do the Subscription Terms restrict reselling, offering the engine as part of our service, or processing end customers' credentials?
> 5. Are all pieces in `packages/pieces/community` under MIT, or do some carry other licenses?
>
> Thank you,
> Ketner AI

## 3. Mastra

Письмо не нужно: используется только код под Apache-2.0. Условие — не подключать модули из каталогов `ee/` (например, `@mastra/core/auth/ee`, `@mastra/editor/ee`). Проверить при спайке T4.0: после установки — `grep -r "/ee/" node_modules/@mastra --include=package.json` и импорты в коде Ketner.

## 4. Ответы

| Дата | Кому | Ответ | Что меняет |
| ---- | ---- | ----- | ---------- |
|      |      |       |            |
