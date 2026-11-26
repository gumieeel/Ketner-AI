import assert from 'node:assert/strict';
import test from 'node:test';
import { checkSolutionLaunch, nextTierWithMoreSolutions } from './active-solutions.js';
import { tierById } from '../services/tiers.js';

test('запуск агента: без тарифа — tier_required; место есть — можно; нет — solution_limit', () => {
  assert.equal(checkSolutionLaunch({ tier: null, active: 0, alreadyActive: false }).ok, false);
  assert.equal(
    checkSolutionLaunch({ tier: null, active: 0, alreadyActive: true }).ok,
    false,
    'без тарифа не включается и новая версия',
  );
  assert.deepEqual(checkSolutionLaunch({ tier: 'start', active: 0, alreadyActive: false }), {
    ok: true,
  });
  const full = checkSolutionLaunch({ tier: 'start', active: 1, alreadyActive: false });
  assert.equal(full.ok, false);
  if (!full.ok && full.code === 'solution_limit') {
    assert.deepEqual([full.used, full.limit, full.tier, full.nextTier], [1, 1, 'start', 'growth']);
    assert.equal(
      full.message,
      'Активных решений: 1 из 1 — тариф Start. Чтобы запустить ещё одно, нужен тариф Growth (до 3) — или поставьте на паузу одно из работающих.',
    );
  }
  // Работающий агент (новая версия) места не требует.
  assert.equal(checkSolutionLaunch({ tier: 'start', active: 5, alreadyActive: true }).ok, true);
});

test('наибольший тариф — без «следующего»; английский текст', () => {
  assert.equal(nextTierWithMoreSolutions(tierById('scale')), null);
  const top = checkSolutionLaunch({ tier: 'scale', active: 25, alreadyActive: false }, 'en');
  assert.equal(top.ok, false);
  if (!top.ok) assert.match(top.message, /^Active solutions: 25 of 25 on the Scale plan\. This is/);
  const none = checkSolutionLaunch({ tier: null, active: 0, alreadyActive: false }, 'en');
  if (!none.ok) assert.match(none.message, /^Launching an agent needs an active plan/);
});
