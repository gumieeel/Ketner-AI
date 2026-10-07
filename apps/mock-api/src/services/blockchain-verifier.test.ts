import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { config } from '../config.js';
import { MERCHANT_ADDRESSES, TRC20_USDT_CONTRACT, blockchainVerifier } from './blockchain-verifier.js';

const HASH = 'a'.repeat(64);
const originalFetch = globalThis.fetch;
const mutable = config as unknown as { enableMockBilling: boolean; manualCryptoEnabled: boolean };
const original = { ...mutable };

afterEach(() => {
  globalThis.fetch = originalFetch;
  mutable.enableMockBilling = original.enableMockBilling;
  mutable.manualCryptoEnabled = original.manualCryptoEnabled;
});

/** Подменяет ответ Tronscan. */
function mockTronscan(body: Record<string, unknown>): void {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })) as typeof fetch;
}

function goodTx(overrides: Record<string, unknown> = {}, transfer: Record<string, unknown> = {}) {
  return {
    hash: HASH,
    contractRet: 'SUCCESS',
    confirmed: true,
    timestamp: Date.now() - 60_000,
    trc20TransferInfo: [
      {
        to_address: MERCHANT_ADDRESSES.USDT_TRC20,
        from_address: 'TSomeSender',
        contract_address: TRC20_USDT_CONTRACT,
        amount_str: '9000000',
        decimals: 6,
        symbol: 'USDT',
        ...transfer,
      },
    ],
    ...overrides,
  };
}

const verify = (extra: Partial<Parameters<typeof blockchainVerifier.verifyTransaction>[0]> = {}) =>
  blockchainVerifier.verifyTransaction({
    txHash: HASH,
    currency: 'USDT_TRC20',
    requiredUsd: 9,
    planId: 'plus',
    userId: 'u1',
    invoiceCreatedAt: new Date(Date.now() - 600_000).toISOString(),
    ...extra,
  });

test('verifier (C7): корректный перевод USDT на наш адрес принимается', async () => {
  mockTronscan(goodTx());
  const result = await verify();
  assert.equal(result.success, true, result.errorMessage);
  assert.equal(result.transferredAmount, 9);
});

test('verifier (C7): TEST_VALID/MOCK_VALID работают только вне production', async () => {
  mutable.enableMockBilling = true;
  const dev = await verify({ txHash: 'TEST_VALID_123' });
  assert.equal(dev.success, true);

  mutable.enableMockBilling = false;
  for (const fake of ['TEST_VALID_123', 'MOCK_VALID_abc', 'test_valid_x']) {
    // сеть не должна вызываться вовсе: формат отсекает хеш до запроса
    globalThis.fetch = (async () => {
      throw new Error('сетевой запрос не ожидается');
    }) as typeof fetch;
    const prod = await verify({ txHash: fake });
    assert.equal(prod.success, false, fake);
    assert.equal(prod.errorCode, 'invalid_tx_format', fake);
  }
});

test('verifier (C7): без ENABLE_MANUAL_CRYPTO ручная проверка отключена', async () => {
  mutable.manualCryptoEnabled = false;
  mutable.enableMockBilling = false;
  mockTronscan(goodTx());
  const result = await verify();
  assert.equal(result.success, false);
  assert.equal(result.errorCode, 'manual_crypto_disabled');
});

test('verifier (C7): токен с символом USDT, но другим контрактом, не принимается', async () => {
  mockTronscan(goodTx({}, { contract_address: 'TFakeTokenContractAddress000000000000', symbol: 'USDT' }));
  const result = await verify();
  assert.equal(result.success, false);
  assert.equal(result.errorCode, 'invalid_recipient_or_token');
});

test('verifier (C7): запись без контракта и контракт в другом регистре не принимаются', async () => {
  mockTronscan(goodTx({}, { contract_address: undefined }));
  assert.equal((await verify()).success, false);
  mockTronscan(goodTx({}, { contract_address: TRC20_USDT_CONTRACT.toLowerCase() }));
  assert.equal((await verify()).success, false);
});

test('verifier (C7): чужой получатель, мало денег, не те decimals', async () => {
  mockTronscan(goodTx({}, { to_address: 'TAttackerWallet0000000000000000000' }));
  assert.equal((await verify()).errorCode, 'invalid_recipient_or_token');

  mockTronscan(goodTx({}, { amount_str: '1000000' }));
  assert.equal((await verify()).errorCode, 'insufficient_amount');

  mockTronscan(goodTx({}, { decimals: 18 }));
  assert.equal((await verify()).errorCode, 'invalid_recipient_or_token');
});

test('verifier (C7): хеш в ответе должен совпадать с запрошенным', async () => {
  mockTronscan(goodTx({ hash: 'b'.repeat(64) }));
  const result = await verify();
  assert.equal(result.success, false);
  assert.equal(result.errorCode, 'tx_not_found');
});

test('verifier (C7): неподтверждённая, неуспешная и без времени транзакции отклоняются', async () => {
  mockTronscan(goodTx({ confirmed: undefined }));
  assert.equal((await verify()).errorCode, 'tx_unconfirmed');
  mockTronscan(goodTx({ confirmed: false }));
  assert.equal((await verify()).errorCode, 'tx_unconfirmed');
  mockTronscan(goodTx({ contractRet: 'REVERT' }));
  assert.equal((await verify()).errorCode, 'tx_execution_failed');
  mockTronscan(goodTx({ timestamp: 0 }));
  assert.equal((await verify()).errorCode, 'tx_unconfirmed');
});

test('verifier (C7): перевод старше 48 часов или совершённый до создания счёта отклоняется', async () => {
  mockTronscan(goodTx({ timestamp: Date.now() - 49 * 3600 * 1000 }));
  assert.equal((await verify({ invoiceCreatedAt: undefined })).errorCode, 'tx_expired');

  // чужой старый платёж на наш адрес: перевод был час назад, счёт создан только что
  mockTronscan(goodTx({ timestamp: Date.now() - 3600 * 1000 }));
  const result = await verify({ invoiceCreatedAt: new Date().toISOString() });
  assert.equal(result.success, false);
  assert.equal(result.errorCode, 'tx_before_invoice');
});

test('verifier (C7): TON и BTC в production не поддерживаются (проверки не сверяют сумму)', async () => {
  mutable.enableMockBilling = false;
  globalThis.fetch = (async () => {
    throw new Error('сетевой запрос не ожидается');
  }) as typeof fetch;
  for (const currency of ['TON', 'USDT_TON', 'BTC'] as const) {
    const result = await verify({ currency, txHash: 'c'.repeat(64) });
    assert.equal(result.success, false, currency);
    assert.equal(result.errorCode, 'currency_not_supported', currency);
  }
});
