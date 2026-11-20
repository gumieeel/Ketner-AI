/**
 * Счётчики себестоимости с лимитом (docs/SUBSCRIPTION_PRICING_DESIGN.md, раздел 4.1): бесплатный лимит
 * создания и проверки (месяц и сутки аккаунта) и суточный бюджет сервиса.
 *
 * Резерв — атомарный по всем счётчикам сразу: либо все выросли на сумму и ни один не превысил
 * лимит, либо не изменился ни один. Расчёт по факту уменьшает счётчики на неистраченную часть.
 *
 * В Postgres — строки таблицы `ketner_docs` (пространство `cost_counters`; таблица уже есть,
 * миграции нет), и в отличие от DocStore каждое изменение — SQL-запрос с ожиданием ответа: ничего не
 * живёт только в памяти, перезапуск не теряет потраченное.
 */

import type { SqlRunner } from '../code/postgres-driver.js';

export const COST_COUNTERS_NAMESPACE = 'cost_counters';

export interface CounterLimit {
  key: string;
  limitUsd: number;
}

export interface CounterStore {
  /** Атомарно увеличивает все счётчики на `amountUsd`, если ни один не превысит свой лимит. */
  reserve(items: readonly CounterLimit[], amountUsd: number): Promise<boolean>;
  /** Меняет счётчики на `deltaUsd` (расчёт по факту — отрицательная поправка), не ниже нуля. */
  adjust(keys: readonly string[], deltaUsd: number): Promise<void>;
  /** Потрачено по счётчикам, $; отсутствующий — 0. */
  spent(keys: readonly string[]): Promise<Record<string, number>>;
  /** Отметка «уже сделано» (сигнал раз в сутки): true — только у первого, кто её поставил. */
  claim(key: string): Promise<boolean>;
  /** Снять отметку (действие после неё не удалось — следующий может поставить её снова). */
  release(key: string): Promise<void>;
  /**
   * Очистка старых строк: суточные счётчики и отметки старше `dayRowsDays` дней, месячные — старше
   * `monthRowsDays`. Возвращает число удалённых строк.
   */
  purge(options: { dayRowsDays: number; monthRowsDays: number }): Promise<number>;
}

const round6 = (value: number): number => Math.round(value * 1e6) / 1e6;

export class MemoryCounterStore implements CounterStore {
  private readonly values = new Map<string, number>();
  private readonly claims = new Set<string>();

  async claim(key: string): Promise<boolean> {
    if (this.claims.has(key)) return false;
    this.claims.add(key);
    return true;
  }

  async release(key: string): Promise<void> {
    this.claims.delete(key);
  }

  /** В памяти строк немного и они живут до перезапуска: очистка не нужна. */
  async purge(): Promise<number> {
    return 0;
  }

  async reserve(items: readonly CounterLimit[], amountUsd: number): Promise<boolean> {
    const fits = items.every(
      (item) => round6((this.values.get(item.key) ?? 0) + amountUsd) <= round6(item.limitUsd),
    );
    if (!fits) return false;
    for (const item of items) {
      this.values.set(item.key, round6((this.values.get(item.key) ?? 0) + amountUsd));
    }
    return true;
  }

  async adjust(keys: readonly string[], deltaUsd: number): Promise<void> {
    for (const key of keys) {
      this.values.set(key, Math.max(0, round6((this.values.get(key) ?? 0) + deltaUsd)));
    }
  }

  async spent(keys: readonly string[]): Promise<Record<string, number>> {
    return Object.fromEntries(keys.map((key) => [key, this.values.get(key) ?? 0]));
  }
}

/** Та же таблица и то же определение, что создаёт db/sync.ts при старте (если её ещё нет). */
const KETNER_DOCS_SQL = `
  CREATE TABLE IF NOT EXISTS "ketner_docs" (
    "namespace" text NOT NULL,
    "id" text NOT NULL,
    "data" jsonb NOT NULL,
    "updated_at" timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY ("namespace", "id")
  )`;

export class PostgresCounterStore implements CounterStore {
  private ready: Promise<void> | null = null;

  constructor(private readonly sql: SqlRunner) {}

  private ensure(): Promise<void> {
    this.ready ??= this.sql.query(KETNER_DOCS_SQL).then(
      () => undefined,
      (error: unknown) => {
        this.ready = null;
        throw error;
      },
    );
    return this.ready;
  }

  async reserve(items: readonly CounterLimit[], amountUsd: number): Promise<boolean> {
    if (items.length === 0) return true;
    await this.ensure();
    const keys = items.map((item) => item.key);
    const limits = items.map((item) => item.limitUsd);
    // Строки счётчиков заводятся заранее, отдельным запросом: строки, вставленные в том же запросе,
    // не видны соседним частям CTE.
    await this.sql.query(
      `INSERT INTO ketner_docs (namespace, id, data)
       SELECT $1, k, '{"spentUsd": 0}'::jsonb FROM unnest($2::text[]) AS k
       ON CONFLICT (namespace, id) DO NOTHING`,
      [COST_COUNTERS_NAMESPACE, keys],
    );
    // Один запрос: строки резерва блокируются (FOR UPDATE возвращает их свежие значения после
    // ожидания параллельного запроса) и увеличиваются, только если все лимиты соблюдены.
    const rows = await this.sql.query<{ id: string }>(
      `WITH input AS (
         SELECT * FROM unnest($2::text[], $3::numeric[]) AS t(id, limit_usd)
       ),
       locked AS (
         SELECT d.id, (d.data ->> 'spentUsd')::numeric AS spent, i.limit_usd
         FROM ketner_docs d JOIN input i ON d.namespace = $1 AND d.id = i.id
         ORDER BY d.id
         FOR UPDATE OF d
       ),
       verdict AS (
         SELECT count(*) = $5 AND bool_and(round(spent + $4, 6) <= round(limit_usd, 6)) AS ok
         FROM locked
       )
       UPDATE ketner_docs d
       SET data = jsonb_set(d.data, '{spentUsd}', to_jsonb(round(l.spent + $4, 6))),
           updated_at = now()
       FROM locked l, verdict v
       WHERE d.namespace = $1 AND d.id = l.id AND v.ok
       RETURNING d.id`,
      [COST_COUNTERS_NAMESPACE, keys, limits, amountUsd, keys.length],
    );
    return rows.length === keys.length;
  }

  async adjust(keys: readonly string[], deltaUsd: number): Promise<void> {
    if (keys.length === 0 || deltaUsd === 0) return;
    await this.ensure();
    await this.sql.query(
      `UPDATE ketner_docs
       SET data = jsonb_set(data, '{spentUsd}',
             to_jsonb(greatest(0, round((data ->> 'spentUsd')::numeric + $3, 6)))),
           updated_at = now()
       WHERE namespace = $1 AND id = ANY($2::text[])`,
      [COST_COUNTERS_NAMESPACE, [...keys], deltaUsd],
    );
  }

  async claim(key: string): Promise<boolean> {
    await this.ensure();
    const rows = await this.sql.query<{ id: string }>(
      `INSERT INTO ketner_docs (namespace, id, data) VALUES ($1, $2, '{"claimed": true}'::jsonb)
       ON CONFLICT (namespace, id) DO NOTHING RETURNING id`,
      [COST_COUNTERS_NAMESPACE, key],
    );
    return rows.length === 1;
  }

  async release(key: string): Promise<void> {
    await this.ensure();
    await this.sql.query(`DELETE FROM ketner_docs WHERE namespace = $1 AND id = $2`, [
      COST_COUNTERS_NAMESPACE,
      key,
    ]);
  }

  async purge(options: { dayRowsDays: number; monthRowsDays: number }): Promise<number> {
    await this.ensure();
    const rows = await this.sql.query<{ id: string }>(
      `DELETE FROM ketner_docs
       WHERE namespace = $1
         AND (
           ((id LIKE 'acct-day:%' OR id LIKE 'service-day:%' OR id LIKE 'service-day-alert:%')
             AND updated_at < now() - make_interval(days => $2))
           OR ((id LIKE 'acct:%' OR id LIKE 'tier-alert:%')
             AND updated_at < now() - make_interval(days => $3))
         )
       RETURNING id`,
      [COST_COUNTERS_NAMESPACE, options.dayRowsDays, options.monthRowsDays],
    );
    return rows.length;
  }

  async spent(keys: readonly string[]): Promise<Record<string, number>> {
    if (keys.length === 0) return {};
    await this.ensure();
    const rows = await this.sql.query<{ id: string; spent: string | number }>(
      `SELECT id, (data ->> 'spentUsd')::numeric AS spent FROM ketner_docs
       WHERE namespace = $1 AND id = ANY($2::text[])`,
      [COST_COUNTERS_NAMESPACE, [...keys]],
    );
    const found = new Map(rows.map((row) => [row.id, Number(row.spent)]));
    return Object.fromEntries(keys.map((key) => [key, found.get(key) ?? 0]));
  }
}

/** Сколько хранить строки счётчиков: суточные — 60 дней, месячные — 400 (тринадцать месяцев). */
export const COUNTER_RETENTION = { dayRowsDays: 60, monthRowsDays: 400 } as const;

let cleanupStarted = false;

/**
 * Очистка старых строк счётчиков в Postgres: через минуту после старта и раз в сутки. Миграции нет:
 * удаляются строки `ketner_docs` пространства `cost_counters`, которые давно не менялись.
 */
export function startCounterCleanup(
  counters: CounterStore,
  log: (message: string, error?: unknown) => void = (message, error) =>
    error ? console.error(message, error) : console.info(message),
): void {
  if (cleanupStarted || counters instanceof MemoryCounterStore) return;
  cleanupStarted = true;
  const run = async () => {
    try {
      const removed = await counters.purge(COUNTER_RETENTION);
      if (removed > 0) log(`[allowance] удалено старых строк счётчиков: ${removed}`);
    } catch (error) {
      log('[allowance] очистка счётчиков не прошла', error);
    }
  };
  setTimeout(() => void run(), 60_000).unref();
  setInterval(() => void run(), 24 * 60 * 60_000).unref();
}
