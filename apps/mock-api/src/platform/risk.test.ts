import assert from 'node:assert/strict';
import test from 'node:test';
import { CAPABILITY_IDS } from '../discovery/capabilities.js';
import {
  ACTION_IDS,
  ACTIONS,
  actionRisk,
  approvalRequirement,
  classifyRisk,
  maxRisk,
  type ActionConsequences,
} from './risk.js';

const c = (overrides: Partial<ActionConsequences>): ActionConsequences => ({
  effect: 'read',
  reach: 'internal',
  audience: 'single',
  reversible: true,
  impact: 'routine',
  ...overrides,
});

test('риск по последствиям: примеры владельца', () => {
  // Внутренний черновик — LOW.
  assert.equal(classifyRisk(c({ effect: 'draft' })), 'low');
  // Обычное обновление CRM — LOW, значимое или необратимое — MEDIUM.
  assert.equal(classifyRisk(c({ effect: 'write', reach: 'external' })), 'low');
  assert.equal(
    classifyRisk(c({ effect: 'write', reach: 'external', impact: 'significant' })),
    'medium',
  );
  assert.equal(
    classifyRisk(c({ effect: 'write', reach: 'external', reversible: false })),
    'medium',
  );
  // Одобренное сообщение одному клиенту — MEDIUM; рассылка — HIGH.
  assert.equal(classifyRisk(c({ effect: 'send', reach: 'external', reversible: false })), 'medium');
  assert.equal(classifyRisk(c({ effect: 'send', reach: 'external', audience: 'bulk' })), 'high');
  // Деньги и удаление — HIGH или CRITICAL.
  assert.equal(
    classifyRisk(c({ effect: 'financial', reach: 'external', reversible: true })),
    'high',
  );
  assert.equal(
    classifyRisk(c({ effect: 'financial', reach: 'external', reversible: false })),
    'critical',
  );
  assert.equal(classifyRisk(c({ effect: 'delete', reach: 'external', reversible: true })), 'high');
  assert.equal(
    classifyRisk(c({ effect: 'delete', reach: 'external', reversible: false })),
    'critical',
  );
  assert.equal(
    classifyRisk(c({ effect: 'legal', reach: 'external', reversible: false })),
    'critical',
  );
});

test('риск растёт с охватом: массовое изменение данных — HIGH', () => {
  assert.equal(classifyRisk(c({ effect: 'write', reach: 'external', audience: 'bulk' })), 'high');
  assert.equal(classifyRisk(c({ effect: 'send', reach: 'internal' })), 'low');
});

test('словарь действий: id совпадают с ключами, возможности существуют', () => {
  for (const id of ACTION_IDS) {
    assert.equal(ACTIONS[id].id, id);
    for (const capability of ACTIONS[id].requires)
      assert.ok(CAPABILITY_IDS.includes(capability), `${id}: ${capability}`);
  }
});

test('риски словаря выводятся из последствий', () => {
  assert.equal(actionRisk('reply.draft'), 'low');
  assert.equal(actionRisk('lead.create'), 'low');
  assert.equal(actionRisk('owner.notify'), 'low');
  assert.equal(actionRisk('record.update'), 'low');
  assert.equal(actionRisk('record.update_significant'), 'medium');
  assert.equal(actionRisk('message.send'), 'medium');
  assert.equal(actionRisk('reply.send_in_session'), 'medium');
  assert.equal(actionRisk('message.bulk_send'), 'high');
  assert.equal(actionRisk('price.change'), 'high');
  assert.equal(actionRisk('record.delete'), 'critical');
  assert.equal(actionRisk('payment.refund'), 'critical');
  assert.equal(actionRisk('contract.sign'), 'critical');
});

test('одобрение — отдельно от риска: владелец ужесточает, но не ослабляет', () => {
  assert.equal(approvalRequirement('record.update'), 'none');
  assert.equal(
    approvalRequirement('record.update', { alwaysApprove: ['record.update'] }),
    'required',
  );
  // Сообщение одному клиенту — MEDIUM: сразу только при заранее выданном разрешении.
  assert.equal(approvalRequirement('message.send'), 'required');
  assert.equal(
    approvalRequirement('message.send', { standingPermissions: ['message.send'] }),
    'none',
  );
  // «Одобрять всегда» сильнее заранее выданного разрешения.
  assert.equal(
    approvalRequirement('message.send', {
      standingPermissions: ['message.send'],
      alwaysApprove: ['message.send'],
    }),
    'required',
  );
  // Изменение записи зависит от последствий: обычное — сразу, значимое — как сообщение клиенту.
  assert.equal(approvalRequirement('record.update_significant'), 'required');
  assert.equal(
    approvalRequirement('record.update_significant', {
      standingPermissions: ['record.update_significant'],
    }),
    'none',
  );
  // Разрешение не ослабляет HIGH.
  assert.equal(
    approvalRequirement('message.bulk_send', { standingPermissions: ['message.bulk_send'] }),
    'required',
  );
  // HIGH — одобрение всегда, настройки не отключают.
  assert.equal(approvalRequirement('message.bulk_send'), 'required');
  assert.equal(approvalRequirement('message.bulk_send', { alwaysApprove: [] }), 'required');
  // CRITICAL — запрещено без проверенного процесса, с ним — только с одобрением.
  assert.equal(approvalRequirement('payment.refund'), 'forbidden');
  assert.equal(
    approvalRequirement('payment.refund', {
      verifiedCriticalProcesses: { 'payment.refund': 'p1' },
    }),
    'required',
  );
  assert.equal(
    approvalRequirement('payment.refund', { verifiedCriticalProcesses: { 'contract.sign': 'p1' } }),
    'forbidden',
  );
});

test('максимальный риск набора', () => {
  assert.equal(maxRisk([]), 'low');
  assert.equal(maxRisk(['low', 'high', 'medium']), 'high');
  assert.equal(maxRisk(['critical', 'low']), 'critical');
});
