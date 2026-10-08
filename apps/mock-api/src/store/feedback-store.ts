import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { FeedbackRating } from '../types.js';

export type PromptComplexityLevel = 'simple' | 'moderate' | 'complex';

export interface FeedbackRecord {
  id: string;
  messageId: string;
  conversationId: string;
  userId?: string;
  modelId: string; // Запрошенная модель (например: 'gpt-6.1-sol', 'claude-opus-5.5')
  engineModelId?: string; // Реально исполненный движок (например: 'openai/gpt-6-luna', 'anthropic/claude-opus-5.5')
  complexityLevel?: PromptComplexityLevel;
  rating: FeedbackRating;
  reason?: string;
  comment?: string;
  createdAt: string;
}

export interface FeedbackSummary {
  total: number;
  likes: number;
  dislikes: number;
  satisfactionRate: number; // likes / total (0..1)
  dislikeRate: number; // dislikes / total (0..1)
}

export interface EscalationStatus {
  /** Рекомендовано ли эскалировать простые задачи с лёгких моделей на тяжёлые */
  escalateToHeavyRecommended: boolean;
  /** Активна ли динамическая авто-эскалация прямо сейчас в шлюзе */
  autoEscalateActive: boolean;
  /** Порог процента дизлайков для включения авто-эскалации (по умолчанию 0.25 / 25%) */
  dislikeThreshold: number;
  /** Минимальное количество оценок на лёгких моделях для принятия решения (по умолчанию 3) */
  minSamplesThreshold: number;
  /** Всего оценок на лёгких движках (класс lite: Luna, Haiku, DeepSeek Flash) */
  lightEngineFeedbackCount: number;
  /** Количество дизлайков на лёгких движках */
  lightEngineDislikeCount: number;
  /** Доля дизлайков на лёгких движках (0..1) */
  lightEngineDislikeRate: number;
  /** Рекомендация на русском и английском */
  recommendation: string;
}

export interface FeedbackAnalytics {
  summary: FeedbackSummary;
  byModel: Record<string, FeedbackSummary>;
  byEngine: Record<string, FeedbackSummary>;
  byComplexity: Record<PromptComplexityLevel, FeedbackSummary>;
  escalation: EscalationStatus;
}

export interface RecordFeedbackInput {
  messageId: string;
  conversationId: string;
  userId?: string;
  modelId: string;
  engineModelId?: string;
  complexityLevel?: PromptComplexityLevel;
  rating: FeedbackRating;
  reason?: string;
  comment?: string;
}

/** Идентификаторы движков/моделей, считающихся «лёгкими» в шлюзе (класс lite). */
export const LIGHT_ENGINES = new Set([
  'openai/gpt-6-luna',
  'anthropic/claude-haiku-5.5',
  'deepseek/deepseek-v4.1-flash',
  'ketner-mini',
  'claude-haiku-5.5',
  'deepseek-v4.1-flash',
]);

export interface FeedbackDbDriver {
  onFeedbackRecorded?: (record: FeedbackRecord) => Promise<void> | void;
}

export class FeedbackStore {
  private records: FeedbackRecord[] = [];
  private filePath?: string;
  private dbDriver: FeedbackDbDriver | null = null;
  /** Ручной override для тестов и администрирования */
  private autoEscalateOverride: boolean | null = null;
  /** Порог дизлайков для эскалации (25%) */
  private dislikeThreshold = 0.25;
  /** Минимальное число оценок лёгкой модели для срабатывания авто-эскалации */
  private minSamplesThreshold = 3;

  constructor(filePath?: string) {
    this.filePath = filePath;
    if (filePath) {
      this.load();
    }
  }

  public setDbDriver(driver: FeedbackDbDriver | null): void {
    this.dbDriver = driver;
  }

  public loadExternalFeedbacks(incoming: FeedbackRecord[]): void {
    for (const inc of incoming) {
      const idx = this.records.findIndex((r) => r.messageId === inc.messageId || r.id === inc.id);
      if (idx >= 0) {
        this.records[idx] = inc;
      } else {
        this.records.push(inc);
      }
    }
    this.persist();
  }

  private load(): void {
    if (!this.filePath || !existsSync(this.filePath)) {
      this.records = [];
      return;
    }
    try {
      const data = readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) {
        this.records = parsed;
      } else if (parsed && Array.isArray(parsed.records)) {
        this.records = parsed.records;
      }
    } catch (err) {
      console.warn('[feedback-store] Ошибка чтения файла фидбека, начинаем с пустого:', err);
      this.records = [];
    }
  }

  private persist(): void {
    if (!this.filePath) return;
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      const temporary = `${this.filePath}.tmp`;
      writeFileSync(temporary, JSON.stringify({ records: this.records }, null, 2), 'utf-8');
      renameSync(temporary, this.filePath);
    } catch (err) {
      console.error('[feedback-store] Ошибка сохранения фидбека на диск:', err);
    }
  }

  public recordFeedback(input: RecordFeedbackInput): FeedbackRecord {
    const existingIndex = this.records.findIndex(
      (r) => r.messageId === input.messageId && r.conversationId === input.conversationId,
    );

    const now = new Date().toISOString();

    if (existingIndex >= 0) {
      const updated: FeedbackRecord = {
        ...this.records[existingIndex],
        rating: input.rating,
        reason: input.reason ?? this.records[existingIndex].reason,
        comment: input.comment ?? this.records[existingIndex].comment,
        engineModelId: input.engineModelId ?? this.records[existingIndex].engineModelId,
        complexityLevel: input.complexityLevel ?? this.records[existingIndex].complexityLevel,
      };
      this.records[existingIndex] = updated;
      this.persist();
      this.dbDriver?.onFeedbackRecorded?.({ ...updated })?.catch?.((err) =>
        console.error('[db] Error persisting updated feedback:', err),
      );
      return updated;
    }

    const record: FeedbackRecord = {
      id: randomUUID(),
      messageId: input.messageId,
      conversationId: input.conversationId,
      userId: input.userId,
      modelId: input.modelId,
      engineModelId: input.engineModelId,
      complexityLevel: input.complexityLevel,
      rating: input.rating,
      reason: input.reason,
      comment: input.comment,
      createdAt: now,
    };

    this.records.push(record);
    this.persist();
    this.dbDriver?.onFeedbackRecorded?.({ ...record })?.catch?.((err) =>
      console.error('[db] Error persisting created feedback:', err),
    );
    return record;
  }

  public getFeedback(messageId: string): FeedbackRecord | undefined {
    return this.records.find((r) => r.messageId === messageId);
  }

  public list(): FeedbackRecord[] {
    return [...this.records];
  }

  public clear(): void {
    this.records = [];
    this.autoEscalateOverride = null;
    this.persist();
  }

  public setAutoEscalateOverride(value: boolean | null): void {
    this.autoEscalateOverride = value;
  }

  public setThresholds(dislikeThreshold: number, minSamples: number): void {
    this.dislikeThreshold = dislikeThreshold;
    this.minSamplesThreshold = minSamples;
  }

  /**
   * Принятие решения в реальном времени: нужно ли эскалировать простой запрос с лёгкой модели на тяжёлую?
   *
   * Если лёгкий движок (Luna, Haiku, DeepSeek Flash) получает много дизлайков (dislikeRate >= 25% при min 3 оценках),
   * шлюз повышает глубину размышлений на один шаг (модель пользователя не подменяется).
   */
  public shouldEscalateFromLightModel(
    _requestedModelId?: string,
    _complexity?: PromptComplexityLevel,
  ): boolean {
    if (this.autoEscalateOverride !== null) {
      return this.autoEscalateOverride;
    }

    const lightRecords = this.records.filter((r) => {
      const isLightEngine = r.engineModelId && LIGHT_ENGINES.has(r.engineModelId);
      const isSimpleComplexity = r.complexityLevel === 'simple';
      return isLightEngine || isSimpleComplexity;
    });

    if (lightRecords.length < this.minSamplesThreshold) {
      return false;
    }

    const dislikes = lightRecords.filter((r) => r.rating === 'dislike').length;
    const dislikeRate = dislikes / lightRecords.length;

    return dislikeRate >= this.dislikeThreshold;
  }

  /**
   * Расчёт аналитики по качеству моделей и обоснование решения по эскалации.
   */
  public getAnalytics(options?: { from?: string; to?: string }): FeedbackAnalytics {
    let filtered = this.records;
    if (options?.from) {
      filtered = filtered.filter((r) => r.createdAt >= options.from!);
    }
    if (options?.to) {
      filtered = filtered.filter((r) => r.createdAt <= options.to!);
    }

    const total = filtered.length;
    const likes = filtered.filter((r) => r.rating === 'like').length;
    const dislikes = filtered.filter((r) => r.rating === 'dislike').length;
    const satisfactionRate = total > 0 ? Number((likes / total).toFixed(4)) : 1;
    const dislikeRate = total > 0 ? Number((dislikes / total).toFixed(4)) : 0;

    const summary: FeedbackSummary = {
      total,
      likes,
      dislikes,
      satisfactionRate,
      dislikeRate,
    };

    const calcGroup = (records: FeedbackRecord[]): FeedbackSummary => {
      const count = records.length;
      const l = records.filter((r) => r.rating === 'like').length;
      const d = records.filter((r) => r.rating === 'dislike').length;
      return {
        total: count,
        likes: l,
        dislikes: d,
        satisfactionRate: count > 0 ? Number((l / count).toFixed(4)) : 1,
        dislikeRate: count > 0 ? Number((d / count).toFixed(4)) : 0,
      };
    };

    // Группировка по requested model
    const byModel: Record<string, FeedbackSummary> = {};
    for (const r of filtered) {
      if (!byModel[r.modelId]) {
        const modelRecords = filtered.filter((item) => item.modelId === r.modelId);
        byModel[r.modelId] = calcGroup(modelRecords);
      }
    }

    // Группировка по фактическому движку
    const byEngine: Record<string, FeedbackSummary> = {};
    for (const r of filtered) {
      const engineKey = r.engineModelId || 'default';
      if (!byEngine[engineKey]) {
        const engineRecords = filtered.filter((item) => (item.engineModelId || 'default') === engineKey);
        byEngine[engineKey] = calcGroup(engineRecords);
      }
    }

    // Группировка по сложности промпта
    const byComplexity: Record<PromptComplexityLevel, FeedbackSummary> = {
      simple: calcGroup(filtered.filter((r) => r.complexityLevel === 'simple')),
      moderate: calcGroup(filtered.filter((r) => r.complexityLevel === 'moderate')),
      complex: calcGroup(filtered.filter((r) => r.complexityLevel === 'complex')),
    };

    // Оценка производительности лёгких моделей
    const lightRecords = filtered.filter((r) => {
      const isLightEngine = r.engineModelId && LIGHT_ENGINES.has(r.engineModelId);
      const isSimpleComplexity = r.complexityLevel === 'simple';
      return isLightEngine || isSimpleComplexity;
    });

    const lightCount = lightRecords.length;
    const lightDislikes = lightRecords.filter((r) => r.rating === 'dislike').length;
    const lightDislikeRate = lightCount > 0 ? Number((lightDislikes / lightCount).toFixed(4)) : 0;

    const escalateRecommended =
      lightCount >= this.minSamplesThreshold && lightDislikeRate >= this.dislikeThreshold;

    const activeEscalation =
      this.autoEscalateOverride !== null
        ? this.autoEscalateOverride
        : escalateRecommended;

    let recommendation: string;
    if (lightCount < this.minSamplesThreshold) {
      recommendation = `Недостаточно данных для переключения (${lightCount}/${this.minSamplesThreshold} оценок). Лёгкие модели работают в штатном режиме экономии токенов.`;
    } else if (escalateRecommended) {
      recommendation = `Высокая доля негативных оценок лёгких моделей (${Math.round(lightDislikeRate * 100)}% при пороге ${Math.round(this.dislikeThreshold * 100)}%). Рекомендуется эскалация простых запросов на флагманские модели (рабочая модель вместо лёгкой). Шлюз автоматически повышает глубину размышлений на один шаг.`;
    } else {
      recommendation = `Лёгкие модели показывают отличную удовлетворённость пользователей (${Math.round((1 - lightDislikeRate) * 100)}%). Эскалация не требуется, маршрутизация простых задач на лёгкие модели сохраняет максимальную экономию себестоимости.`;
    }

    const escalation: EscalationStatus = {
      escalateToHeavyRecommended: escalateRecommended,
      autoEscalateActive: activeEscalation,
      dislikeThreshold: this.dislikeThreshold,
      minSamplesThreshold: this.minSamplesThreshold,
      lightEngineFeedbackCount: lightCount,
      lightEngineDislikeCount: lightDislikes,
      lightEngineDislikeRate: lightDislikeRate,
      recommendation,
    };

    return {
      summary,
      byModel,
      byEngine,
      byComplexity,
      escalation,
    };
  }
}

export function createFeedbackStore(filePath?: string): FeedbackStore {
  return new FeedbackStore(filePath);
}
