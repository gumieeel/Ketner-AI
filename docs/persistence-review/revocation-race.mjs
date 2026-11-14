// Отзыв разрешения во время исполнения: два одновременных соединения к одноразовой базе.
// Запуск: node revocation-race.mjs <postgres-url> (после миграций, данных и предложения).
// Соединение A — исполнение (резерв шага + использование разрешения в одной транзакции),
// соединение B — владелец отзывает разрешение.
import postgres from '../../node_modules/postgres/src/index.js';

const url = process.argv[2];
const exec = postgres(url, { max: 1, onnotice: () => {} });
const owner = postgres(url, { max: 1, onnotice: () => {} });
const monitor = postgres(url, { max: 1, onnotice: () => {} });
const results = [];
const check = (name, ok, detail = '') =>
  results.push({ name, outcome: ok ? 'PASS' : 'FAIL', detail });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Шаг исполнения: резерв эффекта и атомарное использование разрешения. */
async function step(tx, stepKey, grantId) {
  const reserved = await tx`
    INSERT INTO execution_effects (execution_id, user_id, step_key, action, external, status, grant_id, authorized_by)
    VALUES ('race_run', 'user_r', ${stepKey}, 'message.send', true, 'reserved', ${grantId}, ${'grant:' + grantId})
    ON CONFLICT (execution_id, step_key) DO NOTHING RETURNING step_key`;
  if (reserved.length === 0) return 'already_done';
  const used = await tx`
    UPDATE authorization_grants SET uses_count = uses_count + 1
    WHERE id = ${grantId} AND user_id = 'user_r' AND revoked_at IS NULL
      AND (expires_at IS NULL OR expires_at > now()) AND (max_uses IS NULL OR uses_count < max_uses)
    RETURNING id`;
  if (used.length === 0) {
    await tx`UPDATE execution_effects SET status = 'denied', grant_id = NULL, finished_at = now()
             WHERE execution_id = 'race_run' AND step_key = ${stepKey}`;
    await tx`INSERT INTO authorization_events (id, user_id, subject_type, subject_id, event, actor, execution_id, data)
             VALUES (${'ev_denied_' + stepKey}, 'user_r', 'grant', ${grantId}, 'denied', 'system', 'race_run', '{"reason":"revoked_or_expired"}')`;
    await tx`UPDATE executions SET status = 'cancelled', finished_at = now(),
               error = jsonb_build_object('code', 'authorization_revoked', 'step', ${stepKey}::text)
             WHERE id = 'race_run' AND user_id = 'user_r'`;
    return 'denied';
  }
  // Фиксация «отправлено» до запроса провайдеру, затем итог.
  await tx`UPDATE execution_effects SET status = 'dispatched', dispatched_at = now()
           WHERE execution_id = 'race_run' AND step_key = ${stepKey}`;
  await tx`UPDATE execution_effects SET status = 'committed', finished_at = now(), result_ref = ${'msg:' + stepKey}
           WHERE execution_id = 'race_run' AND step_key = ${stepKey}`;
  return 'committed';
}

const revoke = (sql, grantId) =>
  sql.begin(async (tx) => {
    await tx`UPDATE authorization_grants SET revoked_at = now(), revoked_by = 'user_r', revoke_reason = 'owner'
           WHERE id = ${grantId} AND user_id = 'user_r' AND revoked_at IS NULL`;
    await tx`INSERT INTO authorization_events (id, user_id, subject_type, subject_id, event, actor)
           VALUES (${'ev_revoked_' + grantId}, 'user_r', 'grant', ${grantId}, 'revoked', 'user_r')`;
  });

try {
  await exec`INSERT INTO solutions (id, user_id, type, status, name, current_version, template)
             VALUES ('sol_r', 'user_r', 'customer_bot', 'active', 'R', 1, 'customer_bot')`;
  await exec`INSERT INTO solution_versions (solution_id, number, config) VALUES ('sol_r', 1, '{}')`;
  await exec`INSERT INTO authorization_grants (id, user_id, solution_id, action, max_risk, resource_scope, recipient_scope, source, granted_by)
             VALUES ('g_race', 'user_r', 'sol_r', 'message.send', 'medium', '{}', '{}', 'owner', 'user_r'),
                    ('g_race2', 'user_r', 'sol_r', 'message.send', 'medium', '{}', '{}', 'owner', 'user_r')`;
  await exec`INSERT INTO executions (id, user_id, solution_id, kind, trigger_kind, trigger_ref, status, trace_id)
             VALUES ('race_run', 'user_r', 'sol_r', 'agent', 'channel_event', 'chat:1', 'running', 't')`;

  // 1. Шаг 1 держит разрешение (транзакция открыта), владелец в это время отзывает.
  let revokeDoneAt = 0;
  let stepCommittedAt = 0;
  const step1 = exec.begin(async (tx) => {
    const outcome = await step(tx, 'send_1', 'g_race');
    await sleep(400); // внешнее действие выполняется
    stepCommittedAt = Date.now();
    return outcome;
  });
  await sleep(100);
  const revoking = revoke(owner, 'g_race').then(() => {
    revokeDoneAt = Date.now();
  });
  const outcome1 = await step1;
  await revoking;
  check(
    'step already authorized when revocation arrives completes',
    outcome1 === 'committed',
    outcome1,
  );
  check(
    'revocation waits for the in-flight step (row lock), no half state',
    revokeDoneAt >= stepCommittedAt,
    `revoke finished ${revokeDoneAt - stepCommittedAt} ms after step commit`,
  );

  // 2. Следующий шаг после отзыва: отказ, исполнение остановлено, отказ записан.
  const outcome2 = await exec.begin((tx) => step(tx, 'send_2', 'g_race'));
  check('next step after revocation is denied', outcome2 === 'denied', outcome2);
  const [run] =
    await exec`SELECT status, error->>'code' AS code FROM executions WHERE id = 'race_run'`;
  check(
    'execution stops as cancelled with reason',
    run.status === 'cancelled' && run.code === 'authorization_revoked',
    JSON.stringify(run),
  );
  const [grant] =
    await exec`SELECT uses_count, revoked_at IS NOT NULL AS revoked FROM authorization_grants WHERE id = 'g_race'`;
  check('grant used exactly once', grant.uses_count === 1 && grant.revoked, JSON.stringify(grant));
  const effects =
    await exec`SELECT step_key, status FROM execution_effects WHERE execution_id = 'race_run' ORDER BY step_key`;
  check(
    'effects: send_1 committed, send_2 denied',
    JSON.stringify(effects.map((e) => [e.step_key, e.status])) ===
      JSON.stringify([
        ['send_1', 'committed'],
        ['send_2', 'denied'],
      ]),
  );

  // 3. Обратный порядок: отзыв начат раньше (не зафиксирован), шаг ждёт и после фиксации отзыва получает отказ.
  await exec`UPDATE executions SET status = 'running', finished_at = NULL, error = NULL WHERE id = 'race_run'`;
  let release;
  const holding = owner.begin(async (tx) => {
    await tx`UPDATE authorization_grants SET revoked_at = now(), revoked_by = 'user_r', revoke_reason = 'owner' WHERE id = 'g_race2'`;
    await new Promise((resolve) => {
      release = resolve;
    });
  });
  await sleep(100);
  const step3 = exec.begin((tx) => step(tx, 'send_3', 'g_race2'));
  await sleep(300);
  const [waiting] =
    await monitor`SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND datname = current_database()`;
  check(
    'step waits while revocation is in progress',
    waiting.n >= 1,
    `waiting sessions: ${waiting.n}`,
  );
  release();
  await holding;
  const outcome3 = await step3;
  check('step after the revocation commits is denied (no window)', outcome3 === 'denied', outcome3);
} catch (error) {
  check('scenario ran without errors', false, String(error));
} finally {
  await exec.end();
  await owner.end();
  await monitor.end();
}

for (const r of results)
  console.log(`${r.outcome.padEnd(4)}  ${r.name}${r.detail ? `  (${r.detail})` : ''}`);
console.log(
  `passed=${results.filter((r) => r.outcome === 'PASS').length} failed=${results.filter((r) => r.outcome !== 'PASS').length}`,
);
process.exitCode = results.every((r) => r.outcome === 'PASS') ? 0 : 1;
