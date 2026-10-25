import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { PlanId, Subscription } from '../types.js';

export interface SubscriptionStore {
  get(userId: string): Subscription;
  checkout(userId: string, plan: PlanId): Subscription;
  cancel(userId: string): Subscription;
  set(subscription: Subscription): Subscription;
  /** Загрузить подписки из внешнего источника (БД). */
  loadExternalSubscriptions?(subs: Subscription[]): void;
  /** Установить драйвер персистентности в БД. */
  setDbDriver?(driver: SubscriptionDbDriver | null): void;
  /** Получить все подписки. */
  getAllSubscriptions?(): Subscription[];
}

export interface SubscriptionDbDriver {
  onSubscriptionUpdated?: (subscription: Subscription) => Promise<void> | void;
}

interface Snapshot {
  subscriptions: Subscription[];
}

function readSnapshot(file: string): Snapshot {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<Snapshot>;
    return {
      subscriptions: Array.isArray(parsed.subscriptions) ? parsed.subscriptions : [],
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('[mock-api] хранилище подписок не прочитано, начинаем с пустого:', error);
    }
    return { subscriptions: [] };
  }
}

function writeSnapshot(file: string, snapshot: Snapshot): void {
  mkdirSync(dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  renameSync(temporary, file);
}

/**
 * Хранилище подписок пользователей на диске.
 *
 * Хранит текущий статус подписки, дату продления и выбранный план.
 */
export function createSubscriptionStore(file: string): SubscriptionStore {
  const snapshot = readSnapshot(file);
  let dbDriver: SubscriptionDbDriver | null = null;

  const persist = (): void => writeSnapshot(file, snapshot);

  return {
    get(userId: string): Subscription {
      const normalized = userId.trim().toLowerCase();
      const existing = snapshot.subscriptions.find(
        (sub) => sub.userId === userId || sub.userId.toLowerCase() === normalized,
      );
      if (existing) {
        return existing;
      }
      return {
        userId,
        plan: 'free',
        status: 'active',
        renewsAt: null,
      };
    },

    checkout(userId: string, plan: PlanId): Subscription {
      const normalized = userId.trim().toLowerCase();
      const existingIndex = snapshot.subscriptions.findIndex(
        (sub) => sub.userId === userId || sub.userId.toLowerCase() === normalized,
      );
      // Продление того же тарифа до окончания срока не сжигает оставшиеся дни: 30 дней
      // добавляются к текущей дате окончания. Смена тарифа начинает новый срок с сегодняшнего дня.
      const previous = existingIndex >= 0 ? snapshot.subscriptions[existingIndex] : undefined;
      const previousEnd = previous?.renewsAt ? Date.parse(previous.renewsAt) : NaN;
      const extendFrom =
        previous && previous.plan === plan && previousEnd > Date.now() ? previousEnd : Date.now();
      const renewsAt = new Date(extendFrom + 30 * 24 * 3600 * 1000).toISOString();

      const updated: Subscription = {
        userId,
        plan,
        status: 'active',
        renewsAt,
      };

      if (existingIndex >= 0) {
        snapshot.subscriptions[existingIndex] = updated;
      } else {
        snapshot.subscriptions.push(updated);
      }

      persist();
      dbDriver
        ?.onSubscriptionUpdated?.({ ...updated })
        ?.catch?.((err) => console.error('[db] Error persisting subscription checkout:', err));
      return updated;
    },

    cancel(userId: string): Subscription {
      const existingIndex = snapshot.subscriptions.findIndex((sub) => sub.userId === userId);
      let updated: Subscription;

      if (existingIndex >= 0) {
        const current = snapshot.subscriptions[existingIndex];
        updated = {
          ...current,
          status: 'canceled',
        };
        snapshot.subscriptions[existingIndex] = updated;
      } else {
        updated = {
          userId,
          plan: 'free',
          status: 'canceled',
          renewsAt: null,
        };
        snapshot.subscriptions.push(updated);
      }

      persist();
      dbDriver
        ?.onSubscriptionUpdated?.({ ...updated })
        ?.catch?.((err) => console.error('[db] Error persisting subscription cancel:', err));
      return updated;
    },

    set(subscription: Subscription): Subscription {
      const normalized = subscription.userId.trim().toLowerCase();
      const existingIndex = snapshot.subscriptions.findIndex(
        (sub) => sub.userId === subscription.userId || sub.userId.toLowerCase() === normalized,
      );

      if (existingIndex >= 0) {
        snapshot.subscriptions[existingIndex] = subscription;
      } else {
        snapshot.subscriptions.push(subscription);
      }

      persist();
      dbDriver
        ?.onSubscriptionUpdated?.({ ...subscription })
        ?.catch?.((err) => console.error('[db] Error persisting subscription update:', err));
      return subscription;
    },

    loadExternalSubscriptions(subs) {
      for (const inc of subs) {
        const idx = snapshot.subscriptions.findIndex(
          (s) => s.userId === inc.userId || s.userId.toLowerCase() === inc.userId.toLowerCase(),
        );
        if (idx >= 0) {
          snapshot.subscriptions[idx] = inc;
        } else {
          snapshot.subscriptions.push(inc);
        }
      }
      try {
        persist();
      } catch {
        // ignore in memory/readonly environments
      }
    },

    setDbDriver(driver) {
      dbDriver = driver;
    },

    getAllSubscriptions() {
      return [...snapshot.subscriptions];
    },
  };
}
