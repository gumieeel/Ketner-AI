/**
 * Хранилище записей использования AI (Usage & Cost Accounting).
 *
 * Сохраняет детальные логи каждого AI запроса (токены, стоимость, задержка),
 * предоставляет метрики для Fair Use Engine, агрегацию для админ-панели и
 * расчёт рентабельности подписок (profitability).
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  FairUseSnapshot,
  GatewayMetrics,
  LatencyBreakdown,
  MetricAlert,
  ModelMetric,
  ModelUsageMetric,
  PlanCostMetric,
  ProviderStatus,
  ResponseSource,
  SourceMetrics,
  UsageRecord,
  UsageStats,
  UsageStatus,
  UserProfitability,
} from '../ai/gateway-types.js';
import { promptCachePolicy, vendorOf } from '../ai/prompt-cache.js';

interface UsageStoreData {
  records: UsageRecord[];
}

/** Зеркало записей использования в Postgres (таблица `ketner_docs`, пространство `usage`). */
interface UsageDbDriver {
  upsert(namespace: string, doc: UsageRecord): Promise<void>;
}

const MAX_RECORDS = 50000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Что метрикам нужно знать о модели из реестра: имя и движок (по нему — вендор и кэш). */
export interface ModelDescriptor {
  name: string | null;
  engineId: string;
}

/** Сколько длинных запросов нужно, чтобы судить о кэше модели. */
const CACHE_VERDICT_MIN_REQUESTS = 10;
/** Если кэш есть меньше чем у этой доли длинных запросов, он, скорее всего, не срабатывает. */
const CACHE_WORKING_MIN_HIT_RATE = 0.2;

const pct = (part: number, whole: number): number =>
  whole > 0 ? Number(((part / whole) * 100).toFixed(1)) : 0;

export class UsageStore {
  /** Пространство имён в `ketner_docs`; совместимо с syncDocStores. */
  readonly namespace = 'usage';
  private dbDriver: UsageDbDriver | null = null;
  private filePath: string;
  private records: UsageRecord[] = [];
  private userIndex = new Map<string, UsageRecord[]>();
  private activeConcurrency = new Map<string, number>();

  constructor(filePath: string) {
    this.filePath = filePath;
    this.load();
  }

  private rebuildIndex(): void {
    this.userIndex.clear();
    for (const record of this.records) {
      let list = this.userIndex.get(record.userId);
      if (!list) {
        list = [];
        this.userIndex.set(record.userId, list);
      }
      list.push(record);
    }
  }

  private load(): void {
    if (!existsSync(this.filePath)) {
      this.records = [];
      this.rebuildIndex();
      return;
    }

    try {
      const raw = readFileSync(this.filePath, 'utf-8');
      const data = JSON.parse(raw) as UsageStoreData;
      this.records = Array.isArray(data.records) ? data.records : [];
    } catch {
      this.records = [];
    }
    this.rebuildIndex();
  }

  /** Подмешивает записи из базы (после перезапуска диск Render пуст): дубликаты по id отбрасываются. */
  loadExternal(docs: UsageRecord[]): void {
    const byId = new Map<string, UsageRecord>();
    for (const record of this.records) byId.set(record.id, record);
    for (const record of docs) byId.set(record.id, record);
    this.records = [...byId.values()]
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(-MAX_RECORDS);
    this.rebuildIndex();
  }

  setDbDriver(driver: UsageDbDriver | null): void {
    this.dbDriver = driver;
  }

  private persist(): void {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const tmpPath = `${this.filePath}.tmp`;
    const payload: UsageStoreData = { records: this.records };
    writeFileSync(tmpPath, JSON.stringify(payload, null, 2), 'utf-8');
    renameSync(tmpPath, this.filePath);
  }

  /**
   * Записать факт использования AI.
   */
  recordUsage(params: {
    userId: string;
    subscriptionId?: string | null;
    conversationId: string;
    modelId: string;
    provider: UsageRecord['provider'];
    inputTokens: number;
    outputTokens: number;
    cachedTokens?: number | null;
    reasoningTokens?: number | null;
    estimatedCost: number;
    actualCost?: number | null;
    latencyMs: number;
    ttftMs?: number | null;
    status: UsageStatus;
    source?: ResponseSource;
    kind?: UsageRecord['kind'];
    runId?: string;
    step?: number;
    limitUnits?: number;
    premiumCreditUsd?: number;
    fundedBy?: UsageRecord['fundedBy'];
  }): UsageRecord {
    const record: UsageRecord = {
      id: randomUUID(),
      userId: params.userId,
      subscriptionId: params.subscriptionId ?? null,
      conversationId: params.conversationId,
      modelId: params.modelId,
      provider: params.provider,
      inputTokens: params.inputTokens,
      outputTokens: params.outputTokens,
      cachedTokens: params.cachedTokens ?? null,
      reasoningTokens: params.reasoningTokens ?? null,
      estimatedCost: params.estimatedCost,
      actualCost: params.actualCost ?? null,
      latencyMs: params.latencyMs,
      ttftMs: params.ttftMs ?? null,
      status: params.status,
      source: params.source ?? 'provider',
      ...(params.kind ? { kind: params.kind } : {}),
      ...(params.runId ? { runId: params.runId } : {}),
      ...(params.limitUnits && params.limitUnits !== 1 ? { limitUnits: params.limitUnits } : {}),
      ...(params.step !== undefined ? { step: params.step } : {}),
      ...(params.premiumCreditUsd && params.premiumCreditUsd > 0
        ? { premiumCreditUsd: params.premiumCreditUsd }
        : {}),
      ...(params.fundedBy ? { fundedBy: params.fundedBy } : {}),
      createdAt: new Date().toISOString(),
    };

    this.records.push(record);
    let userRecords = this.userIndex.get(record.userId);
    if (!userRecords) {
      userRecords = [];
      this.userIndex.set(record.userId, userRecords);
    }
    userRecords.push(record);

    // Ограничиваем историю в памяти/файле (последние 50,000 записей)
    if (this.records.length > MAX_RECORDS) {
      this.records = this.records.slice(-MAX_RECORDS);
      this.rebuildIndex();
    }

    try {
      this.persist();
    } catch (err) {
      console.error('[usage-store] Ошибка сохранения usage:', err);
    }
    this.dbDriver?.upsert(this.namespace, record).catch((error: unknown) => {
      console.error('[db] Ошибка записи usage:', error);
    });

    return record;
  }

  /**
   * Захватить слот одновременного запроса для пользователя.
   * Возвращает функцию освобождения слота.
   */
  acquireConcurrencySlot(userId: string): () => void {
    const current = this.activeConcurrency.get(userId) ?? 0;
    this.activeConcurrency.set(userId, current + 1);

    let released = false;
    return () => {
      if (released) return;
      released = true;
      const count = this.activeConcurrency.get(userId) ?? 1;
      if (count <= 1) {
        this.activeConcurrency.delete(userId);
      } else {
        this.activeConcurrency.set(userId, count - 1);
      }
    };
  }

  /** Получить текущее количество активных параллельных запросов юзера. */
  getActiveConcurrency(userId: string): number {
    return this.activeConcurrency.get(userId) ?? 0;
  }

  /**
   * Сформировать мгновенный снимок активности пользователя для Fair Use проверки.
   */
  getFairUseSnapshot(userId: string): FairUseSnapshot {
    const userRecords = this.userIndex.get(userId) ?? [];
    if (userRecords.length === 0) {
      return {
        userId,
        requestsLastMinute: 0,
        requestsLastHour: 0,
        requestsLastDay: 0,
        tokensLastHour: 0,
        tokensLastDay: 0,
        estimatedCostLastDay: 0,
        estimatedCostLastMonth: 0,
        activeConcurrentRequests: this.getActiveConcurrency(userId),
      };
    }

    const now = Date.now();
    const oneMinuteAgo = now - 60 * 1000;
    const oneHourAgo = now - 60 * 60 * 1000;
    const oneDayAgo = now - 24 * 60 * 60 * 1000;
    const oneMonthAgo = now - 30 * 24 * 60 * 60 * 1000;

    let requestsLastMinute = 0;
    let requestsLastHour = 0;
    let requestsLastDay = 0;
    let tokensLastHour = 0;
    let tokensLastDay = 0;
    let estimatedCostLastDay = 0;
    let estimatedCostLastMonth = 0;

    for (let i = userRecords.length - 1; i >= 0; i--) {
      const rec = userRecords[i];
      const time = new Date(rec.createdAt).getTime();
      if (time < oneMonthAgo) break;

      // У шагов агента контекст повторно уходит на каждом шаге, а читается он из кэша почти
      // бесплатно, поэтому в квоту токенов идёт только «свежая» часть входа и ответ.
      const totalTokens =
        rec.kind === 'agent'
          ? Math.max(0, rec.inputTokens - (rec.cachedTokens ?? 0)) + rec.outputTokens
          : rec.inputTokens + rec.outputTokens;
      // Отказанные и упавшие запросы не потребляют лимит: иначе каждый отказ продлевал бы блокировку
      // (пользователь упёрся в лимит → отказ записался → лимит «не отпускает»), а сбой провайдера
      // списывал бы с человека сообщение, которого он не получил.
      const countsTowardLimits =
        rec.status !== 'rate_limited' &&
        rec.status !== 'concurrency_limited' &&
        rec.status !== 'error';
      // Шаги агента не считаются «сообщениями» (их десятки на запуск и у них свой дневной лимит
      // запусков), но токены и стоимость учитываются как у любого запроса.
      const countsAsMessage =
        countsTowardLimits && rec.kind !== 'agent' && rec.kind !== 'image' && rec.kind !== 'review';

      if (countsAsMessage && time >= oneMinuteAgo) requestsLastMinute++;
      if (countsTowardLimits && time >= oneHourAgo) {
        if (countsAsMessage) requestsLastHour++;
        tokensLastHour += totalTokens;
      }
      // Часть, оплаченная кредитами пакета, в бюджет тарифа не входит: пакет оплачен отдельно.
      const planCost = rec.estimatedCost - (rec.premiumCreditUsd ?? 0);
      if (time >= oneDayAgo) {
        if (countsAsMessage) requestsLastDay++;
        if (countsTowardLimits) {
          tokensLastDay += totalTokens;
        }
        estimatedCostLastDay += planCost;
      }
      if (time >= oneMonthAgo) {
        estimatedCostLastMonth += planCost;
      }
    }

    return {
      userId,
      requestsLastMinute,
      requestsLastHour,
      requestsLastDay,
      tokensLastHour,
      tokensLastDay,
      estimatedCostLastDay: Number(estimatedCostLastDay.toFixed(4)),
      estimatedCostLastMonth: Number(estimatedCostLastMonth.toFixed(4)),
      activeConcurrentRequests: this.getActiveConcurrency(userId),
    };
  }

  /**
   * Расход пользователя за скользящие 30 дней по заданным моделям.
   * Нужен квоте премиум-запросов: сильные модели ограничены отдельным бюджетом тарифа.
   * Берётся фактическая стоимость от провайдера, а если её нет — расчётная; часть, оплаченная
   * кредитами пакета, в квоту тарифа не входит.
   */
  getCostLastMonthByModels(userId: string, modelIds: Iterable<string>): number {
    const wanted = new Set(modelIds);
    if (wanted.size === 0) return 0;
    const userRecords = this.userIndex.get(userId) ?? [];
    const since = Date.now() - 30 * 24 * 60 * 60 * 1000;
    let total = 0;
    for (let i = userRecords.length - 1; i >= 0; i--) {
      const rec = userRecords[i];
      if (new Date(rec.createdAt).getTime() < since) break;
      if (wanted.has(rec.modelId)) {
        total += (rec.actualCost ?? rec.estimatedCost) - (rec.premiumCreditUsd ?? 0);
      }
    }
    return Number(total.toFixed(6));
  }

  /**
   * Траты пользователя за последние `windowMs` по заданным моделям (все модели, если null), старые
   * первыми. По ним видно, когда скользящая квота вернётся: траты выпадают из окна по очереди.
   */
  getCostEvents(
    userId: string,
    modelIds: Iterable<string> | null,
    windowMs: number,
  ): Array<{ at: number; cost: number }> {
    const wanted = modelIds ? new Set(modelIds) : null;
    const userRecords = this.userIndex.get(userId) ?? [];
    const since = Date.now() - windowMs;
    const events: Array<{ at: number; cost: number }> = [];
    for (let i = userRecords.length - 1; i >= 0; i--) {
      const rec = userRecords[i];
      const at = new Date(rec.createdAt).getTime();
      if (at < since) break;
      if (wanted && !wanted.has(rec.modelId)) continue;
      const cost =
        (wanted ? (rec.actualCost ?? rec.estimatedCost) : rec.estimatedCost) -
        (rec.premiumCreditUsd ?? 0);
      if (cost > 0) events.push({ at, cost });
    }
    return events.reverse();
  }

  private observedCostCache: { at: number; byModel: Map<string, number> } | null = null;

  /**
   * Средняя фактическая цена запроса модели за 30 дней по всем пользователям, если запросов
   * набралось не меньше 20 (иначе null: оценке по таблице цен верить больше, чем трём запросам).
   * Пересчитывается не чаще раза в 10 минут.
   */
  getObservedRequestCost(modelId: string): number | null {
    const now = Date.now();
    if (!this.observedCostCache || now - this.observedCostCache.at > 10 * 60 * 1000) {
      const byModel = new Map<string, number>();
      for (const metric of this.getModelUsage30d({ now })) {
        if (metric.requests >= 20) byModel.set(metric.modelId, metric.avgCostPerRequest);
      }
      this.observedCostCache = { at: now, byModel };
    }
    return this.observedCostCache.byModel.get(modelId) ?? null;
  }

  /** Сколько картинок модели пользователь сгенерировал за последние 24 часа (успешных). */
  getImagesLastDay(userId: string, modelId: string): number {
    const userRecords = this.userIndex.get(userId) ?? [];
    const since = Date.now() - 24 * 60 * 60 * 1000;
    let count = 0;
    for (let i = userRecords.length - 1; i >= 0; i--) {
      const rec = userRecords[i];
      if (new Date(rec.createdAt).getTime() < since) break;
      if (rec.kind === 'image' && rec.modelId === modelId && rec.status === 'success') count += 1;
    }
    return count;
  }

  /** Сколько единиц суточного лимита моделей израсходовано за последние 24 часа. */
  getModelUsesLastDay(userId: string, modelIds: Iterable<string>): number {
    return this.getModelUsesSince(userId, modelIds, DAY_MS);
  }

  /** Сколько единиц лимита моделей израсходовано за последние `windowMs` (см. getModelUseEvents). */
  getModelUsesSince(userId: string, modelIds: Iterable<string>, windowMs: number): number {
    return this.getModelUseEvents(userId, modelIds, windowMs).reduce((sum, e) => sum + e.units, 0);
  }

  /**
   * Использования моделей за последние `windowMs`, старые первыми: когда и сколько единиц лимита.
   * Нужны лимитам моделей (суточным и недельному пулу) и подсказке «когда восстановится».
   *
   * Считаются ответы провайдера (успешные и прерванные пользователем: токены уже потрачены), но
   * не кэш, не отказы и не сбои. Запуск агента считается один раз (по наибольшему весу его записей,
   * по времени первой записи), сколько бы шагов он ни сделал. Запросы за счёт кредитов пакета
   * (`fundedBy: 'credits'`) в лимиты моделей не входят.
   */
  getModelUseEvents(
    userId: string,
    modelIds: Iterable<string>,
    windowMs: number,
  ): Array<{ at: number; units: number }> {
    const wanted = new Set(modelIds);
    if (wanted.size === 0) return [];
    const userRecords = this.userIndex.get(userId) ?? [];
    const since = Date.now() - windowMs;
    const events: Array<{ at: number; units: number }> = [];
    const runs = new Map<string, { at: number; units: number }>();
    for (let i = userRecords.length - 1; i >= 0; i--) {
      const rec = userRecords[i];
      const at = new Date(rec.createdAt).getTime();
      if (at < since) break;
      if (!wanted.has(rec.modelId) || rec.fundedBy === 'credits') continue;
      // Проверки ответов считаются своим суточным лимитом, а не лимитом модели-рецензента.
      if (rec.kind === 'review') continue;
      const units = rec.limitUnits ?? 1;
      if (rec.kind === 'agent') {
        if (!rec.runId) continue;
        const run = runs.get(rec.runId);
        runs.set(rec.runId, {
          at: Math.min(run?.at ?? at, at),
          units: Math.max(run?.units ?? 0, units),
        });
        continue;
      }
      if (rec.source !== 'provider') continue;
      if (rec.status === 'success' || rec.status === 'cancelled') events.push({ at, units });
    }
    events.push(...runs.values());
    return events.sort((a, b) => a.at - b.at);
  }

  /**
   * Сколько запусков агента пользователь начал за последние 24 часа. Запуск отмечается записью
   * нулевого шага в момент старта, поэтому отменённый сразу после старта запуск тоже считается.
   */
  getAgentRunsLastDay(userId: string): number {
    const userRecords = this.userIndex.get(userId) ?? [];
    const since = Date.now() - 24 * 60 * 60 * 1000;
    const runs = new Set<string>();
    for (let i = userRecords.length - 1; i >= 0; i--) {
      const rec = userRecords[i];
      if (new Date(rec.createdAt).getTime() < since) break;
      if (rec.kind === 'agent' && rec.runId) runs.add(rec.runId);
    }
    return runs.size;
  }

  /**
   * Сколько проверок ответов (чат и Ketner Code) пользователь сделал за последние 24 часа.
   * Считаются только состоявшиеся: отказ или сбой рецензента проверку не расходуют.
   */
  getReviewsLastDay(userId: string): number {
    const userRecords = this.userIndex.get(userId) ?? [];
    const since = Date.now() - 24 * 60 * 60 * 1000;
    const reviews = new Set<string>();
    for (let i = userRecords.length - 1; i >= 0; i--) {
      const rec = userRecords[i];
      if (new Date(rec.createdAt).getTime() < since) break;
      if (rec.kind === 'review' && rec.status === 'success') reviews.add(rec.runId ?? rec.id);
    }
    return reviews.size;
  }

  /**
   * Получить последние записи использования для пользователя.
   */
  getByUser(userId: string, limit = 50): UsageRecord[] {
    const userRecords = this.userIndex.get(userId) ?? [];
    return userRecords.slice(-limit).reverse();
  }

  /**
   * Общая статистика по пользователю.
   */
  getUserStats(userId: string): UsageStats {
    const userRecords = this.userIndex.get(userId) ?? [];
    return this.aggregateStats(userRecords);
  }

  /**
   * Общая статистика системы за период.
   */
  getGlobalStats(fromDate?: string, toDate?: string): UsageStats {
    let filtered = this.records;
    if (fromDate) {
      const from = new Date(fromDate).getTime();
      filtered = filtered.filter((r) => new Date(r.createdAt).getTime() >= from);
    }
    if (toDate) {
      const to = new Date(toDate).getTime();
      filtered = filtered.filter((r) => new Date(r.createdAt).getTime() <= to);
    }
    return this.aggregateStats(filtered);
  }

  /**
   * Расчёт рентабельности подписки пользователя за последние 30 дней.
   */
  getUserProfitability(userId: string, planPriceMonthlyUsd: number): UserProfitability {
    const snapshot = this.getFairUseSnapshot(userId);
    const aiCost = snapshot.estimatedCostLastMonth;
    const subscriptionRevenue = planPriceMonthlyUsd;
    const contributionMargin = subscriptionRevenue - aiCost;

    let status: UserProfitability['status'] = 'profitable';
    if (contributionMargin < 0) {
      status = 'loss_making';
    } else if (contributionMargin < subscriptionRevenue * 0.2) {
      status = 'low_margin';
    }

    const now = new Date();
    const from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    return {
      userId,
      subscriptionRevenue,
      aiCost: Number(aiCost.toFixed(2)),
      contributionMargin: Number(contributionMargin.toFixed(2)),
      status,
      period: {
        from: from.toISOString(),
        to: now.toISOString(),
      },
    };
  }

  /**
   * Метрики по каждому провайдеру для мониторинга.
   */
  getProviderStats(): ProviderStatus[] {
    // OpenRouter всегда в списке; прямые API вендоров — если через них уже шли запросы.
    const providers = [
      ...new Set<UsageRecord['provider']>(['openrouter', ...this.records.map((r) => r.provider)]),
    ];

    return providers.map((provider) => {
      const recs = this.records.filter((r) => r.provider === provider);
      const totalRequests = recs.length;
      const errorCount = recs.filter((r) => r.status === 'error').length;
      const totalCost = recs.reduce((sum, r) => sum + r.estimatedCost, 0);
      const totalLatency = recs.reduce((sum, r) => sum + r.latencyMs, 0);

      return {
        provider,
        available: true,
        averageLatencyMs: totalRequests > 0 ? Math.round(totalLatency / totalRequests) : 0,
        errorRate: totalRequests > 0 ? Number((errorCount / totalRequests).toFixed(3)) : 0,
        totalRequests,
        totalCost: Number(totalCost.toFixed(4)),
      };
    });
  }

  private aggregateStats(records: UsageRecord[]): UsageStats {
    const totalRequests = records.length;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalEstimatedCost = 0;
    let totalActualCost = 0;
    let totalLatency = 0;

    for (const r of records) {
      totalInputTokens += r.inputTokens;
      totalOutputTokens += r.outputTokens;
      totalEstimatedCost += r.estimatedCost;
      totalActualCost += r.actualCost ?? r.estimatedCost;
      totalLatency += r.latencyMs;
    }

    return {
      totalRequests,
      totalInputTokens,
      totalOutputTokens,
      totalEstimatedCost: Number(totalEstimatedCost.toFixed(4)),
      totalActualCost: Number(totalActualCost.toFixed(4)),
      averageLatencyMs: totalRequests > 0 ? Math.round(totalLatency / totalRequests) : 0,
    };
  }

  /**
   * Phase 3: Пересчёт эмпирического бюджета тарифа по реальным накопленным данным расходов.
   * Возвращает агрегаты по тарифам и рекомендуемый costBudget на основе 95-го перцентиля расходов.
   */
  getEmpiricalPlanBudget(planUsers: Array<{ userId: string; plan: string }>): Record<
    string,
    {
      userCount: number;
      avgMonthlyCost: number;
      p95MonthlyCost: number;
      recommendedCostBudget: number;
    }
  > {
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const planToUserCosts = new Map<string, number[]>();

    for (const { userId, plan } of planUsers) {
      const userRecs = (this.userIndex.get(userId) ?? []).filter(
        (r) => new Date(r.createdAt).getTime() >= thirtyDaysAgo,
      );
      const userCost = userRecs.reduce((sum, r) => sum + r.estimatedCost, 0);
      let list = planToUserCosts.get(plan);
      if (!list) {
        list = [];
        planToUserCosts.set(plan, list);
      }
      list.push(userCost);
    }

    const result: Record<
      string,
      {
        userCount: number;
        avgMonthlyCost: number;
        p95MonthlyCost: number;
        recommendedCostBudget: number;
      }
    > = {};

    for (const [plan, costs] of planToUserCosts.entries()) {
      costs.sort((a, b) => a - b);
      const userCount = costs.length;
      const sum = costs.reduce((a, b) => a + b, 0);
      const avg = userCount > 0 ? sum / userCount : 0;
      const p95Idx = Math.floor(userCount * 0.95);
      const p95 = userCount > 0 ? (costs[p95Idx] ?? costs[costs.length - 1] ?? 0) : 0;
      const recommended = Number(Math.max(avg * 1.5, p95).toFixed(2));

      result[plan] = {
        userCount,
        avgMonthlyCost: Number(avg.toFixed(4)),
        p95MonthlyCost: Number(p95.toFixed(4)),
        recommendedCostBudget: recommended,
      };
    }

    return result;
  }

  /**
   * Сводка по каждой модели за скользящие 30 дней: число запросов, средний вход и выход, доля
   * кэшированных токенов, средняя цена запроса и доли тарифов в расходе на модель.
   *
   * Считаются только ответы провайдера (успешные и прерванные: токены оплачены). Семантический кэш
   * не входит: у его ответов вход целиком помечен как «кэш», и он скрыл бы, срабатывает ли кэш
   * промпта у самого провайдера. Картинки тоже не входят: у них нет токенов.
   *
   * Вердикт по кэшу (`cacheStatus`) строится по длинным запросам — тем, чей вход не короче порога
   * кэша вендора: у коротких кэша не бывает в принципе.
   */
  getModelUsage30d(
    params: {
      userPlans?: ReadonlyMap<string, string>;
      describeModel?: (modelId: string) => ModelDescriptor;
      now?: number;
    } = {},
  ): ModelUsageMetric[] {
    const since = (params.now ?? Date.now()) - 30 * DAY_MS;
    const describe = params.describeModel ?? ((id: string) => ({ name: null, engineId: id }));
    const byModel = new Map<
      string,
      {
        requests: number;
        input: number;
        output: number;
        cached: number;
        cost: number;
        eligible: number;
        eligibleHits: number;
        costByPlan: Map<string, number>;
      }
    >();
    const minTokensOf = new Map<string, number>();

    for (const r of this.records) {
      if (new Date(r.createdAt).getTime() < since) continue;
      if (r.kind === 'image' || (r.source ?? 'provider') !== 'provider') continue;
      if (r.status !== 'success' && r.status !== 'cancelled') continue;
      if (r.inputTokens <= 0 && r.outputTokens <= 0) continue;

      let entry = byModel.get(r.modelId);
      if (!entry) {
        entry = {
          requests: 0,
          input: 0,
          output: 0,
          cached: 0,
          cost: 0,
          eligible: 0,
          eligibleHits: 0,
          costByPlan: new Map(),
        };
        byModel.set(r.modelId, entry);
        minTokensOf.set(r.modelId, promptCachePolicy(describe(r.modelId).engineId).minTokens);
      }
      const cached = Math.min(r.inputTokens, Math.max(0, r.cachedTokens ?? 0));
      entry.requests += 1;
      entry.input += r.inputTokens;
      entry.output += r.outputTokens;
      entry.cached += cached;
      entry.cost += r.estimatedCost;
      if (r.inputTokens >= (minTokensOf.get(r.modelId) ?? Infinity)) {
        entry.eligible += 1;
        if (cached > 0) entry.eligibleHits += 1;
      }
      const plan = params.userPlans?.get(r.userId) ?? 'free';
      entry.costByPlan.set(plan, (entry.costByPlan.get(plan) ?? 0) + r.estimatedCost);
    }

    return [...byModel.entries()]
      .map(([modelId, m]): ModelUsageMetric => {
        const model = describe(modelId);
        const policy = promptCachePolicy(model.engineId);
        let cacheStatus: ModelUsageMetric['cacheStatus'];
        if (policy.mode === 'none') cacheStatus = 'not_expected';
        else if (m.eligible < CACHE_VERDICT_MIN_REQUESTS) cacheStatus = 'no_data';
        else
          cacheStatus =
            m.eligibleHits / m.eligible >= CACHE_WORKING_MIN_HIT_RATE ? 'working' : 'not_working';
        const costShareByPlanPct: Record<string, number> = {};
        for (const [plan, cost] of m.costByPlan) costShareByPlanPct[plan] = pct(cost, m.cost);
        return {
          modelId,
          name: model.name,
          vendor: vendorOf(model.engineId),
          requests: m.requests,
          avgInputTokens: Math.round(m.input / m.requests),
          avgOutputTokens: Math.round(m.output / m.requests),
          cachedTokenSharePct: pct(m.cached, m.input),
          cacheHitRequestsPct: pct(m.eligibleHits, m.eligible),
          cacheEligibleRequests: m.eligible,
          cacheStatus,
          avgCostPerRequest: Number((m.cost / m.requests).toFixed(6)),
          totalCost: Number(m.cost.toFixed(4)),
          costShareByPlanPct,
        };
      })
      .sort((a, b) => b.totalCost - a.totalCost);
  }

  /**
   * Phase 4: Комплексные метрики шлюза для дашборда администратора (/api/admin/metrics).
   * Включает:
   * - Стоимость по источникам (cache vs provider vs template)
   * - Стоимость по моделям
   * - Cache hit rate (в процентах)
   * - Задержки: средняя задержка, P95, средний TTFT и P95 TTFT
   * - Распределение расходов по тарифам (Free, Plus, Pro, Ultra)
   * - Алерты по отрицательной маржинальности (contributionMargin < 0)
   */
  getGatewayMetrics(params?: {
    fromDate?: string;
    toDate?: string;
    users?: Array<{ id: string; email: string; plan: string; isVip?: boolean }>;
    planPricesRub?: Record<string, number>;
    planPricesUsd?: Record<string, number>;
    rubToUsdRate?: number;
    describeModel?: (modelId: string) => ModelDescriptor;
  }): GatewayMetrics {
    let records = this.records;
    if (params?.fromDate) {
      const from = new Date(params.fromDate).getTime();
      records = records.filter((r) => new Date(r.createdAt).getTime() >= from);
    }
    if (params?.toDate) {
      const to = new Date(params.toDate).getTime();
      records = records.filter((r) => new Date(r.createdAt).getTime() <= to);
    }

    const totalRequests = records.length;
    let totalCost = 0;

    // 1. По источникам (provider, cache, template)
    const sourceMap: Record<'provider' | 'cache' | 'template', SourceMetrics> = {
      provider: { cost: 0, requests: 0, inputTokens: 0, outputTokens: 0 },
      cache: { cost: 0, requests: 0, inputTokens: 0, outputTokens: 0 },
      template: { cost: 0, requests: 0, inputTokens: 0, outputTokens: 0 },
    };

    // 2. По моделям
    const modelMap = new Map<
      string,
      {
        modelId: string;
        cost: number;
        requests: number;
        inputTokens: number;
        outputTokens: number;
        totalLatency: number;
      }
    >();

    // 3. Задержки и TTFT
    const latencies: number[] = [];
    const ttfts: number[] = [];

    // 4. Распределение по тарифам
    const userPlanMap = new Map<string, string>();
    if (params?.users) {
      for (const u of params.users) {
        userPlanMap.set(u.id, u.plan);
      }
    }

    const planCostMap = new Map<
      string,
      {
        plan: string;
        totalCost: number;
        userIds: Set<string>;
        requests: number;
        totalTokens: number;
      }
    >();

    for (const r of records) {
      totalCost += r.estimatedCost;

      const src = (r.source ?? 'provider') as 'provider' | 'cache' | 'template';
      if (sourceMap[src]) {
        sourceMap[src].cost += r.estimatedCost;
        sourceMap[src].requests += 1;
        sourceMap[src].inputTokens += r.inputTokens;
        sourceMap[src].outputTokens += r.outputTokens;
      }

      let modelEntry = modelMap.get(r.modelId);
      if (!modelEntry) {
        modelEntry = {
          modelId: r.modelId,
          cost: 0,
          requests: 0,
          inputTokens: 0,
          outputTokens: 0,
          totalLatency: 0,
        };
        modelMap.set(r.modelId, modelEntry);
      }
      modelEntry.cost += r.estimatedCost;
      modelEntry.requests += 1;
      modelEntry.inputTokens += r.inputTokens;
      modelEntry.outputTokens += r.outputTokens;
      modelEntry.totalLatency += r.latencyMs;

      latencies.push(r.latencyMs);
      if (typeof r.ttftMs === 'number') {
        ttfts.push(r.ttftMs);
      }

      const userPlan = userPlanMap.get(r.userId) ?? 'free';
      let planEntry = planCostMap.get(userPlan);
      if (!planEntry) {
        planEntry = {
          plan: userPlan,
          totalCost: 0,
          userIds: new Set(),
          requests: 0,
          totalTokens: 0,
        };
        planCostMap.set(userPlan, planEntry);
      }
      planEntry.totalCost += r.estimatedCost;
      planEntry.userIds.add(r.userId);
      planEntry.requests += 1;
      planEntry.totalTokens += r.inputTokens + r.outputTokens;
    }

    // Округление сумм по источникам
    const costBySource = {
      provider: {
        cost: Number(sourceMap.provider.cost.toFixed(4)),
        requests: sourceMap.provider.requests,
        inputTokens: sourceMap.provider.inputTokens,
        outputTokens: sourceMap.provider.outputTokens,
      },
      cache: {
        cost: Number(sourceMap.cache.cost.toFixed(4)),
        requests: sourceMap.cache.requests,
        inputTokens: sourceMap.cache.inputTokens,
        outputTokens: sourceMap.cache.outputTokens,
      },
      template: {
        cost: Number(sourceMap.template.cost.toFixed(4)),
        requests: sourceMap.template.requests,
        inputTokens: sourceMap.template.inputTokens,
        outputTokens: sourceMap.template.outputTokens,
      },
    };

    // Cache hit rate
    const cacheHits = sourceMap.cache.requests;
    const cacheHitRatePct =
      totalRequests > 0 ? Number(((cacheHits / totalRequests) * 100).toFixed(2)) : 0;

    // Сортировка моделей по затратам
    const costByModel: ModelMetric[] = Array.from(modelMap.values())
      .map((m) => ({
        modelId: m.modelId,
        cost: Number(m.cost.toFixed(4)),
        requests: m.requests,
        inputTokens: m.inputTokens,
        outputTokens: m.outputTokens,
        averageLatencyMs: m.requests > 0 ? Math.round(m.totalLatency / m.requests) : 0,
      }))
      .sort((a, b) => b.cost - a.cost);

    // Задержки и TTFT
    latencies.sort((a, b) => a - b);
    ttfts.sort((a, b) => a - b);
    const avgLatency =
      latencies.length > 0
        ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
        : 0;
    const p95Latency =
      latencies.length > 0
        ? (latencies[Math.floor(latencies.length * 0.95)] ?? latencies[latencies.length - 1])
        : 0;
    const avgTtft =
      ttfts.length > 0 ? Math.round(ttfts.reduce((a, b) => a + b, 0) / ttfts.length) : null;
    const p95Ttft =
      ttfts.length > 0 ? (ttfts[Math.floor(ttfts.length * 0.95)] ?? ttfts[ttfts.length - 1]) : null;

    const latency: LatencyBreakdown = {
      averageLatencyMs: avgLatency,
      p95LatencyMs: p95Latency,
      averageTtftMs: avgTtft,
      p95TtftMs: p95Ttft,
    };

    // Распределение по тарифам
    const costByPlan: PlanCostMetric[] = Array.from(planCostMap.values())
      .map((p) => {
        const usersCount = p.userIds.size;
        return {
          plan: p.plan,
          totalCost: Number(p.totalCost.toFixed(4)),
          usersCount,
          requests: p.requests,
          totalTokens: p.totalTokens,
          averageCostPerUser: usersCount > 0 ? Number((p.totalCost / usersCount).toFixed(4)) : 0,
          costSharePct: pct(p.totalCost, totalCost),
        };
      })
      .sort((a, b) => b.totalCost - a.totalCost);

    // Алерты по отрицательной маржинальности
    const alerts: MetricAlert[] = [];
    const rubToUsd = params?.rubToUsdRate ?? 0.0105;

    if (params?.users && (params?.planPricesUsd || params?.planPricesRub)) {
      for (const u of params.users) {
        if (u.plan === 'free') continue;
        const revenueUsd =
          params.planPricesUsd && params.planPricesUsd[u.plan] !== undefined
            ? params.planPricesUsd[u.plan]
            : (params.planPricesRub?.[u.plan] ?? 0) * rubToUsd;

        const userRecs = this.userIndex.get(u.id) ?? [];
        const userAiCost = userRecs.reduce((sum, r) => sum + r.estimatedCost, 0);
        const margin = revenueUsd - userAiCost;

        if (margin < 0) {
          const alert: MetricAlert = {
            type: 'negative_margin',
            userId: u.id,
            userEmail: u.email,
            plan: u.plan,
            contributionMargin: Number(margin.toFixed(2)),
            aiCost: Number(userAiCost.toFixed(2)),
            subscriptionRevenue: Number(revenueUsd.toFixed(2)),
            message: `Отрицательная маржинальность (-$${Math.abs(margin).toFixed(2)}) у пользователя ${u.email} на тарифе ${u.plan}`,
          };
          alerts.push(alert);
          console.warn(`[admin:alert] ${alert.message}`);
        }
      }
    }

    return {
      totalRequests,
      totalCost: Number(totalCost.toFixed(4)),
      cacheHitRatePct,
      cacheHits,
      costBySource,
      costByModel,
      costByPlan,
      models30d: this.getModelUsage30d({
        userPlans: userPlanMap,
        describeModel: params?.describeModel,
      }),
      latency,
      alerts,
      hasNegativeMarginAlert: alerts.length > 0,
    };
  }
}
