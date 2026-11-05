/**
 * Хранилища Discovery в процессе.
 *
 * С Postgres (DATABASE_URL) — таблицы миграции `0001_discovery`, подключаются в `initDatabaseSync`
 * после успешных миграций. Если база настроена, но миграции не применились, Discovery недоступен
 * (API отвечает 503), а чат, оплата и Code работают дальше. Без базы (локально, тесты) — память.
 */

import type { SqlRunner } from '../code/postgres-driver.js';
import { MemoryBudgetStore, PostgresBudgetStore, type BudgetStore } from './budget.js';
import { MemoryDiscoveryStore, PostgresDiscoveryStore, type DiscoveryStore } from './store.js';
import { MemoryBuilderStore, PostgresBuilderStore, type BuilderStore } from '../builder/store.js';
import {
  MemoryMaterialStore,
  PostgresMaterialStore,
  type MaterialStore,
} from '../builder/tools/material-store.js';

export interface DiscoveryStores {
  store: DiscoveryStore;
  budget: BudgetStore;
  /** Builder (этап 6): помощники, версии, тесты, чат — миграция `0004_solutions`. */
  builder: BuilderStore;
  /** Материалы инструментов Builder — миграция `0008_solution_materials`. */
  materials: MaterialStore;
}

let databaseExpected = false;
let postgres: DiscoveryStores | null = null;
let memory: DiscoveryStores | null = null;

/** База настроена: Discovery работает только на ней (память в production не используется). */
export function expectDiscoveryDatabase(): void {
  databaseExpected = true;
}

export function attachDiscoveryDriver(runner: SqlRunner): void {
  postgres = {
    store: new PostgresDiscoveryStore(runner),
    budget: new PostgresBudgetStore(runner),
    builder: new PostgresBuilderStore(runner),
    materials: new PostgresMaterialStore(runner),
  };
}

/** null — база настроена, но таблицы недоступны (миграции не применились). */
export function getDiscoveryStores(): DiscoveryStores | null {
  if (postgres) return postgres;
  if (databaseExpected) return null;
  if (!memory) {
    const builder = new MemoryBuilderStore();
    memory = {
      store: new MemoryDiscoveryStore(),
      budget: new MemoryBudgetStore(),
      builder,
      materials: new MemoryMaterialStore((ownerId, id) => builder.getSolution(ownerId, id)),
    };
  }
  return memory;
}
