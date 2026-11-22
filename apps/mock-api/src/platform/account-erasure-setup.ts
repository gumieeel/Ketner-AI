/**
 * Все регистрации очистки при удалении аккаунта — в одном месте: так сервер и скрипт поддержки
 * (scripts/erase-account.ts) удаляют одно и то же. Новая возможность с данными аккаунта
 * добавляет сюда свою регистрацию и убирает свою строку из `UNREGISTERED_ACCOUNT_DATA`.
 */

import type { GoogleConnectionStore } from '../google/connection-store.js';
import { registerGoogleErasure } from '../google/erasure.js';
import type { GoogleVerifierStore } from '../google/verifier-store.js';
import type { GooglePrefsStore } from '../google/prefs.js';
import type { AccountErasure } from './account-erasure.js';

export interface AccountErasureDeps {
  google: {
    store: GoogleConnectionStore;
    verifiers?: GoogleVerifierStore;
    prefs?: GooglePrefsStore;
    fetchImpl?: typeof fetch;
    log?: (message: string) => void;
  };
}

export function registerAccountErasure(registry: AccountErasure, deps: AccountErasureDeps): void {
  registerGoogleErasure(registry, deps.google);
}

/**
 * Данные аккаунта, у которых очистки в реестре ещё нет (на 21.11.2026). Скрипт поддержки печатает
 * этот список: пока строка здесь, эти данные удаляются вручную.
 */
export const UNREGISTERED_ACCOUNT_DATA: ReadonlyArray<{ area: string; where: string }> = [
  {
    area: 'Аккаунт и вход',
    where:
      'ketner_users; Better Auth: user, session, account, verification; revoked_tokens; api_keys',
  },
  {
    area: 'Анализ задачи',
    where: 'discovery_analyses, discovery_opportunities, discovery_plans',
  },
  {
    area: 'Решения',
    where:
      'solutions (solution_versions удаляются каскадом), solution_version_specs, solution_test_cases, solution_test_runs, solution_threads, solution_messages, solution_materials, solution_runs, solution_attempts, implementation_requests; ketner_docs: widget_installs',
  },
  {
    area: 'Боты: диалоги и заявки',
    where: 'bot_conversations, bot_messages, bot_leads',
  },
  {
    area: 'Журнал исполнений',
    where: 'agent_deployments, executions, execution_events, execution_effects',
  },
  {
    area: 'Счётчики и тариф',
    where:
      'ketner_docs: cost_counters (обращения тарифа, бесплатный лимит, отметки уведомлений), account_tiers; usage_metrics; ketner_docs: usage',
  },
  {
    area: 'Подключение GitHub',
    where: 'github_connections (+ отзыв токена в GitHub)',
  },
  {
    area: 'Прежний чат, Code и картинки (закрыты)',
    where:
      'conversations, messages, feedbacks; code_projects, code_project_files; generated_images; ketner_docs: compare_votes',
  },
  {
    area: 'Оплата (хранить по закону — решение владельца, не удалять вслепую)',
    where:
      'subscriptions, crypto_invoices; ketner_docs: payments, stars_subscriptions, premium_credits, legacy_credits, low_credit_notices, notification_prefs',
  },
  {
    area: 'Поддержка и обратная связь',
    where: 'ketner_docs: support_tickets, support_meta, contact_messages',
  },
];
