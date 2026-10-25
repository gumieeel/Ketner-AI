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
  PlanCostMetric,
  ProviderStatus,
  ResponseSource,
  SourceMetrics,
  UsageRecord,
  UsageStats,
  UsageStatus,
  UserProfitability,
} from '../ai/gateway-types.js';

interface UsageStoreData {
  records: UsageRecord[];
}

export class UsageStore {
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
    if (this.records.length > 50000) {
      this.records = this.records.slice(-50000);
      this.rebuildIndex();
    }

    try {
      this.persist();
    } catch (err) {
      console.error('[usage-store] Ошибка сохранения usage:', err);
    }

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

      const totalTokens = rec.inputTokens + rec.outputTokens;

      if (time >= oneMinuteAgo) requestsLastMinute++;
      if (time >= oneHourAgo) {
        requestsLastHour++;
        tokensLastHour += totalTokens;
      }
      if (time >= oneDayAgo) {
        requestsLastDay++;
        tokensLastDay += totalTokens;
        estimatedCostLastDay += rec.estimatedCost;
      }
      if (time >= oneMonthAgo) {
        estimatedCostLastMonth += rec.estimatedCost;
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
    const providers: UsageRecord['provider'][] = ['openai', 'anthropic', 'google', 'openrouter'];

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
  getEmpiricalPlanBudget(planUsers: Array<{ userId: string; plan: string }>): Record<string, {
    userCount: number;
    avgMonthlyCost: number;
    p95MonthlyCost: number;
    recommendedCostBudget: number;
  }> {
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

    const result: Record<string, {
      userCount: number;
      avgMonthlyCost: number;
      p95MonthlyCost: number;
      recommendedCostBudget: number;
    }> = {};

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
    const modelMap = new Map<string, {
      modelId: string;
      cost: number;
      requests: number;
      inputTokens: number;
      outputTokens: number;
      totalLatency: number;
    }>();

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

    const planCostMap = new Map<string, {
      plan: string;
      totalCost: number;
      userIds: Set<string>;
      requests: number;
      totalTokens: number;
    }>();

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
      latencies.length > 0 ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0;
    const p95Latency =
      latencies.length > 0
        ? latencies[Math.floor(latencies.length * 0.95)] ?? latencies[latencies.length - 1]
        : 0;
    const avgTtft =
      ttfts.length > 0 ? Math.round(ttfts.reduce((a, b) => a + b, 0) / ttfts.length) : null;
    const p95Ttft =
      ttfts.length > 0
        ? ttfts[Math.floor(ttfts.length * 0.95)] ?? ttfts[ttfts.length - 1]
        : null;

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
          averageCostPerUser:
            usersCount > 0 ? Number((p.totalCost / usersCount).toFixed(4)) : 0,
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
      latency,
      alerts,
      hasNegativeMarginAlert: alerts.length > 0,
    };
  }
}
