import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AccountErasure,
  accountErasure,
  eraseAccount,
  formatErasureReport,
  previewAccountErasure,
} from './account-erasure.js';
import { UNREGISTERED_ACCOUNT_DATA } from './account-erasure-setup.js';
import {
  createGoogleConnectionStore,
  type StoredGoogleConnection,
} from '../google/connection-store.js';
import { registerGoogleErasure } from '../google/erasure.js';
import { createGoogleVerifierStore } from '../google/verifier-store.js';
import { DRIVE_FILE, createFakeGoogle } from '../testing/fake-google.js';

test('реестр: сводка ничего не меняет, удаление проходит все шаги, сбой шага не останавливает остальные', async () => {
  const registry = new AccountErasure();
  const erased: string[] = [];
  registry.register({
    name: 'a',
    preview: () => [{ what: 'строки a', count: 2 }],
    erase: async (userId) => {
      erased.push(`a:${userId}`);
      return { items: [{ what: 'строки a', count: 2 }] };
    },
  });
  registry.register({
    name: 'broken',
    preview: () => {
      throw new Error('база недоступна');
    },
    erase: async () => {
      throw new Error('база недоступна');
    },
  });
  registry.register({
    name: 'c',
    preview: () => [{ what: 'строки c', count: 0 }],
    erase: async (userId) => {
      erased.push(`c:${userId}`);
      return { items: [{ what: 'строки c', count: 0 }], notes: ['заметка'] };
    },
  });
  assert.throws(() =>
    registry.register({ name: 'a', preview: () => [], erase: async () => ({ items: [] }) }),
  );
  assert.deepEqual(registry.registered(), ['a', 'broken', 'c']);

  const preview = await previewAccountErasure('u1', registry);
  assert.equal(preview.dryRun, true);
  assert.equal(preview.complete, false);
  assert.deepEqual(erased, [], 'сводка ничего не удаляет');
  assert.equal(preview.steps[1]!.error, 'база недоступна');

  const report = await eraseAccount('u1', registry);
  assert.equal(report.dryRun, false);
  assert.deepEqual(erased, ['a:u1', 'c:u1'], 'шаг после сбойного тоже выполнен');
  assert.equal(report.complete, false);
  assert.deepEqual(report.steps[2]!.notes, ['заметка']);

  const text = formatErasureReport(report);
  assert.match(text, /Удалено у аккаунта u1/);
  assert.match(text, /broken — ОШИБКА: база недоступна/);
  assert.match(formatErasureReport(preview), /Проверка \(ничего не удалено\)/);

  await assert.rejects(() => registry.preview(''), /некорректный id/);
  await assert.rejects(() => registry.erase('u1; DROP TABLE'), /некорректный id/);
});

test('процесс сервера: очистка Google зарегистрирована в общем реестре при загрузке хранилищ', async () => {
  await import('../store/index.js');
  assert.ok(accountErasure.registered().includes('google'));
  // Список того, что ещё не зарегистрировано, назван для поддержки и следующих PR.
  const areas = UNREGISTERED_ACCOUNT_DATA.map((item) => item.area).join('\n');
  for (const area of ['Решения', 'Боты', 'Журнал', 'Счётчики', 'GitHub']) {
    assert.ok(areas.includes(area), area);
  }
});

async function connectedStore() {
  const store = createGoogleConnectionStore({ secret: 'erasure-secret' });
  await store.connect({
    userId: 'u1',
    googleSub: 'sub-1',
    googleEmail: 'owner@example.com',
    scopes: ['openid', DRIVE_FILE],
    refreshToken: '1//to-revoke',
    spreadsheet: { id: 'sheet-AbCdEfGhIjKl', url: 'https://docs.google.com/spreadsheets/d/x' },
  });
  return store;
}

test('очистка Google: отзыв доступа, строка удалена, незавершённые подключения тоже', async () => {
  const store = await connectedStore();
  const verifiers = createGoogleVerifierStore();
  await verifiers.put({ id: 'n1', userId: 'u1', verifier: 'v', expiresAt: Date.now() + 60_000 });
  const google = createFakeGoogle();
  const registry = new AccountErasure();
  registerGoogleErasure(registry, { store, verifiers, fetchImpl: google.fetchImpl, log: () => {} });

  const preview = await registry.preview('u1');
  assert.deepEqual(
    preview.steps[0]!.items.map((item) => item.count),
    [1, 1, 1],
  );
  assert.deepEqual(google.revoked, [], 'сводка не отзывает');
  assert.ok(store.get('u1'));

  const report = await registry.erase('u1');
  assert.deepEqual(google.revoked, ['1//to-revoke']);
  assert.deepEqual(
    report.steps[0]!.items.map((item) => item.count),
    [1, 1, 1],
  );
  assert.deepEqual(report.steps[0]!.notes, []);
  assert.equal(store.get('u1'), undefined);
  assert.deepEqual(verifiers.idsOf('u1'), []);
  assert.equal(report.complete, true);
});

test('очистка Google: отзыв не удался — строка в лог, подключение всё равно удалено', async () => {
  const store = await connectedStore();
  const google = createFakeGoogle();
  google.revokeStatus = 503;
  const logs: string[] = [];
  const registry = new AccountErasure();
  registerGoogleErasure(registry, {
    store,
    fetchImpl: google.fetchImpl,
    log: (line) => logs.push(line),
  });

  const report = await registry.erase('u1');
  assert.equal(report.complete, true);
  assert.equal(store.get('u1'), undefined);
  assert.deepEqual(
    report.steps[0]!.items.map((item) => item.count),
    [1, 0, 0],
  );
  assert.match(report.steps[0]!.notes[0]!, /не подтвердил отзыв/);
  assert.equal(logs.length, 1);
  assert.match(logs[0]!, /отзыв доступа аккаунта u1 не удался/);
  assert.ok(!logs[0]!.includes('to-revoke'), 'токен не в логе');

  // Сеть недоступна — так же.
  const offline = await connectedStore();
  const failing = new AccountErasure();
  registerGoogleErasure(failing, {
    store: offline,
    fetchImpl: (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch,
    log: () => {},
  });
  assert.equal((await failing.erase('u1')).complete, true);
  assert.equal(offline.get('u1'), undefined);
});

test('очистка Google: токен не расшифровать (сменили ключ) — отзыв пропущен, строка удалена', async () => {
  // Строка «из базы», зашифрованная прежним ключом: перехватываем её в драйвере.
  let stored: StoredGoogleConnection | undefined;
  const before = createGoogleConnectionStore({ secret: 'erasure-secret' });
  before.setDbDriver({
    upsert: async (record) => {
      stored = record;
    },
    remove: async () => {},
  });
  await before.connect({
    userId: 'u2',
    googleSub: 's',
    googleEmail: null,
    scopes: [DRIVE_FILE],
    refreshToken: 'tok',
    spreadsheet: null,
  });
  const rotated = createGoogleConnectionStore({ secret: 'new-secret-after-rotation' });
  rotated.loadExternal([stored!]);
  assert.equal(rotated.hasStoredToken('u2'), true);
  assert.equal(rotated.refreshTokenOf('u2'), undefined);

  const google = createFakeGoogle();
  const logs: string[] = [];
  const registry = new AccountErasure();
  registerGoogleErasure(registry, {
    store: rotated,
    fetchImpl: google.fetchImpl,
    log: (line) => logs.push(line),
  });
  const report = await registry.erase('u2');
  assert.deepEqual(google.revoked, []);
  assert.equal(rotated.get('u2'), undefined);
  assert.match(report.steps[0]!.notes[0]!, /не расшифрован/);
  assert.equal(logs.length, 1);
});
