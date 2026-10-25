import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RegistrationsPanel, type RegistrationStats } from '@/pages/admin/registrations-panel';
import { resetPreferences } from './test-utils';

function stats(overrides: Partial<RegistrationStats> = {}): RegistrationStats {
  return {
    period: '7d',
    bucket: 'day',
    timeZone: 'Asia/Qyzylorda',
    totals: {
      allTime: 40,
      inPeriod: 3,
      previousPeriod: 1,
      today: 1,
      paidInPeriod: 1,
      trackedInPeriod: 2,
    },
    series: [
      { key: '2026-10-15', count: 1 },
      { key: '2026-10-16', count: 0 },
      { key: '2026-10-17', count: 2 },
    ],
    byHourOfDay: Array.from({ length: 24 }, (_, hour) => (hour === 10 ? 3 : 0)),
    byMethod: [
      { method: 'google', count: 2, paid: 1 },
      { method: 'email', count: 1, paid: 0 },
    ],
    byChannel: [],
    bySource: [
      { channel: 'paid', source: 'google', count: 2, paid: 1 },
      { channel: 'unknown', source: '', count: 1, paid: 0 },
    ],
    byCampaign: [{ campaign: 'launch', source: 'google', count: 2, paid: 1 }],
    recent: [
      {
        id: 'u1',
        email: 'anna@example.com',
        name: 'Анна',
        plan: 'pro',
        paid: true,
        createdAt: '2026-10-17T04:30:00Z',
        method: 'google',
        channel: 'paid',
        source: 'google',
        medium: 'cpc',
        campaign: 'launch',
        referrer: null,
        landing: '/pricing',
      },
      {
        id: 'u2',
        email: null,
        name: 'Telegram',
        plan: 'free',
        paid: false,
        createdAt: '2026-10-15T10:00:00Z',
        method: 'telegram',
        channel: 'unknown',
        source: '',
        medium: null,
        campaign: null,
        referrer: null,
        landing: null,
      },
    ],
    recentTotal: 2,
    ...overrides,
  };
}

describe('админка: регистрации', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    resetPreferences();
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => new Response(JSON.stringify(stats())));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('показывает итоги, разбивки и последние регистрации', async () => {
    render(<RegistrationsPanel getHeaders={() => ({ 'x-admin-key': 'k' })} />);

    const table = await screen.findByRole('table', { name: '' });
    expect(within(table).getByText('Анна')).toBeInTheDocument();
    expect(within(table).getByText('anna@example.com')).toBeInTheDocument();
    expect(within(table).getByText('Аккаунт Telegram')).toBeInTheDocument();
    expect(within(table).getAllByText('Реклама · google').length).toBeGreaterThan(0);
    expect(screen.getByText('+2 к прошлому периоду (было 1)')).toBeInTheDocument();
    expect(screen.getByText('Рекламные кампании (utm_campaign)')).toBeInTheDocument();
    expect(screen.getByText('launch')).toBeInTheDocument();

    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain('/api/admin/registrations?');
    expect(url).toContain('period=30d');
    expect(url).toContain('tz=');
  });

  it('фильтр по источнику и смена периода запрашивают данные заново', async () => {
    const user = userEvent.setup();
    render(<RegistrationsPanel getHeaders={() => ({})} />);
    await screen.findByText('Анна');

    await user.click(screen.getByRole('button', { name: /Реклама · google/ }));
    await waitFor(() => {
      const url = String(fetchMock.mock.calls.at(-1)?.[0]);
      expect(url).toContain('channel=paid');
      expect(url).toContain('source=google');
    });
    expect(screen.getByRole('button', { name: 'Сбросить фильтр' })).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: '7 дней' }));
    await waitFor(() => expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain('period=7d'));

    await user.click(screen.getByRole('button', { name: 'Сбросить фильтр' }));
    await waitFor(() => expect(String(fetchMock.mock.calls.at(-1)?.[0])).not.toContain('channel='));
  });

  it('сообщает об ошибке загрузки', async () => {
    fetchMock.mockImplementation(async () => new Response('{}', { status: 403 }));
    render(<RegistrationsPanel getHeaders={() => ({})} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось загрузить регистрации');
  });
});
