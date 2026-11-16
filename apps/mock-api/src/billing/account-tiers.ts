/**
 * Тариф аккаунта, назначенный администратором (docs/SUBSCRIPTION_PRICING_DESIGN.md, раздел 5).
 * Документ в `ketner_docs` (пространство `account_tiers`), миграции нет. Запись ждёт Postgres:
 * сбой — ошибка администратору, прежний тариф остаётся; после перезапуска тарифы читаются из базы.
 */

import { fileURLToPath } from 'node:url';
import { DocStore } from '../store/doc-store.js';
import { isTierId, type TierId } from '../services/tiers.js';

export interface AccountTier {
  /** id аккаунта. */
  id: string;
  tier: TierId;
  setBy: string;
  setAt: string;
  note?: string;
}

export class AccountTiers {
  constructor(
    readonly store: DocStore<AccountTier>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  tierOf(userId: string): TierId | null {
    const doc = this.store.get(userId);
    return doc && isTierId(doc.tier) ? doc.tier : null;
  }

  get(userId: string): AccountTier | null {
    return this.store.get(userId) ?? null;
  }

  all(): AccountTier[] {
    return this.store.all();
  }

  async set(userId: string, tier: TierId, setBy: string, note?: string): Promise<AccountTier> {
    return this.store.putDurable({
      id: userId,
      tier,
      setBy,
      setAt: this.now().toISOString(),
      ...(note ? { note } : {}),
    });
  }

  async remove(userId: string): Promise<boolean> {
    return this.store.removeDurable(userId);
  }
}

/** Рабочее хранилище: файл на диске плюс зеркало в Postgres (см. db/sync.ts). */
export const accountTierStore = new DocStore<AccountTier>(
  'account_tiers',
  process.env.ACCOUNT_TIER_STORE_FILE ??
    fileURLToPath(new URL('../../data/account-tiers.json', import.meta.url)),
);

export const accountTiers = new AccountTiers(accountTierStore);
