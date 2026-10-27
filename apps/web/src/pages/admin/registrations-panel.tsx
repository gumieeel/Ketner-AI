import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertIcon, CloseIcon, UserIcon } from '@/components/icons';
import { useTranslation, type TranslationKey } from '@/i18n';
import { cn } from '@/lib/cn';
import { formatDateTime } from '@/lib/format-date';

type Period = '24h' | '7d' | '30d' | '90d' | 'all';
type Bucket = 'hour' | 'day' | 'week';
type Method = 'email' | 'google' | 'github' | 'telegram' | 'admin' | 'unknown';
type Channel =
  'paid' | 'organic' | 'social' | 'referral' | 'email' | 'campaign' | 'direct' | 'unknown';

interface CountWithPaid {
  count: number;
  paid: number;
}

interface RegistrationRow {
  id: string;
  email: string | null;
  name: string;
  plan: string;
  paid: boolean;
  createdAt: string;
  method: Method;
  channel: Channel;
  source: string;
  medium: string | null;
  campaign: string | null;
  referrer: string | null;
  landing: string | null;
}

export interface RegistrationStats {
  period: Period;
  bucket: Bucket;
  timeZone: string;
  totals: {
    allTime: number;
    inPeriod: number;
    previousPeriod: number | null;
    today: number;
    paidInPeriod: number;
    trackedInPeriod: number;
  };
  series: Array<{ key: string; count: number }>;
  byHourOfDay: number[];
  byMethod: Array<{ method: Method } & CountWithPaid>;
  byChannel: Array<{ channel: Channel } & CountWithPaid>;
  bySource: Array<{ channel: Channel; source: string } & CountWithPaid>;
  byCampaign: Array<{ campaign: string; source: string } & CountWithPaid>;
  recent: RegistrationRow[];
  recentTotal: number;
}

interface Filter {
  method?: Method;
  channel?: Channel;
  source?: string;
}

const PERIODS: Period[] = ['24h', '7d', '30d', '90d', 'all'];
const PAGE = 50;

const PERIOD_KEYS: Record<Period, TranslationKey> = {
  '24h': 'admin.regPeriod24h',
  '7d': 'admin.regPeriod7d',
  '30d': 'admin.regPeriod30d',
  '90d': 'admin.regPeriod90d',
  all: 'admin.regPeriodAll',
};

const BUCKET_KEYS: Record<Bucket, TranslationKey> = {
  hour: 'admin.regBucketHour',
  day: 'admin.regBucketDay',
  week: 'admin.regBucketWeek',
};

const METHOD_KEYS: Record<Method, TranslationKey> = {
  email: 'admin.regMethodEmail',
  google: 'admin.regMethodGoogle',
  github: 'admin.regMethodGithub',
  telegram: 'admin.regMethodTelegram',
  admin: 'admin.regMethodAdmin',
  unknown: 'admin.regMethodUnknown',
};

const CHANNEL_KEYS: Record<Channel, TranslationKey> = {
  paid: 'admin.regChannelPaid',
  organic: 'admin.regChannelOrganic',
  social: 'admin.regChannelSocial',
  referral: 'admin.regChannelReferral',
  email: 'admin.regChannelEmail',
  campaign: 'admin.regChannelCampaign',
  direct: 'admin.regChannelDirect',
  unknown: 'admin.regChannelUnknown',
};

const PLAN_TONES: Record<string, BadgeTone> = {
  free: 'neutral',
  credits: 'brand',
  plus: 'plus',
  pro: 'pro',
  ultra: 'ultra',
};

function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** Подпись корзины графика из её ключа (ключи уже в поясе администратора). */
function bucketLabel(key: string, bucket: Bucket, locale: string, long = false): string {
  const [datePart = '', hourPart] = key.split('T');
  const [y, m, d] = datePart.split('-').map(Number);
  const date = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1, Number(hourPart ?? 0)));
  if (bucket === 'hour') {
    const time = `${hourPart ?? '00'}:00`;
    if (!long) return time;
    const day = new Intl.DateTimeFormat(locale, {
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    }).format(date);
    return `${day}, ${time}`;
  }
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    ...(long ? { weekday: 'short' as const } : {}),
    timeZone: 'UTC',
  }).format(date);
}

function sourceText(t: (key: TranslationKey) => string, channel: Channel, source: string): string {
  const label = t(CHANNEL_KEYS[channel]);
  return source ? `${label} · ${source}` : label;
}

function sameFilter(a: Filter, b: Filter): boolean {
  return a.method === b.method && a.channel === b.channel && a.source === b.source;
}

interface BarChartProps {
  points: Array<{ label: string; longLabel: string; count: number }>;
  caption: string;
  height?: string;
  /** Индексы, под которыми подписывается ось X. */
  tickEvery?: number;
}

/**
 * Столбики одним цветом с подсказкой на наведение и фокус; под графиком — скрытая таблица
 * с теми же числами для экранных дикторов.
 */
function BarChart({ points, caption, height = 'h-44', tickEvery }: BarChartProps) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(1, ...points.map((point) => point.count));
  const top = max <= 4 ? max : Math.ceil(max / 2) * 2;
  const step = tickEvery ?? Math.max(1, Math.ceil(points.length / 6));
  const dense = points.length > 40;
  const activePoint = active === null ? null : points[active];

  return (
    <figure className="flex flex-col gap-2">
      <div className="flex gap-2">
        {/* Ось Y: верх, середина, ноль */}
        <div
          aria-hidden="true"
          className={cn(
            'flex w-7 shrink-0 flex-col justify-between text-right text-[11px] text-subtle tabular-nums',
            height,
          )}
        >
          <span className="-translate-y-1/2">{top}</span>
          <span>{top > 1 ? Math.round(top / 2) : ''}</span>
          <span className="translate-y-1/2">0</span>
        </div>
        <div className={cn('relative min-w-0 flex-1', height)}>
          <div aria-hidden="true" className="pointer-events-none absolute inset-0">
            <div className="absolute inset-x-0 top-0 border-t border-dashed border-stroke" />
            <div className="absolute inset-x-0 top-1/2 border-t border-dashed border-stroke" />
            <div className="absolute inset-x-0 bottom-0 border-t border-stroke-strong" />
          </div>
          <div
            className={cn('absolute inset-0 flex items-end', dense ? 'gap-px' : 'gap-[2px]')}
            onMouseLeave={() => setActive(null)}
          >
            {points.map((point, index) => (
              <div
                key={point.longLabel}
                tabIndex={0}
                role="img"
                aria-label={`${point.longLabel}: ${point.count}`}
                onMouseEnter={() => setActive(index)}
                onFocus={() => setActive(index)}
                onBlur={() => setActive(null)}
                className="group flex h-full min-w-0 flex-1 cursor-default items-end outline-none"
              >
                <div
                  className={cn(
                    'w-full rounded-t-[3px] transition-colors',
                    point.count > 0 ? 'bg-accent' : 'bg-transparent',
                    active === index && point.count > 0 && 'bg-text',
                    'group-focus-visible:ring-2 group-focus-visible:ring-accent',
                  )}
                  style={{
                    height: point.count > 0 ? `max(3px, ${(point.count / top) * 100}%)` : '0',
                  }}
                />
              </div>
            ))}
          </div>
          {activePoint && active !== null ? (
            <div
              role="status"
              className="pointer-events-none absolute top-1 z-10 rounded-lg border border-stroke bg-surface px-2.5 py-1.5 text-xs shadow-md whitespace-nowrap"
              style={{
                left: `${((active + 0.5) / points.length) * 100}%`,
                transform: `translateX(${active < points.length / 4 ? '-10%' : active > (points.length * 3) / 4 ? '-90%' : '-50%'})`,
              }}
            >
              <span className="text-muted">{activePoint.longLabel}</span>
              <span className="ml-2 font-semibold text-text tabular-nums">{activePoint.count}</span>
            </div>
          ) : null}
        </div>
      </div>
      {/* Ось X */}
      <div aria-hidden="true" className="ml-9 flex text-[11px] text-subtle">
        {points.map((point, index) => (
          <span key={point.longLabel} className="relative min-w-0 flex-1">
            {index % step === 0 ? (
              <span
                className={cn(
                  'absolute left-1/2 -translate-x-1/2 whitespace-nowrap',
                  // На узком экране — каждая вторая подпись, чтобы даты не наезжали друг на друга.
                  (index / step) % 2 === 1 && 'hidden sm:inline',
                )}
              >
                {point.label}
              </span>
            ) : null}
          </span>
        ))}
      </div>
      <table className="sr-only">
        <caption>{caption}</caption>
        <tbody>
          {points.map((point) => (
            <tr key={point.longLabel}>
              <th scope="row">{point.longLabel}</th>
              <td>{point.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

interface BreakdownItem {
  id: string;
  label: ReactNode;
  count: number;
  paid: number;
  filter?: Filter;
}

function Breakdown({
  title,
  items,
  active,
  onSelect,
  emptyText,
}: {
  title: string;
  items: BreakdownItem[];
  active: Filter;
  onSelect?: (filter: Filter) => void;
  emptyText: string;
}) {
  const { t } = useTranslation();
  const max = Math.max(1, ...items.map((item) => item.count));
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-xl border border-stroke bg-canvas p-4">
      <h3 className="text-[13px] font-semibold text-text">{title}</h3>
      {items.length === 0 ? (
        <p className="text-[13px] text-muted">{emptyText}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {items.map((item) => {
            const selected = item.filter ? sameFilter(item.filter, active) : false;
            const content = (
              <>
                <span className="flex items-baseline justify-between gap-3 text-[13px]">
                  <span className="min-w-0 truncate text-text">{item.label}</span>
                  <span className="shrink-0 tabular-nums">
                    <span className="font-semibold text-text">{item.count}</span>
                    {item.paid > 0 ? (
                      <span className="ml-1.5 text-xs text-muted">
                        {t('admin.regPaidShort', { paid: item.paid })}
                      </span>
                    ) : null}
                  </span>
                </span>
                <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-surface-3">
                  <span
                    className="block h-full rounded-full bg-accent"
                    style={{ width: `${(item.count / max) * 100}%` }}
                  />
                </span>
              </>
            );
            return (
              <li key={item.id}>
                {item.filter && onSelect ? (
                  <button
                    type="button"
                    aria-pressed={selected}
                    onClick={() => onSelect(selected ? {} : item.filter!)}
                    className={cn(
                      'block min-h-11 w-full rounded-lg px-2 py-2 text-left transition-colors hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none',
                      selected && 'bg-accent-soft ring-1 ring-accent/30 ring-inset',
                    )}
                  >
                    {content}
                  </button>
                ) : (
                  <div className="px-2 py-2">{content}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  loading,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  loading: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-xl border border-stroke bg-canvas p-3.5 sm:p-4">
      <p className="text-[13px] font-medium text-muted">{label}</p>
      {loading ? (
        <Skeleton className="h-7 w-16" />
      ) : (
        <p className="text-2xl leading-8 font-semibold tracking-tight text-text tabular-nums">
          {value}
        </p>
      )}
      {hint && !loading ? <p className="text-xs leading-4 text-subtle">{hint}</p> : null}
    </div>
  );
}

export function RegistrationsPanel({
  getHeaders,
  reloadToken = 0,
}: {
  getHeaders: () => HeadersInit;
  reloadToken?: number;
}) {
  const { t, language } = useTranslation();
  const locale = language === 'ru' ? 'ru-RU' : 'en-US';
  const timeZone = useMemo(browserTimeZone, []);
  const [period, setPeriod] = useState<Period>('30d');
  const [filter, setFilter] = useState<Filter>({});
  const [stats, setStats] = useState<RegistrationStats | null>(null);
  const [rows, setRows] = useState<RegistrationRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failed, setFailed] = useState(false);

  const fetchStats = useCallback(
    async (offset: number): Promise<RegistrationStats> => {
      const params = new URLSearchParams({
        period,
        tz: timeZone,
        limit: String(PAGE),
        offset: String(offset),
      });
      if (filter.method) params.set('method', filter.method);
      if (filter.channel) params.set('channel', filter.channel);
      if (filter.source !== undefined) params.set('source', filter.source);
      const res = await fetch(`/api/admin/registrations?${params.toString()}`, {
        headers: getHeaders(),
        credentials: 'include',
      });
      if (!res.ok) throw new Error(String(res.status));
      return (await res.json()) as RegistrationStats;
    },
    [period, filter, timeZone, getHeaders],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const data = await fetchStats(0);
      setStats(data);
      setRows(data.recent);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [fetchStats]);

  useEffect(() => {
    void load();
  }, [load, reloadToken]);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const data = await fetchStats(rows.length);
      setRows((current) => [...current, ...data.recent]);
    } catch {
      setFailed(true);
    } finally {
      setLoadingMore(false);
    }
  };

  const seriesPoints = useMemo(
    () =>
      (stats?.series ?? []).map((point) => ({
        label: bucketLabel(point.key, stats!.bucket, locale),
        longLabel:
          stats!.bucket === 'week'
            ? t('admin.regWeekOf', { date: bucketLabel(point.key, 'day', locale) })
            : bucketLabel(point.key, stats!.bucket, locale, true),
        count: point.count,
      })),
    [stats, locale, t],
  );

  const hourPoints = useMemo(
    () =>
      (stats?.byHourOfDay ?? Array.from({ length: 24 }, () => 0)).map((count, hour) => {
        const label = `${String(hour).padStart(2, '0')}:00`;
        return { label, longLabel: label, count };
      }),
    [stats],
  );

  const totals = stats?.totals;
  const delta =
    totals && totals.previousPeriod !== null ? totals.inPeriod - totals.previousPeriod : null;
  const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);
  const filterActive = Boolean(filter.method || filter.channel || filter.source !== undefined);
  const filterLabel = filter.method
    ? t(METHOD_KEYS[filter.method])
    : filter.channel
      ? sourceText(t, filter.channel, filter.source ?? '')
      : '';

  return (
    <Card className="flex flex-col gap-5 rounded-2xl p-4 sm:p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2.5 text-base font-semibold tracking-tight text-text">
            <span className="grid size-8 place-items-center rounded-lg bg-accent-soft text-accent ring-1 ring-accent/20 ring-inset">
              <UserIcon className="size-4" />
            </span>
            {t('admin.regTitle')}
          </h2>
          <p className="mt-1.5 text-[13px] text-muted">{t('admin.regLead', { tz: timeZone })}</p>
        </div>
        <div
          role="radiogroup"
          aria-label={t('admin.regPeriodLabel')}
          className="flex shrink-0 gap-1 overflow-x-auto rounded-lg border border-stroke bg-canvas p-1"
        >
          {PERIODS.map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={period === value}
              onClick={() => setPeriod(value)}
              className={cn(
                'min-h-9 rounded-md px-3 text-[13px] font-medium whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none',
                period === value ? 'bg-surface-3 text-text' : 'text-muted hover:text-text',
              )}
            >
              {t(PERIOD_KEYS[value])}
            </button>
          ))}
        </div>
      </div>

      {filterActive ? (
        <div className="flex flex-wrap items-center gap-2 text-[13px]">
          <span className="text-muted">{t('admin.regFilterLabel')}</span>
          <button
            type="button"
            onClick={() => setFilter({})}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-accent/30 bg-accent-soft px-3 font-medium text-text hover:border-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
            aria-label={t('admin.regFilterClear')}
          >
            {filterLabel}
            <CloseIcon className="size-3.5" />
          </button>
        </div>
      ) : null}

      {failed ? (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-xl border border-danger/35 bg-danger-soft p-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <p className="flex items-center gap-2 text-[13px] text-danger">
            <AlertIcon className="size-4 shrink-0" />
            {t('admin.regError')}
          </p>
          <Button variant="secondary" size="sm" onClick={() => void load()}>
            {t('admin.regRetry')}
          </Button>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label={t('admin.regKpiPeriod')}
          value={totals?.inPeriod ?? 0}
          loading={loading && !stats}
          hint={
            delta === null
              ? t('admin.regKpiAllTime', { total: totals?.allTime ?? 0 })
              : t('admin.regKpiDelta', {
                  diff: `${delta > 0 ? '+' : delta < 0 ? '−' : '±'}${Math.abs(delta)}`,
                  prev: totals?.previousPeriod ?? 0,
                })
          }
        />
        <Stat
          label={t('admin.regKpiToday')}
          value={totals?.today ?? 0}
          loading={loading && !stats}
        />
        <Stat
          label={t('admin.regKpiPaid')}
          value={totals?.paidInPeriod ?? 0}
          loading={loading && !stats}
          hint={t('admin.regKpiPaidHint', {
            pct: pct(totals?.paidInPeriod ?? 0, totals?.inPeriod ?? 0),
          })}
        />
        <Stat
          label={t('admin.regKpiTracked')}
          value={`${pct(totals?.trackedInPeriod ?? 0, totals?.inPeriod ?? 0)}%`}
          loading={loading && !stats}
          hint={t('admin.regKpiTrackedHint')}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-3 rounded-xl border border-stroke bg-canvas p-4">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-[13px] font-semibold text-text">{t('admin.regChartTitle')}</h3>
            {stats ? (
              <span className="text-xs text-muted">{t(BUCKET_KEYS[stats.bucket])}</span>
            ) : null}
          </div>
          {loading && !stats ? (
            <Skeleton className="h-52 w-full rounded-lg" />
          ) : (totals?.inPeriod ?? 0) === 0 ? (
            <p className="grid h-44 place-items-center text-[13px] text-muted">
              {t('admin.regChartEmpty')}
            </p>
          ) : (
            <BarChart points={seriesPoints} caption={t('admin.regChartTitle')} />
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-3 rounded-xl border border-stroke bg-canvas p-4">
          <div>
            <h3 className="text-[13px] font-semibold text-text">{t('admin.regHourTitle')}</h3>
            <p className="mt-0.5 text-xs text-muted">{t('admin.regHourHint')}</p>
          </div>
          {loading && !stats ? (
            <Skeleton className="h-36 w-full rounded-lg" />
          ) : (
            <BarChart
              points={hourPoints}
              caption={t('admin.regHourTitle')}
              height="h-28"
              tickEvery={6}
            />
          )}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Breakdown
          title={t('admin.regByMethod')}
          active={filter}
          onSelect={setFilter}
          emptyText={t('admin.regChartEmpty')}
          items={(stats?.byMethod ?? []).map((row) => ({
            id: row.method,
            label: t(METHOD_KEYS[row.method]),
            count: row.count,
            paid: row.paid,
            filter: { method: row.method },
          }))}
        />
        <Breakdown
          title={t('admin.regBySource')}
          active={filter}
          onSelect={setFilter}
          emptyText={t('admin.regChartEmpty')}
          items={(stats?.bySource ?? []).map((row) => ({
            id: `${row.channel}:${row.source}`,
            label: sourceText(t, row.channel, row.source),
            count: row.count,
            paid: row.paid,
            filter: { channel: row.channel, source: row.source },
          }))}
        />
        <Breakdown
          title={t('admin.regByCampaign')}
          active={filter}
          emptyText={t('admin.regCampaignEmpty')}
          items={(stats?.byCampaign ?? []).map((row) => ({
            id: `${row.campaign}:${row.source}`,
            label: (
              <>
                {row.campaign}
                {row.source ? <span className="text-muted"> · {row.source}</span> : null}
              </>
            ),
            count: row.count,
            paid: row.paid,
          }))}
        />
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-[13px] font-semibold text-text">{t('admin.regRecentTitle')}</h3>
          {stats ? (
            <span className="text-xs text-muted tabular-nums">
              {t('admin.regRecentCount', { shown: rows.length, total: stats.recentTotal })}
            </span>
          ) : null}
        </div>
        <div className="overflow-x-auto rounded-xl border border-stroke">
          <table className="w-full min-w-[640px] text-left text-[13px]">
            <thead className="bg-surface-2 text-xs text-muted">
              <tr>
                <th scope="col" className="px-3 py-2.5 font-medium">
                  {t('admin.regColWhen')}
                </th>
                <th scope="col" className="px-3 py-2.5 font-medium">
                  {t('admin.regColUser')}
                </th>
                <th scope="col" className="px-3 py-2.5 font-medium">
                  {t('admin.regColMethod')}
                </th>
                <th scope="col" className="px-3 py-2.5 font-medium">
                  {t('admin.regColSource')}
                </th>
                <th scope="col" className="px-3 py-2.5 font-medium">
                  {t('admin.regColPlan')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stroke">
              {loading && !stats
                ? Array.from({ length: 5 }, (_, index) => (
                    <tr key={index} aria-hidden="true">
                      <td colSpan={5} className="px-3 py-3">
                        <Skeleton className="h-4 w-full" />
                      </td>
                    </tr>
                  ))
                : null}
              {!loading && rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-muted">
                    {t('admin.regRecentEmpty')}
                  </td>
                </tr>
              ) : null}
              {rows.map((row) => (
                <tr key={row.id} className="align-top">
                  <td className="px-3 py-2.5 whitespace-nowrap text-muted tabular-nums">
                    {formatDateTime(row.createdAt, language)}
                  </td>
                  <td className="max-w-[16rem] px-3 py-2.5">
                    <p className="truncate font-medium text-text">{row.name}</p>
                    <p className="truncate text-xs text-muted">
                      {row.email ?? t('admin.regTelegramAccount')}
                    </p>
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-text">
                    {t(METHOD_KEYS[row.method])}
                  </td>
                  <td className="max-w-[18rem] px-3 py-2.5">
                    <p className="truncate text-text">{sourceText(t, row.channel, row.source)}</p>
                    {row.campaign || row.medium || (row.landing && row.landing !== '/') ? (
                      <p className="truncate text-xs text-muted">
                        {[
                          row.campaign,
                          row.medium,
                          row.landing && row.landing !== '/'
                            ? t('admin.regLanding', { path: row.landing })
                            : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    ) : null}
                  </td>
                  <td className="px-3 py-2.5">
                    <Badge
                      tone={PLAN_TONES[row.plan] ?? 'outline'}
                      className="px-2 py-0 text-[11px] uppercase"
                    >
                      {row.plan}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {stats && rows.length < stats.recentTotal ? (
          <Button
            variant="secondary"
            size="md"
            className="self-center"
            loading={loadingMore}
            onClick={() => void loadMore()}
          >
            {t('admin.regShowMore')}
          </Button>
        ) : null}
      </div>
    </Card>
  );
}
