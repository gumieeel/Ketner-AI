import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { openTestSql } from '../testing/sql.js';
import { runMigrations } from './migrate.js';
import { MIGRATIONS } from './migration-list.js';

// Этап F (docs/STAGE_F_SHEETS.md): запись 0016 — дословно текст, проверенный на ревью
// (docs/stage-f/0016_google_sheets.proposal.sql, начиная с раздела «1. Подключение Google»).
const proposal = readFileSync(
  new URL('../../../../docs/stage-f/0016_google_sheets.proposal.sql', import.meta.url),
  'utf8',
);
const MARKER = '-- 1. Подключение Google одного аккаунта Ketner';

function reviewedBody(): string {
  return proposal.slice(proposal.indexOf(MARKER)).replace(/\n+$/, '');
}

test('0016: последняя запись, текст после заголовка дословно совпадает с проверенным на ревью', () => {
  const last = MIGRATIONS.at(-1)!;
  assert.equal(last.id, '0016_google_sheets');
  assert.ok(proposal.includes(MARKER));
  const body = last.sql.slice(last.sql.indexOf(MARKER)).replace(/\n+$/, '');
  assert.equal(body, reviewedBody());
  // String.raw: обратные косые черты регулярного выражения формы токена не потерялись.
  assert.ok(last.sql.includes(String.raw`'^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'`));
});

test('0016 в Postgres: подключение и доставка — что принимается и что отвергается', async (t) => {
  const sql = await openTestSql();
  if (!sql) {
    t.skip('нет PGlite и TEST_DATABASE_URL');
    return;
  }
  t.after(() => sql.close());
  await runMigrations(sql.db, MIGRATIONS);
  const q = (text: string, params: unknown[] = []) => sql.runner.query(text, params);
  const rejects = async (label: string, text: string) => {
    await assert.rejects(() => q(text), /violates|duplicate key|is not allowed/, label);
  };

  await q(`INSERT INTO solutions (id, user_id, type, status, name, current_version, active_version, template)
           VALUES ('sol-f', 'u-f', 'customer_bot', 'active', 'Бот', 1, 1, 'customer_bot')`);
  const execution = (values: string) =>
    `INSERT INTO executions (id, user_id, solution_id, kind, runtime, trigger_kind, trigger_ref, status, trace_id, idempotency_key)
     VALUES ${values}`;

  // Доставка заявки и обычное исполнение агента принимаются.
  await q(
    execution(
      `('delivery:l1', 'u-f', 'sol-f', 'delivery', NULL, 'lead_created', 'lead:l1', 'running', 't1', 'sheet:l1')`,
    ),
  );
  await q(
    execution(
      `('agent-1', 'u-f', 'sol-f', 'agent', 'agent_gateway', 'public_page', 'conversation:c1', 'running', 't2', NULL)`,
    ),
  );
  await rejects(
    'тот же ключ sheet:<leadId>',
    execution(
      `('delivery:l1b', 'u-f', 'sol-f', 'delivery', NULL, 'lead_created', 'lead:l1', 'running', 't3', 'sheet:l1')`,
    ),
  );
  await rejects(
    'доставка со средой агента',
    execution(
      `('delivery:l2', 'u-f', 'sol-f', 'delivery', 'agent_gateway', 'lead_created', 'lead:l2', 'running', 't4', NULL)`,
    ),
  );
  await rejects(
    'агент с lead_created',
    execution(
      `('agent-2', 'u-f', 'sol-f', 'agent', 'agent_gateway', 'lead_created', 'lead:l3', 'running', 't5', NULL)`,
    ),
  );
  await rejects(
    'доставка не по заявке',
    execution(
      `('delivery:l4', 'u-f', 'sol-f', 'delivery', NULL, 'lead_created', 'conversation:c4', 'running', 't6', NULL)`,
    ),
  );
  await rejects(
    'доставка с другим триггером',
    execution(
      `('delivery:l5', 'u-f', 'sol-f', 'delivery', NULL, 'public_page', 'lead:l5', 'running', 't7', NULL)`,
    ),
  );

  // Эффект доставки: неясный исход без идемпотентности провайдера вслепую не повторяется.
  await q(`INSERT INTO execution_effects (execution_id, user_id, step_key, action, external, status, authorized_by, lease_expires_at)
           VALUES ('delivery:l1', 'u-f', 'sheet_append', 'sheet.append_row', true, 'reserved', 'risk_low', now() + interval '2 minutes')`);
  await q(
    `UPDATE execution_effects SET status = 'dispatched', dispatched_at = now() WHERE execution_id = 'delivery:l1'`,
  );
  await q(
    `UPDATE execution_effects SET status = 'unknown', finished_at = now() WHERE execution_id = 'delivery:l1'`,
  );
  await rejects(
    'unknown → reserved без идемпотентности провайдера',
    `UPDATE execution_effects SET status = 'reserved', attempts = 2, lease_expires_at = now() + interval '2 minutes'
     WHERE execution_id = 'delivery:l1'`,
  );
  await q(
    `UPDATE execution_effects SET status = 'committed', resolved_by = 'reconcile:sheet_id_column' WHERE execution_id = 'delivery:l1'`,
  );

  // Подключение Google: только зашифрованный токен, обязательно drive.file, код ошибки без текста.
  const connection = (values: string) =>
    `INSERT INTO google_connections (user_id, google_sub, scopes, refresh_token_enc, status, last_error_code) VALUES ${values}`;
  const scopes = `'openid email https://www.googleapis.com/auth/drive.file'`;
  await q(connection(`('u-f', 'sub-1', ${scopes}, 'v1.aaa.bbb.ccc', 'connected', NULL)`));
  await rejects(
    'открытый токен',
    connection(`('u-2', 's', ${scopes}, '1//0gPlainToken', 'connected', NULL)`),
  );
  await rejects(
    'без drive.file',
    connection(`('u-3', 's', 'openid email', 'v1.a.b.c', 'connected', NULL)`),
  );
  await rejects(
    'подключено без токена',
    connection(`('u-4', 's', ${scopes}, NULL, 'connected', NULL)`),
  );
  await rejects(
    'отключено с токеном',
    connection(`('u-5', 's', ${scopes}, 'v1.a.b.c', 'disconnected', NULL)`),
  );
  await rejects(
    'текст вместо кода ошибки',
    connection(
      `('u-6', 's', ${scopes}, 'v1.a.b.c', 'connected', 'Request had invalid authentication')`,
    ),
  );
  await q(
    `UPDATE google_connections SET status = 'disconnected', refresh_token_enc = NULL WHERE user_id = 'u-f'`,
  );

  // Только сервер: RLS включён.
  const [rls] = await q(
    `SELECT relrowsecurity FROM pg_class WHERE oid = 'google_connections'::regclass`,
  );
  assert.equal((rls as { relrowsecurity: boolean }).relrowsecurity, true);
  // Роли API Supabase (если они есть в этой базе) прав на таблицу не получают.
  const roles = await q(`SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated')`);
  for (const { rolname } of roles as Array<{ rolname: string }>) {
    for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
      const [row] = await q(`SELECT has_table_privilege($1, 'google_connections', $2) AS allowed`, [
        rolname,
        privilege,
      ]);
      assert.equal((row as { allowed: boolean }).allowed, false, `${rolname}: ${privilege}`);
    }
  }
});
