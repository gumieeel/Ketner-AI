/**
 * Статистика регистраций для админ-панели: график по времени, разбивка по способу входа,
 * по источнику и по рекламной кампании, распределение по часу суток и список последних.
 *
 * Время считается в часовом поясе администратора (`tz` из браузера), иначе сутки «съезжают».
 */

import type { StoredUser } from '../store/user-store.js';
import {
  classifyAttribution,
  type SignupChannel,
  type SignupMethod,
} from './signup-attribution.js';
import { isTelegramAccountEmail } from '../telegram/auth-requests.js';

export type RegistrationPeriod = '24h' | '7d' | '30d' | '90d' | 'all';
export type RegistrationBucket = 'hour' | 'day' | 'week';

export const REGISTRATION_PERIODS: readonly RegistrationPeriod[] = [
  '24h',
  '7d',
  '30d',
  '90d',
  'all',
];

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const PERIOD_DAYS: Record<Exclude<RegistrationPeriod, 'all'>, number> = {
  '24h': 1,
  '7d': 7,
  '30d': 30,
  '90d': 90,
};
/** Длиннее этого «за всё время» показывается по неделям. */
const DAILY_LIMIT_DAYS = 120;

export interface RegistrationFilters {
  method?: SignupMethod;
  channel?: SignupChannel;
  /** Нормализованный источник (google, telegram, habr.com…). */
  source?: string;
}

export interface RegistrationStatsOptions {
  period: RegistrationPeriod;
  timeZone: string;
  now?: Date;
  filters?: RegistrationFilters;
  /** Сколько последних регистраций вернуть (страница списка). */
  limit?: number;
  offset?: number;
  /** На платном ли тарифе человек сейчас (для конверсии по источникам). */
  isPaid?: (user: StoredUser) => boolean;
  /** Текущий тариф для списка. */
  planOf?: (user: StoredUser) => string;
}

export interface RegistrationRow {
  id: string;
  /** null для служебной почты Telegram-аккаунтов. */
  email: string | null;
  name: string;
  plan: string;
  paid: boolean;
  createdAt: string;
  method: SignupMethod;
  channel: SignupChannel;
  source: string;
  medium: string | null;
  campaign: string | null;
  referrer: string | null;
  landing: string | null;
}

export interface CountWithPaid {
  count: number;
  paid: number;
}

export interface RegistrationStats {
  period: RegistrationPeriod;
  bucket: RegistrationBucket;
  timeZone: string;
  generatedAt: string;
  totals: {
    allTime: number;
    inPeriod: number;
    /** Предыдущий отрезок той же длины; null для «всё время». */
    previousPeriod: number | null;
    today: number;
    paidInPeriod: number;
    /** Доля регистраций периода, у которых известен источник. */
    trackedInPeriod: number;
  };
  series: Array<{ key: string; start: string; count: number }>;
  byHourOfDay: number[];
  byMethod: Array<{ method: SignupMethod } & CountWithPaid>;
  byChannel: Array<{ channel: SignupChannel } & CountWithPaid>;
  bySource: Array<{ channel: SignupChannel; source: string } & CountWithPaid>;
  byCampaign: Array<{ campaign: string; source: string } & CountWithPaid>;
  recent: RegistrationRow[];
  recentTotal: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

/** Проверяет IANA-имя часового пояса; неизвестное заменяется на UTC. */
export function resolveTimeZone(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 64) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return value;
  } catch {
    return 'UTC';
  }
}

function formatter(timeZone: string): Intl.DateTimeFormat {
  let cached = formatterCache.get(timeZone);
  if (!cached) {
    cached = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    });
    formatterCache.set(timeZone, cached);
  }
  return cached;
}

interface LocalParts {
  day: string;
  hour: number;
}

function localParts(ms: number, timeZone: string): LocalParts {
  const parts = formatter(timeZone).formatToParts(new Date(ms));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '00';
  return { day: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) % 24 };
}

/** Понедельник недели, в которую попадает день YYYY-MM-DD (календарная арифметика без поясов). */
function weekStart(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, d!));
  const shift = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - shift);
  return date.toISOString().slice(0, 10);
}

function bucketKey(ms: number, bucket: RegistrationBucket, timeZone: string): string {
  const { day, hour } = localParts(ms, timeZone);
  if (bucket === 'hour') return `${day}T${String(hour).padStart(2, '0')}`;
  if (bucket === 'week') return weekStart(day);
  return day;
}

export function signupMethodOf(user: StoredUser): SignupMethod {
  if (user.signupMethod) return user.signupMethod;
  if (isTelegramAccountEmail(user.email)) return 'telegram';
  return 'unknown';
}

function addCount<K>(map: Map<K, CountWithPaid>, key: K, paid: boolean): void {
  const entry = map.get(key) ?? { count: 0, paid: 0 };
  entry.count += 1;
  if (paid) entry.paid += 1;
  map.set(key, entry);
}

function sortByCount<T extends CountWithPaid>(items: T[]): T[] {
  return items.sort((a, b) => b.count - a.count || b.paid - a.paid);
}

export function computeRegistrationStats(
  users: StoredUser[],
  options: RegistrationStatsOptions,
): RegistrationStats {
  const timeZone = resolveTimeZone(options.timeZone);
  const nowMs = (options.now ?? new Date()).getTime();
  const isPaid = options.isPaid ?? ((user: StoredUser) => user.plan !== 'free');
  const planOf = options.planOf ?? ((user: StoredUser) => user.plan);
  const filters = options.filters ?? {};

  const enriched = users
    .map((user) => {
      const createdMs = Date.parse(user.createdAt);
      const classified = classifyAttribution(user.signupAttribution);
      return {
        user,
        createdMs,
        method: signupMethodOf(user),
        ...classified,
        paid: isPaid(user),
      };
    })
    .filter((item) => Number.isFinite(item.createdMs) && item.createdMs <= nowMs);

  const matchesFilters = (item: (typeof enriched)[number]) =>
    (!filters.method || item.method === filters.method) &&
    (!filters.channel || item.channel === filters.channel) &&
    (filters.source === undefined || filters.source === '' || item.source === filters.source);

  const filtered = enriched.filter(matchesFilters);

  // Период и шаг графика.
  let bucket: RegistrationBucket;
  let startMs: number;
  let spanMs: number | null;
  if (options.period === 'all') {
    const earliest = filtered.reduce((min, item) => Math.min(min, item.createdMs), nowMs);
    const spanDays = (nowMs - earliest) / DAY;
    bucket = spanDays > DAILY_LIMIT_DAYS ? 'week' : spanDays <= 2 ? 'hour' : 'day';
    startMs = earliest;
    spanMs = null;
  } else {
    const days = PERIOD_DAYS[options.period];
    bucket = days === 1 ? 'hour' : 'day';
    // Начало — первый час (для суток) или первый день периода по местному времени.
    startMs = nowMs - (days === 1 ? 23 * HOUR : (days - 1) * DAY);
    spanMs = days * DAY;
  }
  const startKey = bucketKey(startMs, bucket, timeZone);
  const nowKey = bucketKey(nowMs, bucket, timeZone);

  // Непрерывный ряд корзин, включая пустые: идём по часам и собираем ключи по порядку.
  const series: RegistrationStats['series'] = [];
  const seriesIndex = new Map<string, number>();
  const stepStart = startMs - 2 * DAY;
  for (let ms = stepStart; ms <= nowMs + HOUR; ms += HOUR) {
    const key = bucketKey(Math.min(ms, nowMs), bucket, timeZone);
    if (key < startKey || key > nowKey || seriesIndex.has(key)) continue;
    seriesIndex.set(key, series.length);
    series.push({ key, start: new Date(Math.min(ms, nowMs)).toISOString(), count: 0 });
  }

  const inPeriod = filtered.filter(
    (item) => bucketKey(item.createdMs, bucket, timeZone) >= startKey,
  );

  const byHourOfDay = Array.from({ length: 24 }, () => 0);
  const byMethod = new Map<SignupMethod, CountWithPaid>();
  const byChannel = new Map<SignupChannel, CountWithPaid>();
  const bySource = new Map<string, CountWithPaid & { channel: SignupChannel; source: string }>();
  const byCampaign = new Map<string, CountWithPaid & { campaign: string; source: string }>();
  let paidInPeriod = 0;
  let trackedInPeriod = 0;

  for (const item of inPeriod) {
    const index = seriesIndex.get(bucketKey(item.createdMs, bucket, timeZone));
    if (index !== undefined) series[index]!.count += 1;
    byHourOfDay[localParts(item.createdMs, timeZone).hour]! += 1;
    addCount(byMethod, item.method, item.paid);
    addCount(byChannel, item.channel, item.paid);
    if (item.paid) paidInPeriod += 1;
    if (item.channel !== 'unknown') trackedInPeriod += 1;

    const sourceKey = `${item.channel}\u0000${item.source}`;
    const source = bySource.get(sourceKey) ?? {
      channel: item.channel,
      source: item.source,
      count: 0,
      paid: 0,
    };
    source.count += 1;
    if (item.paid) source.paid += 1;
    bySource.set(sourceKey, source);

    const campaign = item.user.signupAttribution?.utmCampaign;
    if (campaign) {
      const campaignKey = `${campaign}\u0000${item.source}`;
      const entry = byCampaign.get(campaignKey) ?? {
        campaign,
        source: item.source,
        count: 0,
        paid: 0,
      };
      entry.count += 1;
      if (item.paid) entry.paid += 1;
      byCampaign.set(campaignKey, entry);
    }
  }

  const previousPeriod =
    spanMs === null
      ? null
      : filtered.filter(
          (item) => item.createdMs < nowMs - spanMs && item.createdMs >= nowMs - 2 * spanMs,
        ).length;

  const todayKey = localParts(nowMs, timeZone).day;
  const today = filtered.filter(
    (item) => localParts(item.createdMs, timeZone).day === todayKey,
  ).length;

  const sortedRecent = [...inPeriod].sort((a, b) => b.createdMs - a.createdMs);
  const offset = Math.max(0, options.offset ?? 0);
  const limit = Math.min(200, Math.max(1, options.limit ?? 50));
  const recent: RegistrationRow[] = sortedRecent.slice(offset, offset + limit).map((item) => {
    const attribution = item.user.signupAttribution;
    return {
      id: item.user.id,
      email: isTelegramAccountEmail(item.user.email) ? null : item.user.email,
      name: item.user.name,
      plan: planOf(item.user),
      paid: item.paid,
      createdAt: new Date(item.createdMs).toISOString(),
      method: item.method,
      channel: item.channel,
      source: item.source,
      medium: attribution?.utmMedium ?? null,
      campaign: attribution?.utmCampaign ?? null,
      referrer: attribution?.referrer ?? null,
      landing: attribution?.landing ?? null,
    };
  });

  return {
    period: options.period,
    bucket,
    timeZone,
    generatedAt: new Date(nowMs).toISOString(),
    totals: {
      allTime: filtered.length,
      inPeriod: inPeriod.length,
      previousPeriod,
      today,
      paidInPeriod,
      trackedInPeriod,
    },
    series,
    byHourOfDay,
    byMethod: sortByCount([...byMethod].map(([method, value]) => ({ method, ...value }))),
    byChannel: sortByCount([...byChannel].map(([channel, value]) => ({ channel, ...value }))),
    bySource: sortByCount([...bySource.values()]).slice(0, 20),
    byCampaign: sortByCount([...byCampaign.values()]).slice(0, 15),
    recent,
    recentTotal: sortedRecent.length,
  };
}
