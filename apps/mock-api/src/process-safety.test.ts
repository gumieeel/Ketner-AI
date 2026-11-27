import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  errorCode,
  installProcessSafetyNet,
  isTransientConnectionError,
} from './process-safety.js';

const withCode = (code: string, message = 'boom') => Object.assign(new Error(message), { code });

function harness() {
  const proc = new EventEmitter();
  const exits: number[] = [];
  const logs: string[] = [];
  const uninstall = installProcessSafetyNet({
    proc,
    exit: (code) => exits.push(code),
    log: (message) => logs.push(message),
  });
  return { proc, exits, logs, uninstall };
}

test('временные ошибки соединения: коды Postgres, Node и postgres.js', () => {
  for (const code of [
    '57P01',
    '57P02',
    '57P03',
    '08000',
    '08003',
    '08006',
    'ECONNRESET',
    'ECONNREFUSED',
    'ETIMEDOUT',
    'CONNECTION_ENDED',
    'CONNECTION_CLOSED',
    'CONNECTION_DESTROYED',
  ]) {
    assert.equal(isTransientConnectionError(withCode(code)), true, code);
  }
  for (const value of [withCode('23505'), withCode('42P01'), new Error('x'), 'text', null, 57]) {
    assert.equal(isTransientConnectionError(value), false, String(value));
  }
  assert.equal(errorCode({ errno: 'ECONNRESET' }), 'ECONNRESET');
  assert.equal(errorCode({ errno: -104 }), null);
});

test('отказ с кодом 57P01 не завершает процесс: запись в лог с кодом', () => {
  const { proc, exits, logs, uninstall } = harness();
  proc.emit(
    'unhandledRejection',
    withCode('57P01', 'terminating connection due to administrator command'),
  );
  assert.deepEqual(exits, []);
  assert.match(logs[0] ?? '', /код 57P01/);
  assert.match(logs[0] ?? '', /работа продолжается/);
  uninstall();
  assert.equal(proc.listenerCount('unhandledRejection'), 0);
  assert.equal(proc.listenerCount('uncaughtException'), 0);
});

test('неизвестная ошибка и необработанное исключение по-прежнему завершают процесс с кодом 1', () => {
  const { proc, exits, logs, uninstall } = harness();
  proc.emit('unhandledRejection', withCode('23505', 'duplicate key'));
  proc.emit('unhandledRejection', new TypeError('x is undefined'));
  proc.emit('uncaughtException', withCode('57P01'));
  assert.deepEqual(exits, [1, 1, 1]);
  assert.match(logs[0] ?? '', /код 23505/);
  assert.match(logs[1] ?? '', /код нет/);
  assert.match(logs[2] ?? '', /исключение/);
  uninstall();
});

// Настоящий процесс Node: страховка с настоящим process.exit, отказ без обработчика.
const moduleUrl = new URL('./process-safety.ts', import.meta.url).href;
function runChild(reject: string): { status: number | null; stderr: string; stdout: string } {
  const script = `
    const { installProcessSafetyNet } = await import(${JSON.stringify(moduleUrl)});
    installProcessSafetyNet();
    Promise.reject(${reject});
    setTimeout(() => { console.log('alive'); process.exit(0); }, 200);
  `;
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', '--input-type=module', '-e', script],
    { cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8', timeout: 30_000 },
  );
  return { status: result.status, stderr: result.stderr, stdout: result.stdout };
}

test('процесс Node: отказ 57P01 без обработчика — процесс жив; неизвестный — выход с кодом 1', () => {
  const transient = runChild(
    `Object.assign(new Error('terminating connection due to administrator command'), { code: '57P01' })`,
  );
  assert.equal(transient.status, 0, transient.stderr);
  assert.match(transient.stdout, /alive/);
  assert.match(transient.stderr, /код 57P01/);

  const unknown = runChild(`new Error('something else')`);
  assert.equal(unknown.status, 1, unknown.stderr);
  assert.doesNotMatch(unknown.stdout, /alive/);
  assert.match(unknown.stderr, /процесс завершается/);
});
