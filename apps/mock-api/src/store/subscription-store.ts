import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { PlanId, Subscription } from '../types.js';

export interface SubscriptionStore {
  get(userId: string): Subscription;
  checkout(userId: string, plan: PlanId): Subscription;
  cancel(userId: string): Subscription;
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
      const renewsAt = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
      const normalized = userId.trim().toLowerCase();
      const existingIndex = snapshot.subscriptions.findIndex(
        (sub) => sub.userId === userId || sub.userId.toLowerCase() === normalized,
      );

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
      return updated;
    },
  };
}
