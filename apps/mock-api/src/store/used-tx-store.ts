import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from '../config.js';

export interface UsedTxRecord {
  txHash: string;
  userId: string;
  planId: string;
  currency: string;
  amount: number;
  createdAt: string;
  blockTimestamp?: number;
}

export interface UsedTxStore {
  isTxUsed(txHash: string): boolean;
  recordUsedTx(record: UsedTxRecord): void;
  getUsedTx(txHash: string): UsedTxRecord | undefined;
  list(): UsedTxRecord[];
  clear(): void;
}

function readSnapshot(file: string): UsedTxRecord[] {
  try {
    const raw = readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed;
    }
    if (parsed && Array.isArray(parsed.records)) {
      return parsed.records;
    }
    return [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('[used-tx-store] Хранилище использованных TxID не прочитано:', error);
    }
    return [];
  }
}

function writeSnapshot(file: string, records: UsedTxRecord[]): void {
  try {
    mkdirSync(dirname(file), { recursive: true });
    const temporary = `${file}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(records, null, 2)}\n`, 'utf8');
    renameSync(temporary, file);
  } catch (error) {
    console.error('[used-tx-store] Ошибка сохранения использованных TxID:', error);
  }
}

export function createUsedTxStore(file?: string): UsedTxStore {
  const map = new Map<string, UsedTxRecord>();

  if (file) {
    const initial = readSnapshot(file);
    for (const item of initial) {
      if (item && item.txHash) {
        map.set(item.txHash.toLowerCase().trim(), item);
      }
    }
  }

  const persist = (): void => {
    if (!file) return;
    writeSnapshot(file, Array.from(map.values()));
  };

  return {
    isTxUsed(txHash: string): boolean {
      if (!txHash) return false;
      return map.has(txHash.toLowerCase().trim());
    },

    recordUsedTx(record: UsedTxRecord): void {
      if (!record.txHash) return;
      const key = record.txHash.toLowerCase().trim();
      map.set(key, {
        ...record,
        txHash: key,
        createdAt: record.createdAt || new Date().toISOString(),
      });
      persist();
    },

    getUsedTx(txHash: string): UsedTxRecord | undefined {
      if (!txHash) return undefined;
      return map.get(txHash.toLowerCase().trim());
    },

    list(): UsedTxRecord[] {
      return Array.from(map.values());
    },

    clear(): void {
      map.clear();
      persist();
    },
  };
}

export const usedTxStore = createUsedTxStore(config.usedTxStoreFile);
