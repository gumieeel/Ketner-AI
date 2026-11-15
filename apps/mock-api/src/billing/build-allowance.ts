/**
 * Бесплатный лимит на создание и проверку (docs/SUBSCRIPTION_PRICING_DESIGN.md, раздел 4; решения
 * владельца 15.11.2026). Оплачивает черновики, прогоны проверки, пробу бота, платные анализы, чат
 * владельца со своим помощником и запуски своего инструмента. Купленный баланс не используется.
 *
 * - До шага — резерв потолка шага сразу на всех счётчиках (месяц аккаунта; без тарифа ещё сутки
 *   аккаунта и сутки сервиса). Не хватает хотя бы одного — шаг не начинается.
 * - После шага — расчёт по факту: счётчики уменьшаются на неистраченную часть потолка.
 * - Перезапуск посреди шага оставляет резерв по потолку: перерасхода нет (раздел 4.1).
 */

import { NO_TIER_BUILD_ALLOWANCE, tierById, type TierId } from '../services/tiers.js';
import { MemoryCounterStore, type CounterLimit, type CounterStore } from './cost-counters.js';
import {
  runStructuredTask,
  type StructuredTaskInput,
  type StructuredTaskResult,
} from '../discovery/run-task.js';

/** Суточный бюджет сервиса на бесплатное создание для аккаунтов без тарифа (решение 15.11.2026). */
export const SERVICE_FREE_BUILD_DAILY_USD = 3;

/** Внутренние кредиты в доллары себестоимости: 1 кредит = $0.001. */
const usd = (credits: number): number => credits / 1000;

export type AllowanceScope = 'month' | 'day' | 'service';

export interface AllowanceTicket {
  userId: string;
  keys: string[];
  capUsd: number;
}

export type AllowanceReservation =
  | { ok: true; ticket: AllowanceTicket }
  | { ok: false; code: 'build_allowance_exhausted'; scope: AllowanceScope; resetsAt: string }
  | { ok: false; code: 'allowance_unavailable' };

export interface AllowanceStatus {
  tier: TierId | null;
  month: { spentCredits: number; limitCredits: number; resetsAt: string };
  day: { spentCredits: number; limitCredits: number; resetsAt: string } | null;
}

export interface BuildAllowanceDeps {
  counters: () => CounterStore;
  /** Тариф аккаунта (P3); до P3 — у всех «без тарифа». */
  tierOf?: (userId: string) => TierId | null;
  now?: () => Date;
  log?: (message: string, error: unknown) => void;
}

const monthOf = (date: Date) => date.toISOString().slice(0, 7);
const dayOf = (date: Date) => date.toISOString().slice(0, 10);
const nextMonth = (date: Date) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1)).toISOString();
const nextDay = (date: Date) =>
  new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1),
  ).toISOString();

export class BuildAllowance {
  constructor(private readonly deps: BuildAllowanceDeps) {}

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  /** Счётчики аккаунта с лимитами на текущий момент. */
  private limits(userId: string, at: Date): Array<CounterLimit & { scope: AllowanceScope }> {
    const tier = this.deps.tierOf?.(userId) ?? null;
    const month = {
      scope: 'month' as const,
      key: `acct:${userId}:${monthOf(at)}`,
      limitUsd: usd(
        tier ? tierById(tier).buildAllowanceCredits : NO_TIER_BUILD_ALLOWANCE.monthlyCredits,
      ),
    };
    if (tier) return [month];
    return [
      month,
      {
        scope: 'day',
        key: `acct-day:${userId}:${dayOf(at)}`,
        limitUsd: usd(NO_TIER_BUILD_ALLOWANCE.dailyCredits),
      },
      { scope: 'service', key: `service-day:${dayOf(at)}`, limitUsd: SERVICE_FREE_BUILD_DAILY_USD },
    ];
  }

  /** Резерв потолка шага. Отказ — с причиной и датой, когда лимит обновится. */
  async reserve(userId: string, capUsd: number): Promise<AllowanceReservation> {
    const at = this.now();
    const limits = this.limits(userId, at);
    const cap = Math.max(0, capUsd);
    try {
      const ok = await this.deps.counters().reserve(limits, cap);
      if (ok) return { ok: true, ticket: { userId, keys: limits.map((l) => l.key), capUsd: cap } };
      // Какой лимит не пустил: первый по порядку, где не хватает.
      const spent = await this.deps.counters().spent(limits.map((l) => l.key));
      const blocking =
        limits.find((l) => (spent[l.key] ?? 0) + cap > l.limitUsd + 1e-9) ?? limits[0]!;
      return {
        ok: false,
        code: 'build_allowance_exhausted',
        scope: blocking.scope,
        resetsAt: blocking.scope === 'month' ? nextMonth(at) : nextDay(at),
      };
    } catch (error) {
      this.deps.log?.('[allowance] резерв не записан', error);
      return { ok: false, code: 'allowance_unavailable' };
    }
  }

  /**
   * Расчёт по факту: счётчики получают фактическую стоимость вместо потолка, но не больше потолка —
   * как и списание с баланса раньше: обещанный до шага потолок не превышается, разницу сверх него
   * (редкий повтор при неверном JSON) несёт сервис, а учёт пишет полную себестоимость. Поэтому
   * счётчик никогда не выходит за лимит. Сбой — в лог, резерв остаётся по потолку.
   */
  async settle(ticket: AllowanceTicket, actualUsd: number): Promise<void> {
    const counted = Math.min(Math.max(0, actualUsd), ticket.capUsd);
    const delta = Math.round((counted - ticket.capUsd) * 1e6) / 1e6;
    if (delta === 0) return;
    try {
      await this.deps.counters().adjust(ticket.keys, delta);
    } catch (error) {
      this.deps.log?.('[allowance] расчёт по факту не записан, резерв остался по потолку', error);
    }
  }

  /**
   * Квитанция резерва, сделанного в момент `at` (запуск инструмента выполняется позже, возможно,
   * после перезапуска): те же счётчики, что выбрал `reserve` тогда.
   */
  ticketAt(userId: string, capUsd: number, at: Date): AllowanceTicket {
    return {
      userId,
      keys: this.limits(userId, at).map((limit) => limit.key),
      capUsd: Math.max(0, capUsd),
    };
  }

  /** Сколько потрачено и сколько можно (для кабинета). */
  async status(userId: string): Promise<AllowanceStatus> {
    const at = this.now();
    const limits = this.limits(userId, at);
    const spent = await this.deps.counters().spent(limits.map((l) => l.key));
    const credits = (value: number) => Math.round(value * 1000);
    const month = limits[0]!;
    const day = limits.find((l) => l.scope === 'day');
    return {
      tier: this.deps.tierOf?.(userId) ?? null,
      month: {
        spentCredits: credits(spent[month.key] ?? 0),
        limitCredits: credits(month.limitUsd),
        resetsAt: nextMonth(at),
      },
      day: day
        ? {
            spentCredits: credits(spent[day.key] ?? 0),
            limitCredits: credits(day.limitUsd),
            resetsAt: nextDay(at),
          }
        : null,
    };
  }
}

/** Текст отказа для клиента (402 / 503). */
export function allowanceRefusal(
  language: 'ru' | 'en',
  refusal: Exclude<AllowanceReservation, { ok: true }>,
): { status: number; code: string; message: string; details?: Record<string, unknown> } {
  if (refusal.code === 'allowance_unavailable') {
    return {
      status: 503,
      code: 'allowance_unavailable',
      message:
        language === 'en'
          ? 'Free building is temporarily unavailable. Try again in a minute.'
          : 'Бесплатное создание и проверка временно недоступны. Попробуйте через минуту.',
    };
  }
  const date = new Date(refusal.resetsAt);
  const when = new Intl.DateTimeFormat(language === 'en' ? 'en-US' : 'ru-RU', {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(date);
  const message =
    language === 'en'
      ? refusal.scope === 'service'
        ? `Free building is used up for today across the service. It renews on ${when}.`
        : `The free limit for building and testing is used up. It renews on ${when}.`
      : refusal.scope === 'service'
        ? `Бесплатное создание на сегодня закончилось у всего сервиса. Оно обновится ${when}.`
        : `Бесплатный лимит на создание и проверку исчерпан. Он обновится ${when}.`;
  return {
    status: 402,
    code: 'build_allowance_exhausted',
    message,
    details: { scope: refusal.scope, resetsAt: refusal.resetsAt },
  };
}

/**
 * Лимит поверх хранилищ платформы: в Postgres — общие счётчики, без базы — в памяти. Хранилища не
 * готовы (база ожидается, но не подключена) — резерв не проходит: `allowance_unavailable`.
 */
export function allowanceOver(
  stores: () => { counters?: CounterStore } | null,
  options: Omit<BuildAllowanceDeps, 'counters'> = {},
): BuildAllowance {
  const fallback = new MemoryCounterStore();
  return new BuildAllowance({
    log: (message, error) => console.error(message, error),
    ...options,
    counters: () => {
      const ready = stores();
      if (!ready) throw new Error('хранилища платформы не готовы');
      return ready.counters ?? fallback;
    },
  });
}

/**
 * Одна служебная задача за счёт бесплатного лимита: резерв потолка, вызов без списания баланса,
 * расчёт по факту. Лимит исчерпан — неудачный результат с кодом отказа, модель не вызывается.
 */
export async function runAllowanceTask<T>(
  allowance: BuildAllowance,
  input: StructuredTaskInput<T>,
): Promise<StructuredTaskResult<T>> {
  const reservation = await allowance.reserve(input.caller.userId, input.policy.capUsd);
  if (!reservation.ok) {
    const refusal = allowanceRefusal(input.language, reservation);
    return {
      ok: false,
      code: refusal.code,
      message: refusal.message,
      attempts: [],
      costUsd: 0,
      creditsUsd: 0,
    };
  }
  let costUsd = input.policy.capUsd;
  try {
    const result = await runStructuredTask({ ...input, funding: 'allowance' });
    costUsd = result.costUsd;
    return result;
  } finally {
    await allowance.settle(reservation.ticket, costUsd);
  }
}

/**
 * Лимит без ограничений — только для замеров (scripts/benchmark-discovery.ts): там платные анализы
 * запускаются десятками подряд, и бесплатный лимит одного аккаунта не должен их останавливать.
 */
export function unlimitedAllowance(): BuildAllowance {
  const unlimited: CounterStore = {
    reserve: async () => true,
    adjust: async () => undefined,
    spent: async (keys) => Object.fromEntries(keys.map((key) => [key, 0])),
  };
  return new BuildAllowance({ counters: () => unlimited });
}
