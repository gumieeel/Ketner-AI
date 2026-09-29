import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/features/auth/auth-store';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Divider } from '@/components/ui/divider';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { StatusDot } from '@/components/ui/status-dot';
import { SearchIcon, CloseIcon, EditIcon, CheckIcon } from '@/components/icons';
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

export function AdminPage() {
  const currentUser = useAuth((state) => state.user);
  const token = useAuth((state) => state.token);

  const [adminKey, setAdminKey] = useState<string>(
    () => localStorage.getItem('ketner_admin_key') || 'ketner-ai-admin-key-dev',
  );
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [search, setSearch] = useState('');
  const [planFilter, setPlanFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Selected user for details & edit modal
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [detailUser, setDetailUser] = useState<UserDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  // Edit form state
  const [editPlan, setEditPlan] = useState<PlanId>('free');
  const [editVip, setEditVip] = useState(false);
  const [editAdmin, setEditAdmin] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Esc key listener to close modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectedUserId) {
        setSelectedUserId(null);
        setDetailUser(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedUserId]);

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
          throw new Error('Доступ запрещён: требуются права администратора или верный Admin API Key');
        }
        const body = (await res.json()) as { error?: { message?: string } };
        throw new Error(body.error?.message || `Ошибка сервера (${res.status})`);
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
      setError(err instanceof Error ? err.message : 'Не удалось загрузить пользователей');
    } finally {
      setLoading(false);
    }
  }, [search, planFilter, page, pageSize, getHeaders]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

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
        throw new Error(body.error?.message || `Ошибка загрузки (${res.status})`);
      }
      const data = (await res.json()) as UserDetail;
      setDetailUser(data);
      setEditPlan(data.plan);
      setEditVip(data.isVip);
      setEditAdmin(data.isAdmin);
    } catch (err: unknown) {
      setDetailError(err instanceof Error ? err.message : 'Ошибка загрузки карточки пользователя');
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
        throw new Error(body.error?.message || `Ошибка обновления (${res.status})`);
      }

      setSaveSuccess(true);
      await loadUserDetail(selectedUserId);
      await loadUsers();
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : 'Не удалось сохранить изменения');
    } finally {
      setSaving(false);
    }
  };

  const isSelf = detailUser && currentUser && (currentUser.id === detailUser.id || currentUser.email.toLowerCase() === detailUser.email.toLowerCase());

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-8 text-text">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-stroke pb-5">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-semibold tracking-tight text-text">
              Обзорная панель администратора
            </h1>
            <Badge tone="brand">Admin</Badge>
          </div>
          <p className="mt-1 text-sm text-muted">
            Мониторинг пользователей, расходов токенов, соблюдения лимитов и управление доступом.
          </p>
        </div>

        {/* Admin Key Switcher */}
        <div className="flex items-center gap-2 rounded-lg bg-surface p-2 text-xs border border-stroke">
          <span className="text-muted">Ключ доступа:</span>
          <input
            type="password"
            value={adminKey}
            onChange={(e) => {
              setAdminKey(e.target.value);
              localStorage.setItem('ketner_admin_key', e.target.value);
            }}
            placeholder="x-admin-key"
            className="w-48 rounded bg-canvas px-2.5 py-1 text-text border border-stroke font-mono text-xs outline-none focus:border-accent"
          />
          <Button size="sm" variant="secondary" onClick={() => void loadUsers()}>
            Обновить
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-4 border-stroke bg-surface">
          <p className="text-[11px] font-mono text-muted uppercase tracking-wider">Всего пользователей</p>
          <p className="mt-1 text-2xl font-semibold font-mono text-text">{total}</p>
        </Card>
        <Card className="p-4 border-stroke bg-surface">
          <p className="text-[11px] font-mono text-muted uppercase tracking-wider">Запросов сегодня</p>
          <p className="mt-1 text-2xl font-semibold font-mono text-accent">
            {users.reduce((sum, u) => sum + (u.usage?.requestsToday || 0), 0)}
          </p>
        </Card>
        <Card className="p-4 border-stroke bg-surface">
          <p className="text-[11px] font-mono text-muted uppercase tracking-wider">Токенов сегодня</p>
          <p className="mt-1 text-2xl font-semibold font-mono text-text">
            {users.reduce((sum, u) => sum + (u.usage?.tokensToday || 0), 0).toLocaleString()}
          </p>
        </Card>
        <Card className="p-4 border-stroke bg-surface">
          <p className="text-[11px] font-mono text-muted uppercase tracking-wider">Расход за месяц</p>
          <p className="mt-1 text-2xl font-semibold font-mono text-accent">
            ${users.reduce((sum, u) => sum + (u.usage?.costThisMonth || 0), 0).toFixed(2)}
          </p>
        </Card>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-64 sm:w-80">
            <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-muted text-sm" />
            <Input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Поиск по email или имени..."
              className="pl-9 text-xs"
            />
          </div>

          <select
            value={planFilter}
            onChange={(e) => {
              setPlanFilter(e.target.value);
              setPage(1);
            }}
            className="rounded-md border border-stroke bg-surface px-3 py-1.5 text-xs text-text outline-none focus:border-accent"
          >
            <option value="">Все тарифы</option>
            <option value="free">Free</option>
            <option value="plus">Plus</option>
            <option value="pro">Pro</option>
            <option value="ultra">Ultra</option>
            <option value="gpt-pro">GPT Pro (Legacy)</option>
            <option value="claude-pro">Claude Pro (Legacy)</option>
            <option value="gemini-pro">Gemini Pro (Legacy)</option>
          </select>
        </div>

        <div className="flex items-center gap-2 text-xs text-muted font-mono">
          Сортировка: <span className="font-semibold text-text">% Бюджета (убывание)</span>
        </div>
      </div>

      {/* Error Message with Quick Unlock */}
      {error ? (
        <div className="flex flex-col gap-3 rounded-lg border border-danger/30 bg-danger/10 p-4 text-xs text-danger">
          <div className="flex items-center gap-2">
            <span className="font-semibold">Ошибка доступа:</span>
            <span>{error}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                const devKey = 'ketner-ai-admin-key-dev';
                setAdminKey(devKey);
                localStorage.setItem('ketner_admin_key', devKey);
                void loadUsers();
              }}
              className="text-xs"
            >
              Использовать стандартный ключ разработчика (ketner-ai-admin-key-dev)
            </Button>
            <Button size="sm" variant="secondary" onClick={() => void loadUsers()} className="text-xs">
              Повторить запрос
            </Button>
          </div>
        </div>
      ) : null}

      {/* Users Table */}
      <div className="overflow-x-auto rounded-lg border border-stroke bg-surface">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 z-10 border-b border-stroke bg-surface-2 text-[11px] font-mono uppercase tracking-wider text-muted">
            <tr>
              <th className="px-4 py-3">Пользователь</th>
              <th className="px-4 py-3">Тариф / Роль</th>
              <th className="px-4 py-3">Запросы (сегодня)</th>
              <th className="px-4 py-3">Токены (сегодня)</th>
              <th className="px-4 py-3">Бюджет (мес)</th>
              <th className="px-4 py-3">Остаток токенов</th>
              <th className="px-4 py-3 text-right">Действие</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stroke">
            {loading ? (
              <tr>
                <td colSpan={7} className="py-12 text-center">
                  <Spinner className="mx-auto size-6 text-accent" />
                </td>
              </tr>
            ) : users.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-12 text-center text-muted">
                  Пользователи не найдены
                </td>
              </tr>
            ) : (
              users.map((u) => (
                <tr
                  key={u.id}
                  className="hover:bg-surface-2/60 cursor-pointer transition-colors"
                  onClick={() => void loadUserDetail(u.id)}
                >
                  <td className="px-4 py-3">
                    <div className="font-medium text-text">{u.name || 'Без имени'}</div>
                    <div className="text-[11px] text-muted font-mono">{u.email}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-1.5 font-mono">
                      <Badge
                        tone={
                          u.plan === 'ultra'
                            ? 'brand'
                            : u.plan === 'pro'
                              ? 'neutral'
                              : 'outline'
                        }
                        className="text-[10px] py-0 px-1.5"
                      >
                        {u.plan.toUpperCase()}
                      </Badge>
                      {u.isVip ? (
                        <span className="rounded bg-surface-2 border border-stroke px-1.5 py-0.5 text-[10px] font-semibold text-accent">
                          VIP
                        </span>
                      ) : null}
                      {u.isAdmin ? (
                        <span className="rounded bg-danger/10 border border-danger/30 px-1.5 py-0.5 text-[10px] font-semibold text-danger">
                          ADMIN
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono">
                    <span className="font-semibold text-text">{u.usage.requestsToday}</span>
                    {u.limits.requestsPerDay !== null ? (
                      <span className="text-muted"> / {u.limits.requestsPerDay}</span>
                    ) : (
                      <span className="text-muted"> / ∞</span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono">
                    {u.usage.tokensToday.toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-3 border border-stroke">
                        <div
                          className={`h-full ${
                            u.budgetUsedPct >= 90
                              ? 'bg-danger'
                              : u.budgetUsedPct >= 50
                                ? 'bg-warning'
                                : 'bg-accent'
                          }`}
                          style={{ width: `${Math.min(100, u.budgetUsedPct)}%` }}
                        />
                      </div>
                      <span className="font-mono text-[11px] font-semibold">{u.budgetUsedPct}%</span>
                      <span className="text-[11px] text-muted font-mono">
                        (${u.usage.costThisMonth} / ${u.limits.costBudget ?? 0})
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono">
                    {u.remaining.tokensToday !== null ? (
                      <span
                        className={
                          u.remaining.tokensToday < 0
                            ? 'font-semibold text-danger'
                            : 'text-text'
                        }
                      >
                        {u.remaining.tokensToday.toLocaleString()}
                      </span>
                    ) : (
                      <span className="text-muted font-sans">Безлимит</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={(e) => {
                        e.stopPropagation();
                        void loadUserDetail(u.id);
                      }}
                      className="text-xs"
                    >
                      Детали
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* User Details & Edit Modal */}
      {selectedUserId ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm animate-fade-in">
          <div className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-xl border border-stroke bg-surface shadow-2xl overflow-hidden text-text">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-stroke px-6 py-4 bg-surface-2">
              <div>
                <h2 className="text-base font-semibold text-text">Карточка пользователя</h2>
                <p className="text-xs font-mono text-muted mt-0.5">ID: {selectedUserId}</p>
              </div>
              <button
                onClick={() => {
                  setSelectedUserId(null);
                  setDetailUser(null);
                }}
                className="rounded-md p-1.5 text-muted hover:bg-surface hover:text-text transition-colors"
                title="Закрыть (Esc)"
              >
                <CloseIcon className="text-sm" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {detailLoading ? (
                <div className="py-20 text-center">
                  <Spinner className="mx-auto size-8 text-accent" />
                </div>
              ) : detailError ? (
                <div className="rounded-lg bg-danger/10 border border-danger/30 p-4 text-xs text-danger">
                  {detailError}
                </div>
              ) : detailUser ? (
                <>
                  {/* Profile & Edit Section */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* User Info */}
                    <div className="rounded-lg border border-stroke bg-canvas p-4 space-y-2.5">
                      <h3 className="font-semibold text-xs uppercase font-mono tracking-wider text-muted">
                        Профиль
                      </h3>
                      <div className="text-xs space-y-1.5">
                        <div>
                          <span className="text-muted">Email:</span>{' '}
                          <span className="font-mono text-text">{detailUser.email}</span>
                        </div>
                        <div>
                          <span className="text-muted">Имя:</span>{' '}
                          <span className="font-medium text-text">{detailUser.name}</span>
                        </div>
                        <div>
                          <span className="text-muted">Регистрация:</span>{' '}
                          <span className="font-mono text-text">
                            {new Date(detailUser.createdAt).toLocaleString()}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted">Тариф:</span>{' '}
                          <Badge tone="brand" className="font-mono text-[10px] ml-1">
                            {detailUser.plan}
                          </Badge>
                        </div>
                      </div>
                    </div>

                    {/* Quick Edit Form */}
                    <div className="rounded-lg border border-stroke bg-canvas p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <h3 className="font-semibold text-xs uppercase font-mono tracking-wider text-muted flex items-center gap-1.5">
                          <EditIcon className="size-3.5 text-accent" /> Управление правами
                        </h3>
                        {isSelf ? (
                          <span className="text-[10px] text-accent bg-surface-2 border border-stroke px-1.5 py-0.5 rounded font-mono">
                            Ваш аккаунт
                          </span>
                        ) : null}
                      </div>

                      <div className="grid grid-cols-2 gap-3 text-xs">
                        <div>
                          <label className="block text-muted mb-1 text-[11px]">Сменить тариф</label>
                          <select
                            value={editPlan}
                            onChange={(e) => setEditPlan(e.target.value as PlanId)}
                            className="w-full rounded border border-stroke bg-surface px-2.5 py-1 text-xs text-text outline-none focus:border-accent"
                          >
                            <option value="free">free</option>
                            <option value="plus">plus</option>
                            <option value="pro">pro</option>
                            <option value="ultra">ultra</option>
                            <option value="gpt-pro">gpt-pro</option>
                            <option value="claude-pro">claude-pro</option>
                            <option value="gemini-pro">gemini-pro</option>
                          </select>
                        </div>

                        <div className="space-y-2 pt-3">
                          <label className="flex items-center gap-2 cursor-pointer text-xs">
                            <input
                              type="checkbox"
                              checked={editVip}
                              onChange={(e) => setEditVip(e.target.checked)}
                              className="rounded border-stroke text-accent"
                            />
                            <span>VIP статус (Ultra)</span>
                          </label>

                          <label className="flex items-center gap-2 cursor-pointer text-xs">
                            <input
                              type="checkbox"
                              checked={editAdmin}
                              disabled={Boolean(isSelf)}
                              onChange={(e) => setEditAdmin(e.target.checked)}
                              className="rounded border-stroke text-accent disabled:opacity-50"
                            />
                            <span>Права администратора</span>
                          </label>
                        </div>
                      </div>

                      {saveError ? (
                        <p className="text-xs text-danger font-medium">{saveError}</p>
                      ) : null}
                      {saveSuccess ? (
                        <p className="text-xs text-accent font-medium flex items-center gap-1 font-mono">
                          <CheckIcon className="size-3" /> Сохранено успешно!
                        </p>
                      ) : null}

                      <Button
                        size="sm"
                        variant="primary"
                        onClick={() => void handleSaveUser()}
                        disabled={saving}
                        className="w-full text-xs font-medium"
                      >
                        {saving ? 'Сохранение...' : 'Применить изменения'}
                      </Button>
                    </div>
                  </div>

                  <Divider />

                  {/* Hourly & Daily Limits Comparison */}
                  <div className="rounded-lg border border-stroke bg-canvas p-4 space-y-3">
                    <h3 className="font-semibold text-xs uppercase font-mono tracking-wider text-muted">
                      Лимиты и текущий расход
                    </h3>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                      <div className="rounded-lg border border-stroke bg-surface p-3 font-mono">
                        <span className="text-[11px] text-muted block">Запросы за час</span>
                        <p className="text-base font-semibold mt-1">
                          {detailUser.usage.requestsLastHour}{' '}
                          <span className="text-xs font-normal text-muted">
                            / {detailUser.limits.requestsPerHour ?? '∞'}
                          </span>
                        </p>
                      </div>

                      <div className="rounded-lg border border-stroke bg-surface p-3 font-mono">
                        <span className="text-[11px] text-muted block">Запросы за день</span>
                        <p className="text-base font-semibold mt-1">
                          {detailUser.usage.requestsToday}{' '}
                          <span className="text-xs font-normal text-muted">
                            / {detailUser.limits.requestsPerDay ?? '∞'}
                          </span>
                        </p>
                      </div>

                      <div className="rounded-lg border border-stroke bg-surface p-3 font-mono">
                        <span className="text-[11px] text-muted block">Токены за час</span>
                        <p className="text-base font-semibold mt-1">
                          {detailUser.usage.tokensLastHour.toLocaleString()}{' '}
                          <span className="text-xs font-normal text-muted">
                            / {detailUser.limits.tokensPerHour?.toLocaleString() ?? '∞'}
                          </span>
                        </p>
                      </div>

                      <div className="rounded-lg border border-stroke bg-surface p-3 font-mono">
                        <span className="text-[11px] text-muted block">Токены за день</span>
                        <p className="text-base font-semibold mt-1">
                          {detailUser.usage.tokensToday.toLocaleString()}{' '}
                          <span className="text-xs font-normal text-muted">
                            / {detailUser.limits.tokensPerDay?.toLocaleString() ?? '∞'}
                          </span>
                        </p>
                      </div>
                    </div>
                  </div>

                  <Divider />

                  {/* Profitability Card */}
                  <div className="rounded-lg border border-stroke bg-canvas p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold text-xs uppercase font-mono tracking-wider text-muted">
                        Рентабельность подписки (30 дней)
                      </h3>
                      <div className="flex items-center gap-1.5 font-mono text-xs">
                        <StatusDot
                          tone={
                            detailUser.profitability.status === 'profitable'
                              ? 'success'
                              : detailUser.profitability.status === 'low_margin'
                                ? 'warning'
                                : 'danger'
                          }
                        />
                        <span className="capitalize">{detailUser.profitability.status}</span>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-6 text-xs font-mono">
                      <div>
                        <span className="text-muted font-sans">Выручка:</span>{' '}
                        <span className="font-semibold text-text">
                          ${detailUser.profitability.subscriptionRevenue.toFixed(2)} ({detailUser.profitability.priceRub} ₽)
                        </span>
                      </div>
                      <div>
                        <span className="text-muted font-sans">Затраты на AI:</span>{' '}
                        <span className="font-semibold text-danger">
                          ${detailUser.profitability.aiCost.toFixed(2)}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted font-sans">Маржинальный доход:</span>{' '}
                        <span
                          className={`font-semibold ${
                            detailUser.profitability.contributionMargin >= 0
                              ? 'text-accent'
                              : 'text-danger'
                          }`}
                        >
                          ${detailUser.profitability.contributionMargin.toFixed(2)}
                        </span>
                      </div>
                    </div>
                  </div>

                  <Divider />

                  {/* Recent 20 Requests */}
                  <div className="rounded-lg border border-stroke bg-canvas p-4 space-y-3">
                    <h3 className="font-semibold text-xs uppercase font-mono tracking-wider text-muted">
                      Последние 20 запросов ({detailUser.recentRequests.length})
                    </h3>
                    <div className="max-h-60 overflow-y-auto">
                      {detailUser.recentRequests.length === 0 ? (
                        <p className="text-xs text-muted py-4 text-center">Запросов пока нет</p>
                      ) : (
                        <table className="w-full text-left text-xs font-mono">
                          <thead className="border-b border-stroke text-muted uppercase text-[10px]">
                            <tr>
                              <th className="py-1.5">Время</th>
                              <th className="py-1.5">Модель</th>
                              <th className="py-1.5">Провайдер</th>
                              <th className="py-1.5">Токены</th>
                              <th className="py-1.5">Стоимость</th>
                              <th className="py-1.5">Задержка</th>
                              <th className="py-1.5">Статус</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-stroke">
                            {detailUser.recentRequests.map((r) => (
                              <tr key={r.id}>
                                <td className="py-1.5 text-muted">
                                  {new Date(r.createdAt).toLocaleTimeString()}
                                </td>
                                <td className="py-1.5 font-sans font-medium text-text">{r.modelId}</td>
                                <td className="py-1.5 text-muted font-sans">{r.provider}</td>
                                <td className="py-1.5">
                                  {r.inputTokens + r.outputTokens}
                                </td>
                                <td className="py-1.5">${r.estimatedCost.toFixed(5)}</td>
                                <td className="py-1.5 text-muted">{r.latencyMs}ms</td>
                                <td className="py-1.5">
                                  <span
                                    className={
                                      r.status === 'success'
                                        ? 'text-accent font-sans'
                                        : 'text-danger font-sans'
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
          </div>
        </div>
      ) : null}
    </div>
  );
}
