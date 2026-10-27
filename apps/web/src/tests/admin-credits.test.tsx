import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuth } from '@/features/auth/auth-store';
import { AdminPage } from '@/pages/admin-page';
import { resetAuth, resetPreferences } from './test-utils';

const credits = {
  balance: 2987,
  granted: 11900,
  purchased: true,
  spentMonth: 8013,
  nextExpiresAt: '2026-11-20T10:00:00Z',
  usedPct: 73,
};

const summary = {
  id: 'u1',
  email: 'anna@example.com',
  name: 'Анна',
  plan: 'pro',
  isVip: false,
  isAdmin: false,
  createdAt: '2026-10-01T10:00:00Z',
  usage: { requestsToday: 12, tokensToday: 34000, costToday: 0.5, costThisMonth: 8.01 },
  limits: { requestsPerDay: 1500, tokensPerDay: 6000000, monthlyCredits: 11000 },
  remaining: { requestsToday: 1488, tokensToday: 5966000 },
  credits,
  creditsUsedPct: 73,
};

const detail = {
  ...summary,
  user: summary,
  usage: {
    requestsLastHour: 2,
    requestsToday: 12,
    tokensLastHour: 1000,
    tokensToday: 34000,
    costToday: 0.5,
    costThisMonth: 8.01,
  },
  limits: {
    requestsPerHour: 300,
    requestsPerDay: 1500,
    tokensPerHour: 1500000,
    tokensPerDay: 6000000,
    monthlyCredits: 11000,
  },
  remaining: {
    requestsLastHour: 298,
    requestsToday: 1488,
    tokensLastHour: 1499000,
    tokensToday: 5966000,
  },
  credits: {
    ...credits,
    grants: [
      {
        id: 'pay_1',
        kind: 'pack',
        amountUsd: 11,
        remainingUsd: 2.987,
        grantedAt: '2026-10-20T10:00:00Z',
        expiresAt: '2026-12-20T10:00:00Z',
        status: 'active',
      },
      {
        id: 'admin:u1:1',
        kind: 'admin',
        amountUsd: 0.5,
        remainingUsd: 0.5,
        grantedAt: '2026-10-21T10:00:00Z',
        expiresAt: '2026-11-21T10:00:00Z',
        status: 'active',
        note: 'компенсация',
      },
    ],
  },
  profitability: {
    userId: 'u1',
    subscriptionRevenue: 25,
    aiCost: 8.01,
    contributionMargin: 10,
    status: 'profitable',
    plan: 'pro',
    priceRub: 2400,
    usdToRubRate: 96,
  },
  recentRequests: [],
};

describe('админка: кредиты пользователей', () => {
  const posts: Array<{ url: string; body: Record<string, unknown> }> = [];

  beforeEach(() => {
    resetAuth();
    resetPreferences();
    posts.length = 0;
    useAuth.setState({
      status: 'authenticated',
      token: 'admin-token',
      user: {
        id: 'admin',
        email: 'admin@ketner.ai',
        name: 'Админ',
        plan: 'ultra',
        isAdmin: true,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const json = (body: unknown, status = 200) =>
          new Response(JSON.stringify(body), { status });
        if (url.startsWith('/api/admin/users?')) return json({ users: [summary], total: 1 });
        if (url === '/api/admin/users/u1/credits' && init?.method === 'POST') {
          posts.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> });
          return json({ success: true }, 201);
        }
        if (url === '/api/admin/users/u1') return json(detail);
        if (url.startsWith('/api/admin/metrics')) return json({ metrics: null });
        if (url.startsWith('/api/admin/registrations'))
          return json({
            period: '7d',
            bucket: 'day',
            timeZone: 'UTC',
            totals: {
              allTime: 0,
              inPeriod: 0,
              previousPeriod: 0,
              today: 0,
              paidInPeriod: 0,
              trackedInPeriod: 0,
            },
            series: [],
            byHourOfDay: Array.from({ length: 24 }, () => 0),
            byMethod: [],
            byChannel: [],
            bySource: [],
            byCampaign: [],
            recent: [],
            recentTotal: 0,
          });
        return json({});
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('в списке — расход кредитов в процентах и остаток, в карточке — гранты и выдача вручную', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <AdminPage />
      </MemoryRouter>,
    );

    await screen.findByText('anna@example.com');
    expect(screen.getAllByText('73%').length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: /Открыть карточку: Анна/ }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText('Потрачено за 30 дней');
    expect(within(dialog).getByText('Остаток')).toBeInTheDocument();
    // Сколько выдано по действующим грантам и есть ли купленные кредиты (они открывают полный уровень лимитов)
    expect(within(dialog).getByText('Выдано действующими грантами')).toBeInTheDocument();
    expect(within(dialog).getAllByText(/11[\s\u00a0,]900/).length).toBeGreaterThan(0);
    expect(within(dialog).getByText('есть купленные')).toBeInTheDocument();
    expect(within(dialog).getByText('Пакет кредитов')).toBeInTheDocument();
    expect(within(dialog).getAllByText(/2[\s\u00a0,]987/).length).toBeGreaterThan(0);
    expect(within(dialog).getByText('Откуда')).toBeInTheDocument();
    expect(within(dialog).getByText(/Вручную/)).toBeInTheDocument();
    expect(within(dialog).getByText(/компенсация/)).toBeInTheDocument();

    await user.type(screen.getByLabelText('Выдать кредитов'), '1500');
    await user.clear(screen.getByLabelText('Дней'));
    await user.type(screen.getByLabelText('Дней'), '7');
    await user.type(screen.getByLabelText('Причина'), 'подарок');
    await user.click(screen.getByRole('button', { name: 'Выдать' }));

    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual({
      url: '/api/admin/users/u1/credits',
      body: { credits: 1500, days: 7, note: 'подарок' },
    });
    expect(await screen.findByText('Кредиты выданы')).toBeInTheDocument();
  });
});
