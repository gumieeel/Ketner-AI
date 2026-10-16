import { useEffect, useState, useCallback, type ReactNode } from 'react';
import { useAuth } from '@/features/auth/auth-store';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Modal, ModalHeader } from '@/components/ui/modal';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusDot } from '@/components/ui/status-dot';
import {
  AlertIcon,
  BoltIcon,
  ChartIcon,
  CheckIcon,
  CpuIcon,
  EditIcon,
  KeyIcon,
  MessagesIcon,
  RefreshIcon,
  SearchIcon,
  ShieldIcon,
  UserIcon,
} from '@/components/icons';
import { useTranslation, type TranslationKey } from '@/i18n';
import { cn } from '@/lib/cn';
import type { PlanId } from '@/features/auth/types';

interface UserSummary {
  id: string;
  email: string;
  name: string;
  plan: PlanId;
  isVip: boolean;
  isAdmin: boolean;
  createdAt: string;
  usage: {
    requestsToday: number;
    tokensToday: number;
    costToday: number;
    costThisMonth: number;
  };
  limits: {
    requestsPerDay: number | null;
    tokensPerDay: number | null;
    maxDailyCost: number | null;
    costBudget: number | null;
  };
  remaining: {
    requestsToday: number | null;
    tokensToday: number | null;
    costToday: number | null;
    costThisMonth: number | null;
  };
  budgetUsedPct: number;
}

interface UserDetail {
  id: string;
  email: string;
  name: string;
  plan: PlanId;
  isVip: boolean;
  isAdmin: boolean;
  createdAt: string;
  usage: {
    requestsLastHour: number;
    requestsToday: number;
    tokensLastHour: number;
    tokensToday: number;
    costToday: number;
    costThisMonth: number;
  };
  limits: {
    requestsPerHour: number | null;
    requestsPerDay: number | null;
    tokensPerHour: number | null;
    tokensPerDay: number | null;
    maxDailyCost: number | null;
    costBudget: number | null;
  };
  remaining: {
    requestsLastHour: number | null;
    requestsToday: number | null;
    tokensLastHour: number | null;
    tokensToday: number | null;
    costToday: number | null;
    costThisMonth: number | null;
  };
  budgetUsedPct: number;
  profitability: {
    userId: string;
    subscriptionRevenue: number;
    aiCost: number;
    contributionMargin: number;
    status: 'profitable' | 'low_margin' | 'loss_making';
    plan: string;
    priceRub: number;
    usdToRubRate: number;
  };
  recentRequests: Array<{
    id: string;
    conversationId: string;
    modelId: string;
    provider: string;
    inputTokens: number;
    outputTokens: number;
    estimatedCost: number;
    latencyMs: number;
    status: string;
    createdAt: string;
  }>;
}

type CacheStatus = 'working' | 'not_working' | 'no_data' | 'not_expected';

interface ModelUsage30d {
  modelId: string;
  name: string | null;
  vendor: string;
  requests: number;
  avgInputTokens: number;
  avgOutputTokens: number;
  cachedTokenSharePct: number;
  cacheHitRequestsPct: number;
  cacheEligibleRequests: number;
  cacheStatus: CacheStatus;
  avgCostPerRequest: number;
  totalCost: number;
  costShareByPlanPct: Record<string, number>;
}

const CACHE_STATUS_TONE: Record<CacheStatus, string> = {
  working: 'text-success',
  not_working: 'text-danger',
  no_data: 'text-muted',
  not_expected: 'text-subtle',
};

/** Сводка по моделям за 30 дней: сколько запросов, какой вход и выход, срабатывает ли кэш. */
function ModelUsageTable({ models }: { models: ModelUsage30d[] }) {
  const { t } = useTranslation();
  if (models.length === 0) {
    return <p className="text-[13px] text-muted">{t('admin.models30dEmpty')}</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-[13px] tabular-nums">
        <thead className="text-muted">
          <tr>
            <th className="py-1.5 pr-3 font-medium">{t('admin.colModelName')}</th>
            <th className="py-1.5 pr-3 font-medium">{t('admin.colModelRequests')}</th>
            <th className="py-1.5 pr-3 font-medium">{t('admin.colAvgTokens')}</th>
            <th className="py-1.5 pr-3 font-medium">{t('admin.colCached')}</th>
            <th className="py-1.5 pr-3 font-medium">{t('admin.colAvgCost')}</th>
            <th className="py-1.5 font-medium">{t('admin.colPlanShare')}</th>
          </tr>
        </thead>
        <tbody>
          {models.map((m) => (
            <tr key={m.modelId} className="border-t border-border/60">
              <td className="py-1.5 pr-3">
                <span className="font-medium text-text">{m.name ?? m.modelId}</span>
                <span className="ml-1.5 text-xs text-subtle">{m.vendor}</span>
              </td>
              <td className="py-1.5 pr-3">{m.requests}</td>
              <td className="py-1.5 pr-3">
                {m.avgInputTokens} / {m.avgOutputTokens}
              </td>
              <td className="py-1.5 pr-3">
                {m.cachedTokenSharePct}%{' '}
                <span className={cn('text-xs', CACHE_STATUS_TONE[m.cacheStatus])}>
                  {t(`admin.cacheStatus.${m.cacheStatus}` as TranslationKey)}
                </span>
              </td>
              <td className="py-1.5 pr-3">${m.avgCostPerRequest.toFixed(4)}</td>
              <td className="py-1.5 text-xs text-muted">
                {Object.entries(m.costShareByPlanPct)
                  .sort((a, b) => b[1] - a[1])
                  .map(([plan, share]) => `${plan} ${share}%`)
                  .join(' · ')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface GatewayMetricsData {
  totalRequests: number;
  totalCost: number;
  cacheHitRatePct: number;
  cacheHits: number;
  costBySource: {
    provider: { cost: number; requests: number; inputTokens: number; outputTokens: number };
    cache: { cost: number; requests: number; inputTokens: number; outputTokens: number };
    template: { cost: number; requests: number; inputTokens: number; outputTokens: number };
  };
  costByModel: Array<{
    modelId: string;
    cost: number;
    requests: number;
    inputTokens: number;
    outputTokens: number;
    averageLatencyMs: number;
  }>;
  costByPlan: Array<{
    plan: string;
    totalCost: number;
    usersCount: number;
    requests: number;
    totalTokens: number;
    averageCostPerUser: number;
    costSharePct?: number;
  }>;
  models30d?: ModelUsage30d[];
  latency: {
    averageLatencyMs: number;
    p95LatencyMs: number;
    averageTtftMs: number | null;
    p95TtftMs: number | null;
  };
  alerts: Array<{
    type: string;
    userId: string;
    userEmail: string;
    plan: string;
    contributionMargin: number;
    aiCost: number;
    subscriptionRevenue: number;
    message: string;
  }>;
  hasNegativeMarginAlert: boolean;
}

/**
 * Ошибка для показа в интерфейсе: либо ключ перевода (язык можно переключить
 * после появления ошибки), либо готовый текст, пришедший с сервера.
 */
type Problem = { key: TranslationKey; vars?: Record<string, string | number> } | { text: string };

class ProblemError extends Error {
  readonly problem: Problem;

  constructor(problem: Problem) {
    super('admin-problem');
    this.problem = problem;
  }
}

function toProblem(error: unknown, fallback: TranslationKey): Problem {
  if (error instanceof ProblemError) {
    return error.problem;
  }
  if (error instanceof Error && error.message) {
    return { text: error.message };
  }
  return { key: fallback };
}

const PLAN_TONES: Record<string, BadgeTone> = {
  free: 'neutral',
  plus: 'plus',
  pro: 'pro',
  ultra: 'ultra',
};

const PLAN_OPTIONS: PlanId[] = [
  'free',
  'plus',
  'pro',
  'ultra',
  'gpt-pro',
  'claude-pro',
  'gemini-pro',
];

const SELECT_CLASS =
  'h-11 rounded-md border border-stroke bg-surface px-3 text-sm text-text shadow-xs transition-[border-color,box-shadow] duration-200 hover:border-stroke-strong focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent-soft';

const SUBTLE_PANEL = 'rounded-xl border border-stroke bg-canvas p-4';

function budgetTone(pct: number): string {
  if (pct >= 90) return 'bg-danger';
  if (pct >= 50) return 'bg-warning';
  return 'bg-accent';
}

/** Узкая заголовочная подпись блока внутри карточки. */
function PanelTitle({ children, icon }: { children: ReactNode; icon?: ReactNode }) {
  return (
    <h3 className="flex items-center gap-2 text-[13px] font-semibold text-text">
      {icon}
      {children}
    </h3>
  );
}

interface KpiProps {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: 'default' | 'accent';
  loading?: boolean;
}

/** Карточка показателя: иконка, значение с табличными цифрами и пояснение. */
function Kpi({ icon, label, value, hint, tone = 'default', loading = false }: KpiProps) {
  return (
    <Card className="flex flex-col gap-3 rounded-2xl p-3.5 sm:p-5">
      <div className="flex items-start gap-2.5 sm:items-center">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent ring-1 ring-accent/20 ring-inset">
          {icon}
        </span>
        <p className="min-w-0 text-[13px] leading-4 font-medium text-muted">{label}</p>
      </div>
      <div>
        {loading ? (
          <Skeleton className="h-8 w-24" />
        ) : (
          <p
            className={cn(
              'text-2xl leading-8 font-semibold tracking-tight tabular-nums sm:text-[28px]',
              tone === 'accent' ? 'text-gradient' : 'text-text',
            )}
          >
            {value}
          </p>
        )}
        {hint ? <p className="mt-1.5 hidden text-xs text-subtle sm:block">{hint}</p> : null}
      </div>
    </Card>
  );
}

function MetricCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className={SUBTLE_PANEL}>
      <p className="text-[13px] font-medium text-muted">{title}</p>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function MetricRow({
  label,
  value,
  tone,
}: {
  label: ReactNode;
  value: ReactNode;
  tone?: 'accent' | 'muted';
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-[13px]">
      <span className="text-muted">{label}</span>
      <span
        className={cn(
          'font-semibold tabular-nums',
          tone === 'accent' ? 'text-accent' : tone === 'muted' ? 'text-muted' : 'text-text',
        )}
      >
        {value}
      </span>
    </div>
  );
}

function UsersSkeleton() {
  return (
    <>
      {Array.from({ length: 6 }, (_, index) => (
        <tr key={index} aria-hidden="true">
          <td className="px-4 py-3.5">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="mt-2 h-3 w-44 max-w-full" />
          </td>
          <td className="hidden px-4 py-3.5 md:table-cell">
            <Skeleton className="h-5 w-16 rounded-full" />
          </td>
          <td className="hidden px-4 py-3.5 lg:table-cell">
            <Skeleton className="h-4 w-14" />
          </td>
          <td className="hidden px-4 py-3.5 lg:table-cell">
            <Skeleton className="h-4 w-16" />
          </td>
          <td className="hidden px-4 py-3.5 sm:table-cell">
            <Skeleton className="h-4 w-24" />
          </td>
          <td className="hidden px-4 py-3.5 xl:table-cell">
            <Skeleton className="h-4 w-20" />
          </td>
          <td className="px-4 py-3.5 text-right">
            <Skeleton className="ml-auto h-9 w-20 rounded-md" />
          </td>
        </tr>
      ))}
    </>
  );
}

function DetailSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-4">
      <div className="grid gap-4 md:grid-cols-2">
        <Skeleton className="h-36 rounded-xl" />
        <Skeleton className="h-36 rounded-xl" />
      </div>
      <Skeleton className="h-28 rounded-xl" />
      <Skeleton className="h-20 rounded-xl" />
    </div>
  );
}

function BudgetMeter({ user, detailed = false }: { user: UserSummary; detailed?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="h-1.5 w-14 shrink-0 overflow-hidden rounded-full bg-surface-3 sm:w-20">
        <div
          className={cn('h-full rounded-full', budgetTone(user.budgetUsedPct))}
          style={{ width: `${Math.min(100, user.budgetUsedPct)}%` }}
        />
      </div>
      <span className="text-xs font-semibold tabular-nums">{user.budgetUsedPct}%</span>
      {detailed ? (
        <span className="hidden text-xs text-muted tabular-nums xl:inline">
          (${user.usage.costThisMonth} / ${user.limits.costBudget ?? 0})
        </span>
      ) : null}
    </div>
  );
}

function PlanBadges({ user }: { user: Pick<UserSummary, 'plan' | 'isVip' | 'isAdmin'> }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Badge tone={PLAN_TONES[user.plan] ?? 'outline'} className="px-2 py-0 text-[11px] uppercase">
        {user.plan}
      </Badge>
      {user.isVip ? (
        <Badge tone="warning" className="px-2 py-0 text-[11px]">
          VIP
        </Badge>
      ) : null}
      {user.isAdmin ? (
        <Badge tone="danger" className="px-2 py-0 text-[11px]">
          ADMIN
        </Badge>
      ) : null}
    </div>
  );
}

export function AdminPage() {
  const { t } = useTranslation();
  const currentUser = useAuth((state) => state.user);
  const token = useAuth((state) => state.token);

  const [adminKey, setAdminKey] = useState<string>(
    () => localStorage.getItem('ketner_admin_key') || 'ketner-ai-admin-key-dev',
  );
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [metrics, setMetrics] = useState<GatewayMetricsData | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [search, setSearch] = useState('');
  const [planFilter, setPlanFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Problem | null>(null);

  // Selected user for details & edit modal
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [detailUser, setDetailUser] = useState<UserDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<Problem | null>(null);

  // Edit form state
  const [editPlan, setEditPlan] = useState<PlanId>('free');
  const [editVip, setEditVip] = useState(false);
  const [editAdmin, setEditAdmin] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<Problem | null>(null);

  const closeDetail = useCallback(() => {
    setSelectedUserId(null);
    setDetailUser(null);
  }, []);

  const describe = (problem: Problem): string =>
    'text' in problem ? problem.text : t(problem.key, problem.vars);

  const getHeaders = useCallback((): HeadersInit => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    if (adminKey) {
      headers['x-admin-key'] = adminKey;
    }
    return headers;
  }, [token, adminKey]);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (planFilter) params.set('plan', planFilter);
      params.set('page', String(page));
      params.set('pageSize', String(pageSize));

      const res = await fetch(`/api/admin/users?${params.toString()}`, {
        headers: getHeaders(),
        credentials: 'include',
      });

      if (!res.ok) {
        if (res.status === 403) {
          throw new ProblemError({ key: 'admin.errForbidden' });
        }
        const body = (await res.json()) as { error?: { message?: string } };
        throw new ProblemError(
          body.error?.message
            ? { text: body.error.message }
            : { key: 'admin.errServer', vars: { status: res.status } },
        );
      }

      const data = (await res.json()) as {
        users: UserSummary[];
        total: number;
        page: number;
        pageSize: number;
      };
      setUsers(data.users || []);
      setTotal(data.total || 0);
    } catch (err: unknown) {
      setError(toProblem(err, 'admin.errLoadUsers'));
    } finally {
      setLoading(false);
    }
  }, [search, planFilter, page, pageSize, getHeaders]);

  const loadMetrics = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/metrics', {
        headers: getHeaders(),
        credentials: 'include',
      });
      if (res.ok) {
        const data = (await res.json()) as { metrics: GatewayMetricsData };
        setMetrics(data.metrics);
      }
    } catch {
      // ignore
    }
  }, [getHeaders]);

  useEffect(() => {
    void loadUsers();
    void loadMetrics();
  }, [loadUsers, loadMetrics]);

  const loadUserDetail = async (id: string) => {
    setSelectedUserId(id);
    setDetailLoading(true);
    setDetailError(null);
    setSaveSuccess(false);
    setSaveError(null);
    try {
      const res = await fetch(`/api/admin/users/${id}`, {
        headers: getHeaders(),
        credentials: 'include',
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: { message?: string } };
        throw new ProblemError(
          body.error?.message
            ? { text: body.error.message }
            : { key: 'admin.errDetail', vars: { status: res.status } },
        );
      }
      const data = (await res.json()) as UserDetail;
      setDetailUser(data);
      setEditPlan(data.plan);
      setEditVip(data.isVip);
      setEditAdmin(data.isAdmin);
    } catch (err: unknown) {
      setDetailError(toProblem(err, 'admin.errDetailFallback'));
    } finally {
      setDetailLoading(false);
    }
  };

  const handleSaveUser = async () => {
    if (!selectedUserId) return;
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    try {
      const res = await fetch(`/api/admin/users/${selectedUserId}`, {
        method: 'PATCH',
        headers: getHeaders(),
        credentials: 'include',
        body: JSON.stringify({
          plan: editPlan,
          isVip: editVip,
          isAdmin: editAdmin,
        }),
      });

      if (!res.ok) {
        const body = (await res.json()) as { error?: { message?: string } };
        throw new ProblemError(
          body.error?.message
            ? { text: body.error.message }
            : { key: 'admin.errUpdate', vars: { status: res.status } },
        );
      }

      setSaveSuccess(true);
      await loadUserDetail(selectedUserId);
      await loadUsers();
    } catch (err: unknown) {
      setSaveError(toProblem(err, 'admin.errSaveFallback'));
    } finally {
      setSaving(false);
    }
  };

  const isSelf =
    detailUser &&
    currentUser &&
    (currentUser.id === detailUser.id ||
      currentUser.email.toLowerCase() === detailUser.email.toLowerCase());

  const hasData = users.length > 0;
  const showKpiSkeleton = loading && !hasData;

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 text-text md:py-8">
      {/* Header */}
      <header className="relative flex flex-col gap-5 overflow-hidden rounded-2xl border border-stroke bg-surface p-5 sm:p-6 lg:flex-row lg:items-end lg:justify-between">
        <div
          aria-hidden="true"
          className="bg-aurora pointer-events-none absolute inset-0 opacity-50 [mask-image:linear-gradient(to_right,black,transparent_70%)]"
        />
        <div className="relative min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl font-semibold tracking-tight text-balance text-text md:text-[28px]">
              {t('admin.title')}
            </h1>
            <Badge tone="brand">Admin</Badge>
          </div>
          <p className="mt-2 max-w-[60ch] text-sm leading-6 text-muted">{t('admin.lead')}</p>
        </div>

        {/* Admin Key Switcher */}
        <div className="relative flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="flex flex-col gap-1.5 sm:w-64">
            <span className="flex items-center gap-1.5 text-[13px] font-medium text-muted">
              <KeyIcon className="size-3.5" />
              {t('admin.keyLabel')}
            </span>
            <Input
              type="password"
              value={adminKey}
              onChange={(e) => {
                setAdminKey(e.target.value);
                localStorage.setItem('ketner_admin_key', e.target.value);
              }}
              placeholder="x-admin-key"
              autoComplete="off"
              className="font-mono text-sm"
            />
          </label>
          <Button
            variant="secondary"
            size="md"
            className="h-12 sm:h-11"
            leftIcon={<RefreshIcon className={cn('size-4', loading && 'animate-spin')} />}
            onClick={() => {
              void loadUsers();
              void loadMetrics();
            }}
          >
            {t('admin.refresh')}
          </Button>
        </div>
      </header>

      {/* KPI Cards */}
      <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Kpi
          icon={<UserIcon className="size-[18px]" />}
          label={t('admin.kpiUsers')}
          value={total}
          loading={showKpiSkeleton}
        />
        <Kpi
          icon={<MessagesIcon className="size-[18px]" />}
          label={t('admin.kpiRequests')}
          value={users.reduce((sum, u) => sum + (u.usage?.requestsToday || 0), 0)}
          hint={t('admin.kpiScope')}
          tone="accent"
          loading={showKpiSkeleton}
        />
        <Kpi
          icon={<BoltIcon className="size-[18px]" />}
          label={t('admin.kpiTokens')}
          value={users.reduce((sum, u) => sum + (u.usage?.tokensToday || 0), 0).toLocaleString()}
          hint={t('admin.kpiScope')}
          loading={showKpiSkeleton}
        />
        <Kpi
          icon={<ChartIcon className="size-[18px]" />}
          label={t('admin.kpiSpend')}
          value={`$${users.reduce((sum, u) => sum + (u.usage?.costThisMonth || 0), 0).toFixed(2)}`}
          hint={t('admin.kpiScope')}
          tone="accent"
          loading={showKpiSkeleton}
        />
      </section>

      {/* Phase 4: Алерт отрицательной маржинальности */}
      {metrics?.hasNegativeMarginAlert && (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-2xl border border-danger/35 bg-danger-soft p-4 sm:p-5"
        >
          <div className="flex items-start gap-3">
            <AlertIcon className="mt-0.5 size-5 shrink-0 text-danger" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-danger">{t('admin.marginAlertTitle')}</p>
              <p className="mt-1 text-[13px] leading-5 text-muted">{t('admin.marginAlertText')}</p>
            </div>
          </div>
          <ul className="flex flex-col gap-2">
            {metrics.alerts.map((alert, idx) => (
              <li
                key={idx}
                className="flex flex-col gap-1 rounded-lg border border-danger/20 bg-surface/80 px-3 py-2 text-[13px] sm:flex-row sm:items-center sm:justify-between sm:gap-3"
              >
                <span className="flex min-w-0 flex-wrap items-center gap-2 text-text">
                  <span className="min-w-0 break-all">{alert.userEmail}</span>
                  <Badge
                    tone={PLAN_TONES[alert.plan] ?? 'outline'}
                    className="px-2 py-0 text-[11px] uppercase"
                  >
                    {alert.plan}
                  </Badge>
                </span>
                <span className="font-medium text-danger tabular-nums">
                  {t('admin.marginAlertLine', {
                    cost: alert.aiCost,
                    revenue: alert.subscriptionRevenue,
                    margin: alert.contributionMargin,
                  })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Phase 4: Метрики шлюза (Cache Hit Rate, Latency, TTFT, Источники и Тарифы) */}
      {metrics && (
        <Card className="flex flex-col gap-4 rounded-2xl p-4 sm:p-5">
          <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="flex items-center gap-2.5 text-base font-semibold tracking-tight text-text">
              <span className="grid size-8 place-items-center rounded-lg bg-accent-soft text-accent ring-1 ring-accent/20 ring-inset">
                <CpuIcon className="size-4" />
              </span>
              {t('admin.gatewayTitle')}
            </h2>
            <p className="text-[13px] text-muted tabular-nums">
              {t('admin.gatewayTotals', {
                requests: metrics.totalRequests,
                cost: metrics.totalCost,
              })}
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard title={t('admin.cacheHitRate')}>
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-gradient text-2xl font-semibold tabular-nums">
                  {metrics.cacheHitRatePct}%
                </span>
                <span className="text-xs text-muted tabular-nums">
                  {t('admin.cacheHits', { hits: metrics.cacheHits, total: metrics.totalRequests })}
                </span>
              </div>
              <p className="mt-1 text-xs text-subtle">{t('admin.cacheSaving')}</p>
            </MetricCard>

            <MetricCard title={t('admin.latency')}>
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-2xl font-semibold text-text tabular-nums">
                  {metrics.latency.averageLatencyMs} ms
                </span>
                <span className="text-xs text-muted tabular-nums">
                  P95: {metrics.latency.p95LatencyMs} ms
                </span>
              </div>
              <p className="mt-1 text-xs text-subtle tabular-nums">
                TTFT: {metrics.latency.averageTtftMs ?? '-'} ms
              </p>
            </MetricCard>

            <MetricCard title={t('admin.costBySource')}>
              <div className="flex flex-col gap-1">
                <MetricRow
                  label={t('admin.sourceProvider')}
                  value={`$${metrics.costBySource.provider.cost}`}
                />
                <MetricRow
                  label={t('admin.sourceCache')}
                  value={`$0.00 · ${t('admin.requestsShort', { count: metrics.costBySource.cache.requests })}`}
                  tone="accent"
                />
                <MetricRow
                  label={t('admin.sourceTemplate')}
                  value={`$0.00 · ${t('admin.requestsShort', { count: metrics.costBySource.template.requests })}`}
                  tone="muted"
                />
              </div>
            </MetricCard>

            <MetricCard title={t('admin.costByPlan')}>
              <div className="flex flex-col gap-1">
                {metrics.costByPlan.slice(0, 3).map((p) => (
                  <MetricRow
                    key={p.plan}
                    label={<span className="capitalize">{p.plan}</span>}
                    value={`$${p.totalCost}${p.costSharePct !== undefined ? ` (${p.costSharePct}%)` : ''} · ${t('admin.requestsShort', { count: p.requests })}`}
                  />
                ))}
              </div>
            </MetricCard>
          </div>

          {metrics.models30d && (
            <div className="flex flex-col gap-2">
              <div>
                <p className="text-sm font-semibold text-text">{t('admin.models30dTitle')}</p>
                <p className="text-xs text-subtle">{t('admin.models30dHint')}</p>
              </div>
              <ModelUsageTable models={metrics.models30d} />
            </div>
          )}
        </Card>
      )}

      {/* Filter and Search Bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative w-full sm:w-80">
            <SearchIcon
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-subtle"
            />
            <Input
              type="search"
              aria-label={t('admin.searchLabel')}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder={t('admin.searchPlaceholder')}
              className="pl-10"
            />
          </div>

          <select
            aria-label={t('admin.planFilter')}
            value={planFilter}
            onChange={(e) => {
              setPlanFilter(e.target.value);
              setPage(1);
            }}
            className={cn(SELECT_CLASS, 'h-12 md:h-11')}
          >
            <option value="">{t('admin.allPlans')}</option>
            <option value="free">Free</option>
            <option value="plus">Plus</option>
            <option value="pro">Pro</option>
            <option value="ultra">Ultra</option>
            <option value="gpt-pro">GPT Pro (Legacy)</option>
            <option value="claude-pro">Claude Pro (Legacy)</option>
            <option value="gemini-pro">Gemini Pro (Legacy)</option>
          </select>
        </div>

        <p className="text-[13px] text-muted">
          {t('admin.sort')}: <span className="font-medium text-text">{t('admin.sortValue')}</span>
        </p>
      </div>

      {/* Error Message with Quick Unlock */}
      {error ? (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-2xl border border-danger/35 bg-danger-soft p-4 sm:p-5"
        >
          <div className="flex items-start gap-3">
            <ShieldIcon className="mt-0.5 size-5 shrink-0 text-danger" />
            <div className="min-w-0 text-sm">
              <p className="font-semibold text-danger">{t('admin.accessError')}</p>
              <p className="mt-1 leading-6 text-muted">{describe(error)}</p>
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                const devKey = 'ketner-ai-admin-key-dev';
                setAdminKey(devKey);
                localStorage.setItem('ketner_admin_key', devKey);
                void loadUsers();
              }}
              className="h-auto min-h-9 py-2 whitespace-normal"
            >
              {t('admin.useDevKey')} (ketner-ai-admin-key-dev)
            </Button>
            <Button size="sm" variant="secondary" onClick={() => void loadUsers()}>
              {t('admin.retry')}
            </Button>
          </div>
        </div>
      ) : null}

      {/* Users Table */}
      <Card className="overflow-hidden rounded-2xl p-0">
        <span role="status" className="sr-only">
          {loading ? t('admin.loadingUsers') : ''}
        </span>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]" aria-busy={loading}>
            <thead className="border-b border-stroke bg-surface-2 text-xs font-medium text-muted">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t('admin.colUser')}
                </th>
                <th scope="col" className="hidden px-4 py-3 font-medium md:table-cell">
                  {t('admin.colPlan')}
                </th>
                <th scope="col" className="hidden px-4 py-3 font-medium lg:table-cell">
                  {t('admin.colRequests')}
                </th>
                <th scope="col" className="hidden px-4 py-3 font-medium lg:table-cell">
                  {t('admin.colTokens')}
                </th>
                <th scope="col" className="hidden px-4 py-3 font-medium sm:table-cell">
                  {t('admin.colBudget')}
                </th>
                <th scope="col" className="hidden px-4 py-3 font-medium xl:table-cell">
                  {t('admin.colRemaining')}
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  {t('admin.colAction')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stroke">
              {loading && !hasData ? (
                <UsersSkeleton />
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-14 text-center">
                    <div className="mx-auto flex max-w-xs flex-col items-center gap-2">
                      <span className="grid size-11 place-items-center rounded-xl bg-surface-2 text-subtle ring-1 ring-stroke ring-inset">
                        <SearchIcon className="size-5" />
                      </span>
                      <p className="text-sm font-medium text-text">{t('admin.empty')}</p>
                      <p className="text-[13px] leading-5 text-muted">{t('admin.emptyHint')}</p>
                    </div>
                  </td>
                </tr>
              ) : (
                users.map((u) => (
                  <tr
                    key={u.id}
                    className={cn(
                      'cursor-pointer transition-colors hover:bg-surface-2/60',
                      loading && 'opacity-60',
                    )}
                    onClick={() => void loadUserDetail(u.id)}
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-text">{u.name || t('admin.noName')}</div>
                      <div className="mt-0.5 max-w-[42vw] truncate text-xs text-muted sm:max-w-[260px]">
                        {u.email}
                      </div>
                      <div className="mt-1.5 md:hidden">
                        <PlanBadges user={u} />
                      </div>
                      <div className="mt-2 sm:hidden">
                        <BudgetMeter user={u} />
                      </div>
                    </td>
                    <td className="hidden px-4 py-3 md:table-cell">
                      <PlanBadges user={u} />
                    </td>
                    <td className="hidden px-4 py-3 tabular-nums lg:table-cell">
                      <span className="font-semibold text-text">{u.usage.requestsToday}</span>
                      <span className="text-muted">
                        {' '}
                        / {u.limits.requestsPerDay !== null ? u.limits.requestsPerDay : '∞'}
                      </span>
                    </td>
                    <td className="hidden px-4 py-3 tabular-nums lg:table-cell">
                      {u.usage.tokensToday.toLocaleString()}
                    </td>
                    <td className="hidden px-4 py-3 sm:table-cell">
                      <BudgetMeter user={u} detailed />
                    </td>
                    <td className="hidden px-4 py-3 tabular-nums xl:table-cell">
                      {u.remaining.tokensToday !== null ? (
                        <span
                          className={
                            u.remaining.tokensToday < 0 ? 'font-semibold text-danger' : 'text-text'
                          }
                        >
                          {u.remaining.tokensToday.toLocaleString()}
                        </span>
                      ) : (
                        <span className="text-muted">{t('admin.unlimited')}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        size="sm"
                        variant="secondary"
                        aria-label={t('admin.detailsFor', { name: u.name || u.email })}
                        onClick={(e) => {
                          e.stopPropagation();
                          void loadUserDetail(u.id);
                        }}
                      >
                        {t('admin.details')}
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {hasData ? (
          <p className="border-t border-stroke px-4 py-3 text-xs text-muted tabular-nums">
            {t('admin.shown', { shown: users.length, total })}
          </p>
        ) : null}
      </Card>

      {/* User Details & Edit Modal */}
      {selectedUserId ? (
        <Modal labelledBy="admin-user-title" onClose={closeDetail} size="lg">
          <ModalHeader
            titleId="admin-user-title"
            title={t('admin.modalTitle')}
            description={
              <span className="break-all tabular-nums">
                {t('admin.modalId', { id: selectedUserId })}
              </span>
            }
            icon={<UserIcon className="size-5" />}
            onClose={closeDetail}
          />

          <div className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-6">
            {detailLoading ? (
              <DetailSkeleton />
            ) : detailError ? (
              <div
                role="alert"
                className="flex items-start gap-3 rounded-xl border border-danger/35 bg-danger-soft p-4 text-sm text-danger"
              >
                <AlertIcon className="mt-0.5 size-4 shrink-0" />
                {describe(detailError)}
              </div>
            ) : detailUser ? (
              <>
                {/* Profile & Edit Section */}
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {/* User Info */}
                  <div className={cn(SUBTLE_PANEL, 'space-y-3')}>
                    <PanelTitle icon={<UserIcon className="size-4 text-accent" />}>
                      {t('admin.profile')}
                    </PanelTitle>
                    <dl className="space-y-2 text-[13px]">
                      <div className="flex justify-between gap-3">
                        <dt className="shrink-0 text-muted">{t('admin.email')}</dt>
                        <dd className="min-w-0 text-right break-all text-text">
                          {detailUser.email}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt className="shrink-0 text-muted">{t('admin.name')}</dt>
                        <dd className="min-w-0 text-right font-medium break-words text-text">
                          {detailUser.name}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt className="shrink-0 text-muted">{t('admin.registered')}</dt>
                        <dd className="text-right text-text tabular-nums">
                          {new Date(detailUser.createdAt).toLocaleString()}
                        </dd>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <dt className="shrink-0 text-muted">{t('admin.plan')}</dt>
                        <dd>
                          <Badge
                            tone={PLAN_TONES[detailUser.plan] ?? 'brand'}
                            className="uppercase"
                          >
                            {detailUser.plan}
                          </Badge>
                        </dd>
                      </div>
                    </dl>
                  </div>

                  {/* Quick Edit Form */}
                  <div className={cn(SUBTLE_PANEL, 'space-y-3')}>
                    <div className="flex items-center justify-between gap-2">
                      <PanelTitle icon={<EditIcon className="size-4 text-accent" />}>
                        {t('admin.manage')}
                      </PanelTitle>
                      {isSelf ? <Badge tone="brand">{t('admin.yourAccount')}</Badge> : null}
                    </div>

                    <div className="grid grid-cols-1 gap-3 text-[13px] sm:grid-cols-2">
                      <label className="flex flex-col gap-1.5">
                        <span className="text-muted">{t('admin.changePlan')}</span>
                        <select
                          value={editPlan}
                          onChange={(e) => setEditPlan(e.target.value as PlanId)}
                          className={SELECT_CLASS}
                        >
                          {PLAN_OPTIONS.map((plan) => (
                            <option key={plan} value={plan}>
                              {plan}
                            </option>
                          ))}
                        </select>
                      </label>

                      <div className="flex flex-col justify-end">
                        <label className="flex min-h-11 cursor-pointer items-center gap-2.5">
                          <input
                            type="checkbox"
                            checked={editVip}
                            onChange={(e) => setEditVip(e.target.checked)}
                            className="size-[18px] accent-accent"
                          />
                          <span>{t('admin.vip')}</span>
                        </label>

                        <label className="flex min-h-11 cursor-pointer items-center gap-2.5 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60">
                          <input
                            type="checkbox"
                            checked={editAdmin}
                            disabled={Boolean(isSelf)}
                            onChange={(e) => setEditAdmin(e.target.checked)}
                            className="size-[18px] accent-accent"
                          />
                          <span>{t('admin.adminRights')}</span>
                        </label>
                      </div>
                    </div>

                    {saveError ? (
                      <p role="alert" className="text-[13px] font-medium text-danger">
                        {describe(saveError)}
                      </p>
                    ) : null}
                    {saveSuccess ? (
                      <p
                        role="status"
                        className="flex items-center gap-1.5 text-[13px] font-medium text-success"
                      >
                        <CheckIcon className="size-3.5" /> {t('admin.saved')}
                      </p>
                    ) : null}

                    <Button
                      variant="primary"
                      onClick={() => void handleSaveUser()}
                      loading={saving}
                      className="w-full"
                    >
                      {saving ? t('admin.saving') : t('admin.apply')}
                    </Button>
                  </div>
                </div>

                {/* Hourly & Daily Limits Comparison */}
                <div className={cn(SUBTLE_PANEL, 'space-y-3')}>
                  <PanelTitle icon={<BoltIcon className="size-4 text-accent" />}>
                    {t('admin.limits')}
                  </PanelTitle>
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    {(
                      [
                        [
                          'admin.reqHour',
                          detailUser.usage.requestsLastHour,
                          detailUser.limits.requestsPerHour,
                        ],
                        [
                          'admin.reqDay',
                          detailUser.usage.requestsToday,
                          detailUser.limits.requestsPerDay,
                        ],
                        [
                          'admin.tokHour',
                          detailUser.usage.tokensLastHour,
                          detailUser.limits.tokensPerHour,
                        ],
                        [
                          'admin.tokDay',
                          detailUser.usage.tokensToday,
                          detailUser.limits.tokensPerDay,
                        ],
                      ] as const
                    ).map(([labelKey, used, limit]) => (
                      <div
                        key={labelKey}
                        className="rounded-xl border border-stroke bg-surface p-3"
                      >
                        <span className="block text-xs text-muted">{t(labelKey)}</span>
                        <p className="mt-1 text-lg font-semibold tabular-nums">
                          {used.toLocaleString()}{' '}
                          <span className="text-xs font-normal text-muted">
                            / {limit !== null ? limit.toLocaleString() : '∞'}
                          </span>
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Profitability Card */}
                <div className={cn(SUBTLE_PANEL, 'space-y-3')}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <PanelTitle icon={<ChartIcon className="size-4 text-accent" />}>
                      {t('admin.profit')}
                    </PanelTitle>
                    <div className="flex items-center gap-1.5 text-[13px] font-medium">
                      <StatusDot
                        tone={
                          detailUser.profitability.status === 'profitable'
                            ? 'success'
                            : detailUser.profitability.status === 'low_margin'
                              ? 'warning'
                              : 'danger'
                        }
                      />
                      <span>
                        {detailUser.profitability.status === 'profitable'
                          ? t('admin.profitable')
                          : detailUser.profitability.status === 'low_margin'
                            ? t('admin.lowMargin')
                            : t('admin.lossMaking')}
                      </span>
                    </div>
                  </div>
                  <dl className="grid grid-cols-1 gap-3 text-[13px] sm:grid-cols-3">
                    <div className="rounded-xl border border-stroke bg-surface p-3">
                      <dt className="text-xs text-muted">{t('admin.revenue')}</dt>
                      <dd className="mt-1 font-semibold text-text tabular-nums">
                        ${detailUser.profitability.subscriptionRevenue.toFixed(2)}{' '}
                        <span className="font-normal text-muted">
                          ({detailUser.profitability.priceRub} ₽)
                        </span>
                      </dd>
                    </div>
                    <div className="rounded-xl border border-stroke bg-surface p-3">
                      <dt className="text-xs text-muted">{t('admin.aiCost')}</dt>
                      <dd className="mt-1 font-semibold text-danger tabular-nums">
                        ${detailUser.profitability.aiCost.toFixed(2)}
                      </dd>
                    </div>
                    <div className="rounded-xl border border-stroke bg-surface p-3">
                      <dt className="text-xs text-muted">{t('admin.margin')}</dt>
                      <dd
                        className={cn(
                          'mt-1 font-semibold tabular-nums',
                          detailUser.profitability.contributionMargin >= 0
                            ? 'text-success'
                            : 'text-danger',
                        )}
                      >
                        ${detailUser.profitability.contributionMargin.toFixed(2)}
                      </dd>
                    </div>
                  </dl>
                </div>

                {/* Recent 20 Requests */}
                <div className={cn(SUBTLE_PANEL, 'space-y-3')}>
                  <PanelTitle icon={<MessagesIcon className="size-4 text-accent" />}>
                    {t('admin.recent', { count: detailUser.recentRequests.length })}
                  </PanelTitle>
                  <div className="max-h-64 overflow-auto rounded-lg border border-stroke bg-surface">
                    {detailUser.recentRequests.length === 0 ? (
                      <p className="py-8 text-center text-[13px] text-muted">
                        {t('admin.noRequests')}
                      </p>
                    ) : (
                      <table className="w-full min-w-[560px] text-left text-xs">
                        <thead className="sticky top-0 border-b border-stroke bg-surface-2 text-muted">
                          <tr>
                            <th scope="col" className="px-3 py-2 font-medium">
                              {t('admin.colTime')}
                            </th>
                            <th scope="col" className="px-3 py-2 font-medium">
                              {t('admin.colModel')}
                            </th>
                            <th scope="col" className="px-3 py-2 font-medium">
                              {t('admin.colProvider')}
                            </th>
                            <th scope="col" className="px-3 py-2 font-medium">
                              {t('admin.colTokensShort')}
                            </th>
                            <th scope="col" className="px-3 py-2 font-medium">
                              {t('admin.colCost')}
                            </th>
                            <th scope="col" className="px-3 py-2 font-medium">
                              {t('admin.colLatency')}
                            </th>
                            <th scope="col" className="px-3 py-2 font-medium">
                              {t('admin.colStatus')}
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-stroke tabular-nums">
                          {detailUser.recentRequests.map((r) => (
                            <tr key={r.id}>
                              <td className="px-3 py-2 text-muted">
                                {new Date(r.createdAt).toLocaleTimeString()}
                              </td>
                              <td className="px-3 py-2 font-medium text-text">{r.modelId}</td>
                              <td className="px-3 py-2 text-muted">{r.provider}</td>
                              <td className="px-3 py-2">{r.inputTokens + r.outputTokens}</td>
                              <td className="px-3 py-2">${r.estimatedCost.toFixed(5)}</td>
                              <td className="px-3 py-2 text-muted">{r.latencyMs}ms</td>
                              <td className="px-3 py-2">
                                <span
                                  className={
                                    r.status === 'success' ? 'text-success' : 'text-danger'
                                  }
                                >
                                  {r.status}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              </>
            ) : null}
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
