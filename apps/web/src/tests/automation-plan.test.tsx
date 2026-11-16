import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuth } from '@/features/auth/auth-store';
import { setSiteFeatures } from '@/lib/features';
import { renderRoute, resetAuth, resetPreferences } from './test-utils';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const PLAN = { priceUsd: 15, monthlyCredits: 7500, trialCredits: 2000, trialDays: 30 };

describe('подписка «Автоматизации» на странице «Кредиты»: только управление у тех, у кого она есть', () => {
  const assign = vi.fn();
  beforeEach(() => {
    resetPreferences();
    resetAuth();
    assign.mockReset();
    vi.stubGlobal('location', { ...window.location, assign, pathname: '/pricing' });
  });
  afterEach(() => {
    setSiteFeatures(null);
    vi.unstubAllGlobals();
  });

  it('без оплаты картой на сервере карточки нет', () => {
    setSiteFeatures({ discovery: true, cardPayments: false });
    vi.stubGlobal('fetch', async () => json(404, {}));
    renderRoute('/pricing');
    expect(screen.queryByTestId('automation-plan')).toBeNull();
  });

  it('прежнее предложение $15 / 7 500 кредитов не показывается ни гостю, ни аккаунту без подписки', async () => {
    setSiteFeatures({ discovery: true, cardPayments: true });
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const path = new URL(String(input), 'http://localhost').pathname;
      calls.push(`${init.method ?? 'GET'} ${path}`);
      if (path === '/api/billing/automation')
        return json(200, { available: true, plan: PLAN, subscription: null });
      return json(404, { error: { code: 'not_found' } });
    });
    const guest = renderRoute('/pricing');
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByTestId('automation-plan')).toBeNull();
    expect(document.body.textContent).not.toMatch(/\$15 в месяц|7\s500 кредитов в месяц/);
    guest.unmount();

    useAuth.setState({
      status: 'authenticated',
      token: 't',
      user: { id: 'u1', email: 'u1@example.com', name: 'Анна', plan: 'free' } as never,
    });
    renderRoute('/pricing');
    await waitFor(() => expect(calls).toContain('GET /api/billing/automation'));
    expect(screen.queryByTestId('automation-plan')).toBeNull();
    expect(document.body.textContent).not.toMatch(/\$15 в месяц|7\s500 кредитов в месяц/);
  });

  it('подписчику — статус пробного месяца и «Управлять подпиской»', async () => {
    setSiteFeatures({ discovery: true, cardPayments: true });
    useAuth.setState({
      status: 'authenticated',
      token: 't',
      user: { id: 'u1', email: 'u1@example.com', name: 'Анна', plan: 'free' } as never,
    });
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const path = new URL(String(input), 'http://localhost').pathname;
      if (path === '/api/billing/automation')
        return json(200, {
          available: true,
          plan: PLAN,
          subscription: {
            status: 'active',
            trialEndsAt: '2099-12-01T10:00:00.000Z',
            nextBillingDate: '2099-12-01T10:00:00.000Z',
            cancelAtPeriodEnd: false,
          },
        });
      if (path === '/api/billing/automation/portal')
        return json(200, { url: 'https://test.customer.dodopayments.com/cus_1' });
      return json(404, { error: { code: 'not_found' } });
    });
    renderRoute('/pricing');
    expect(await screen.findByText(/Пробный месяц до/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Управлять подпиской' }));
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith('https://test.customer.dodopayments.com/cus_1'),
    );
  });
});
