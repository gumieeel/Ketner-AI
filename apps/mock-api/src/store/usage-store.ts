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
  ProviderStatus,
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
  private activeConcurrency = new Map<string, number>();

  constructor(filePath: string) {
    this.filePath = filePath;
    this.load();
  }

  private load(): void {
    if (!existsSync(this.filePath)) {
      this.records = [];
      return;
    }

    try {
      const raw = readFileSync(this.filePath, 'utf-8');
      const data = JSON.parse(raw) as UsageStoreData;
      this.records = Array.isArray(data.records) ? data.records : [];
    } catch {
      this.records = [];
    }
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
    status: UsageStatus;
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
      status: params.status,
      createdAt: new Date().toISOString(),
    };

    this.records.push(record);

    // Ограничиваем историю в памяти/файле (последние 50,000 записей)
    if (this.records.length > 50000) {
      this.records = this.records.slice(-50000);
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

    for (let i = this.records.length - 1; i >= 0; i--) {
      const rec = this.records[i];
      if (rec.userId !== userId) continue;

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
    return this.records
      .filter((r) => r.userId === userId)
      .slice(-limit)
      .reverse();
  }

  /**
   * Общая статистика по пользователю.
   */
  getUserStats(userId: string): UsageStats {
    return this.aggregateStats(this.records.filter((r) => r.userId === userId));
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
}
