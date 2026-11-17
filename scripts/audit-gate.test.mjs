/**
 * Проверка шага CI «Уязвимости в рабочих зависимостях» (scripts/audit-gate.mjs) на сохранённых
 * отчётах npm audit: без сети и без вызова npm.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { blockingAdvisories, evaluate } from './audit-gate.mjs';

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));

const picomatchReport = fixture('audit-picomatch');
const PICOMATCH = {
  id: 'GHSA-fc5q-39xc-vjpf',
  package: 'picomatch',
  reason: 'build-time only (vite / tinyglobby / fdir), not loaded by the server',
  added: '2026-11-17',
  reviewBy: '2026-12-17',
};
const TODAY = '2026-11-17';

test('берутся сами уязвимости high и critical; «зависит от уязвимого» и moderate — нет', () => {
  assert.deepEqual(blockingAdvisories(picomatchReport), [
    {
      id: 'GHSA-fc5q-39xc-vjpf',
      package: 'picomatch',
      severity: 'high',
      title: 'picomatch vulnerable to ReDoS through single-branch repeated extglobs',
      range: '<=4.0.7',
    },
  ]);
});

test('high не из списка — падение', () => {
  const result = evaluate(picomatchReport, [], TODAY);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /Уязвимость: high picomatch .*GHSA-fc5q-39xc-vjpf/);
});

test('critical не из списка — падение, даже если другие в списке', () => {
  const result = evaluate(fixture('audit-unlisted-critical'), [PICOMATCH], TODAY);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /Уязвимость: critical example-lib .*GHSA-xxxx-yyyy-zzzz/);
});

test('уязвимость из списка до даты пересмотра — проходит, с пометкой', () => {
  const result = evaluate(picomatchReport, [PICOMATCH], TODAY);
  assert.deepEqual(result.errors, []);
  assert.match(result.notes[0], /пропущено до 2026-12-17: high picomatch/);
  // В последний день пересмотра ещё действует.
  assert.deepEqual(evaluate(picomatchReport, [PICOMATCH], '2026-12-17').errors, []);
});

test('исключение просрочено — падение', () => {
  const result = evaluate(picomatchReport, [PICOMATCH], '2026-12-18');
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /GHSA-fc5q-39xc-vjpf \(picomatch\) просрочено: .*до 2026-12-17/);
  // Просроченное исключение падает, даже когда уязвимости уже нет.
  assert.equal(evaluate(fixture('audit-clean'), [PICOMATCH], '2026-12-18').errors.length, 1);
});

test('исключение для другого пакета не покрывает уязвимость', () => {
  const result = evaluate(picomatchReport, [{ ...PICOMATCH, package: 'vite' }], TODAY);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /Уязвимость: high picomatch/);
});

test('неполное исключение — падение: нужны id, пакет, причина, дата добавления и пересмотра', () => {
  const { reason: _reason, ...noReason } = PICOMATCH;
  const result = evaluate(
    picomatchReport,
    [noReason, { ...PICOMATCH, reviewBy: '17.12.2026' }],
    TODAY,
  );
  assert.equal(result.errors.length, 3);
  assert.match(result.errors[0], /№1 заполнено неверно: нет поля reason/);
  assert.match(result.errors[1], /№2 заполнено неверно: reviewBy не в виде ГГГГ-ММ-ДД/);
  assert.match(result.errors[2], /Уязвимость: high picomatch/);
});

test('исключение больше не нужно — подсказка убрать, но не падение', () => {
  const result = evaluate(fixture('audit-clean'), [PICOMATCH], TODAY);
  assert.deepEqual(result.errors, []);
  assert.match(result.notes[0], /больше не нужно/);
});

test('npm audit не смог ответить — падение', () => {
  const result = evaluate({ error: { code: 'ENOAUDIT', summary: 'registry error' } }, [], TODAY);
  assert.deepEqual(result.errors, ['npm audit не смог проверить зависимости: registry error']);
});

test('список исключений в репозитории заполнен по правилам', () => {
  const committed = JSON.parse(
    readFileSync(new URL('../.github/audit-allowlist.json', import.meta.url), 'utf8'),
  );
  assert.deepEqual(evaluate(fixture('audit-clean'), committed, '2026-11-17').errors, []);
});
