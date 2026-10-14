import { subscriptionStore, usageStore, userStore } from '../store/index.js';
import { BillingService, createBillingLedger, defaultLedgerDir } from './billing-service.js';

export * from './billing-service.js';

/** Журнал платежей и подписок по умолчанию (файлы рядом с остальными хранилищами + Postgres). */
export const billingLedger = createBillingLedger(defaultLedgerDir);

export const billingService = new BillingService({ userStore, subscriptionStore, usageStore, ledger: billingLedger });
