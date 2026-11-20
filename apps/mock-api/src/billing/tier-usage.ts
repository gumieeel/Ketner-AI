/**
 * Тариф и счётчик обращений (docs/SUBSCRIPTION_PRICING_DESIGN.md, раздел 5): решение перед ответом
 * опубликованного решения посетителю и сводка «как было бы» для администратора.
 *
 * - Счётчик не хранится отдельно: засчитанные обращения месяца считаются по журналу исполнений
 *   (platform/request-count.ts). Кеш — 60 секунд на аккаунт плюс увеличение в процессе после каждого
 *   ответа; после перезапуска значение считается заново из базы.
 * - `TIER_ENFORCED = false`: решение считается перед каждым ответом той же функцией, но ответы идут
 *   как раньше (баланс); решения «было бы ограничено» видны в карточке пользователя, в
 *   `GET /api/admin/tiers` и в логе `[tiers] shadow` (не чаще раза в час на аккаунт).
 */

import {
  requestLimit,
  tierById,
  usageState,
  type TierId,
  type UsageState,
} from '../services/tiers.js';
import type { ExecutionJournal } from '../platform/journal.js';
import type { PublishedBot } from '../builder/store.js';
import type { AccountTiers } from './account-tiers.js';

/**
 * Включены ли тарифы для ответов посетителям. Константа в коде, без переменной окружения: включение —
 * отдельный PR после того, как владелец назначит тариф своему аккаунту (решение 15.11.2026).
 */
export const TIER_ENFORCED = true;

let enforcedOverride: boolean | null = null;

/** Только для тестов пути с включёнными тарифами; в production не работает. */
export function setTierEnforcedForTests(value: boolean | null): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('TIER_ENFORCED cannot be changed in production');
  }
  enforcedOverride = value;
}

export function tierEnforced(): boolean {
  return enforcedOverride ?? TIER_ENFORCED;
}

/** Что делать с ответом посетителю. */
export type TierAction = 'answer' | 'form_only' | 'leads_only';

export interface TierDecision {
  tier: TierId | null;
  /** Засчитанные обращения в этом месяце. */
  used: number;
  /** Включённые обращения тарифа (без льготных); null — тарифа нет. */
  included: number | null;
  /** Предел вместе с льготными 10%; null — тарифа нет. */
  limit: number | null;
  state: UsageState | 'no_tier';
  action: TierAction;
  periodEnd: string;
}

export interface TierReportRow extends TierDecision {
  userId: string;
  /**
   * Опубликованные боты аккаунта (страница отвечает посетителям). Бот без тарифа при включённых
   * тарифах показывает только форму заявки — такие аккаунты видны в сводке до включения.
   */
  publishedBots: Array<{ solutionId: string; name: string; slug: string }>;
  /** Ответов в этом месяце, которые при включённых тарифах ушли бы в форму заявки. */
  wouldLimit: number;
  setBy: string | null;
  setAt: string | null;
}

const CACHE_MS = 60_000;
const SHADOW_LOG_EVERY_MS = 60 * 60_000;

const monthStart = (at: Date) =>
  new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1)).toISOString();
const monthEnd = (at: Date) =>
  new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1)).toISOString();

/** Решение по тарифу и числу засчитанных обращений: одна функция для включённого и теневого режима. */
export function decide(tier: TierId | null, used: number, periodEnd: string): TierDecision {
  if (!tier) {
    return {
      tier: null,
      used,
      included: null,
      limit: null,
      state: 'no_tier',
      action: 'form_only',
      periodEnd,
    };
  }
  const entry = tierById(tier);
  const state = usageState(entry, used);
  return {
    tier,
    used,
    included: entry.monthlyRequests,
    limit: requestLimit(entry),
    state,
    action: state === 'leads_only' ? 'leads_only' : 'answer',
    periodEnd,
  };
}

/** Сколько ответов месяца было бы ограничено: без тарифа — все, с тарифом — сверх предела. */
export function wouldLimit(decision: TierDecision): number {
  return decision.limit === null ? decision.used : Math.max(0, decision.used - decision.limit);
}

export interface TierUsageDeps {
  tiers: AccountTiers;
  journal: () => ExecutionJournal | null;
  /** Опубликованные боты всех аккаунтов (для сводки); нет — сводка без них. */
  publishedBots?: () => Promise<PublishedBot[]>;
  now?: () => Date;
  log?: (line: string) => void;
}

export class TierUsage {
  private readonly cache = new Map<string, { month: string; used: number; at: number }>();
  private readonly lastShadowLog = new Map<string, number>();

  constructor(private readonly deps: TierUsageDeps) {}

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  get tiers(): AccountTiers {
    return this.deps.tiers;
  }

  /** Засчитанные обращения аккаунта в текущем месяце (кеш 60 с). Журнала нет — 0. */
  async used(userId: string): Promise<number> {
    const at = this.now();
    const month = monthStart(at);
    const cached = this.cache.get(userId);
    if (cached && cached.month === month && at.getTime() - cached.at < CACHE_MS) return cached.used;
    const journal = this.deps.journal();
    const counts = journal ? await journal.countRequests(month, monthEnd(at), userId) : [];
    const used = counts.find((row) => row.userId === userId)?.count ?? 0;
    this.cache.set(userId, { month, used, at: at.getTime() });
    return used;
  }

  /** После ответа посетителю: кеш увеличивается сразу, журнал уточнит при следующем чтении. */
  noteCounted(userId: string): void {
    const cached = this.cache.get(userId);
    if (cached && cached.month === monthStart(this.now())) cached.used += 1;
  }

  async decision(userId: string): Promise<TierDecision> {
    const at = this.now();
    return decide(this.deps.tiers.tierOf(userId), await this.used(userId), monthEnd(at));
  }

  /** Тарифы выключены: решение «как было бы» — в лог, не чаще раза в час на аккаунт. */
  shadow(userId: string, decision: TierDecision): void {
    if (decision.action === 'answer') return;
    const at = this.now().getTime();
    const last = this.lastShadowLog.get(userId);
    if (last !== undefined && at - last < SHADOW_LOG_EVERY_MS) return;
    this.lastShadowLog.set(userId, at);
    (this.deps.log ?? console.info)(
      `[tiers] shadow user=${userId} decision=${decision.action} used=${decision.used}/${decision.limit ?? 0} tier=${decision.tier ?? 'none'}`,
    );
  }

  /**
   * Сводка для администратора: аккаунты с засчитанными обращениями в месяце, с тарифом или с
   * опубликованным ботом.
   */
  async report(): Promise<TierReportRow[]> {
    const at = this.now();
    const journal = this.deps.journal();
    const counts = journal ? await journal.countRequests(monthStart(at), monthEnd(at)) : [];
    const used = new Map(counts.map((row) => [row.userId, row.count]));
    const bots = new Map<string, TierReportRow['publishedBots']>();
    for (const bot of (await this.deps.publishedBots?.()) ?? []) {
      const list = bots.get(bot.ownerId) ?? [];
      list.push({ solutionId: bot.solutionId, name: bot.name, slug: bot.slug });
      bots.set(bot.ownerId, list);
    }
    const userIds = new Set([
      ...used.keys(),
      ...this.deps.tiers.all().map((doc) => doc.id),
      ...bots.keys(),
    ]);
    return [...userIds]
      .map((userId) => {
        const decision = decide(
          this.deps.tiers.tierOf(userId),
          used.get(userId) ?? 0,
          monthEnd(at),
        );
        const assigned = this.deps.tiers.get(userId);
        return {
          userId,
          ...decision,
          publishedBots: bots.get(userId) ?? [],
          wouldLimit: wouldLimit(decision),
          setBy: assigned?.setBy ?? null,
          setAt: assigned?.setAt ?? null,
        };
      })
      .sort((a, b) => b.used - a.used || a.userId.localeCompare(b.userId));
  }
}
