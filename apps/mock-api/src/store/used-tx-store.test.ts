import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createUsedTxStore, type UsedTxRecord } from './used-tx-store.js';

const record = (txHash: string, userId = 'u1'): UsedTxRecord => ({
  txHash,
  userId,
  planId: 'plus',
  currency: 'USDT_TRC20',
  amount: 9,
  createdAt: new Date().toISOString(),
});

test('used-tx-store (C7): reserveTx занимает хеш один раз, регистр и пробелы не помогают обойти', () => {
  const store = createUsedTxStore();
  assert.equal(store.reserveTx(record('ABCDEF')), true);
  assert.equal(store.reserveTx(record('abcdef', 'u2')), false);
  assert.equal(store.reserveTx(record('  AbCdEf  ', 'u3')), false);
  assert.equal(store.isTxUsed('ABCDEF'), true);
  assert.equal(store.getUsedTx('abcdef')?.userId, 'u1');
});

test('used-tx-store (C7): releaseTx освобождает хеш для повторной подачи', () => {
  const store = createUsedTxStore();
  assert.equal(store.reserveTx(record('hash1')), true);
  store.releaseTx('HASH1');
  assert.equal(store.isTxUsed('hash1'), false);
  assert.equal(store.reserveTx(record('hash1', 'u2')), true);
});

test('used-tx-store (C7): пустой хеш не резервируется', () => {
  const store = createUsedTxStore();
  assert.equal(store.reserveTx(record('')), false);
});
