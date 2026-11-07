import { fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuth } from '@/features/auth/auth-store';
import { renderRoute, resetAuth, resetPreferences } from './test-utils';

const VERSION = {
  version: 1,
  note: 'Начальные значения',
  createdBy: 'system',
  createdAt: '2026-11-07T10:00:00.000Z',
  config: {
    currency: 'KZT',
    enabled: true,
    billableHourlyRateKzt: 10_000,
    complexityMultipliers: { simple: 1, medium: 1.5, complex: 2.2 },
    riskReservePercent: 15,
    testingPercent: 10,
    uncertaintyPercentPerUnknown: 6,
    uncertaintyMaxPercent: 40,
    minimumImplementationPriceKzt: 60_000,
    roundingIncrementKzt: 5_000,
    workingHoursPerDay: 6,
    customerFeedbackDays: [1, 3],
    supportMonthlyKzt: null,
    usdToKztRate: null,
    usage: {
      modelId: 'ketner-pro',
      inputTokensPerRequest: [800, 1500, 3000],
      outputTokensPerRequest: [150, 300, 600],
      callsPerRequest: [1, 1, 2],
    },
    calibrationMinSamples: 3,
  },
  catalog: [],
};

function install(status: number) {
  const calls: Array<{ method: string; path: string; body: unknown }> = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input), 'http://localhost');
    const method = (init.method ?? 'GET').toUpperCase();
    calls.push({
      method,
      path: url.pathname,
      body: init.body ? JSON.parse(String(init.body)) : null,
    });
    const json = (code: number, body: unknown) =>
      new Response(JSON.stringify(body), {
        status: code,
        headers: { 'Content-Type': 'application/json' },
      });
    if (status === 403) return json(403, { error: { code: 'admin_access_denied', message: '' } });
    if (url.pathname === '/api/admin/pricing/requests') return json(200, { requests: [] });
    if (url.pathname === '/api/admin/pricing/config' && method === 'GET')
      return json(200, { version: VERSION });
    if (url.pathname === '/api/admin/pricing/config' && method === 'PUT') {
      return json(200, { version: { ...VERSION, version: 2 } });
    }
    return json(404, { error: { code: 'not_found', message: '' } });
  });
  return calls;
}

describe('админка смет', () => {
  beforeEach(() => {
    resetPreferences();
    resetAuth();
    useAuth.setState({
      status: 'authenticated',
      token: 'mock-token',
      user: {
        id: 'u1',
        email: 'a@example.com',
        name: 'A',
        plan: 'credits',
        createdAt: '2026-01-01T00:00:00.000Z',
      } as never,
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('без прав — понятный отказ сервера, а не пустая страница', async () => {
    install(403);
    renderRoute('/admin/pricing');
    expect(await screen.findByText('Нужны права администратора.')).toBeInTheDocument();
  });

  it('настройки: значения с сервера, сохранение — новая версия с причиной', async () => {
    const calls = install(200);
    renderRoute('/admin/pricing');
    expect(await screen.findByText('Заявок нет.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Настройки цен' }));
    const rate = await screen.findByLabelText('Ставка за час для клиента, ₸ (уже с маржой)');
    expect(rate).toHaveValue('10000');
    expect(screen.getByText(/Действуют начальные значения/)).toBeInTheDocument();
    const save = screen.getByRole('button', { name: 'Сохранить новую версию' });
    expect(save).toBeDisabled();
    fireEvent.change(rate, { target: { value: '12000' } });
    fireEvent.change(screen.getByLabelText('Причина изменения (в журнал)'), {
      target: { value: 'Калибровка ставки' },
    });
    fireEvent.click(save);
    expect(await screen.findByRole('status')).toHaveTextContent('Сохранено');
    const put = calls.find((call) => call.method === 'PUT')!;
    expect(put.body).toMatchObject({
      baseVersion: 1,
      reason: 'Калибровка ставки',
      config: { billableHourlyRateKzt: 12000 },
    });
    expect(within(document.body).queryByText('Нужны права администратора.')).toBeNull();
  });
});
