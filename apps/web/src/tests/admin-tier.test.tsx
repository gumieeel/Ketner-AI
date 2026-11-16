import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminTierCard, type AdminTierInfo } from '@/pages/admin/tier-card';
import { resetPreferences } from './test-utils';

const base: AdminTierInfo = {
  tier: null,
  used: 12,
  included: null,
  limit: null,
  state: 'no_tier',
  action: 'form_only',
  enforced: false,
  wouldLimit: 12,
  setBy: null,
  setAt: null,
  note: null,
};

describe('тариф в карточке администратора (P3)', () => {
  beforeEach(() => resetPreferences());
  afterEach(() => vi.unstubAllGlobals());

  it('без тарифа: «как было бы» и назначение тарифа с комментарием', async () => {
    const calls: Array<{ url: string; method: string; body: unknown }> = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
      calls.push({
        url,
        method: init.method ?? 'GET',
        body: init.body ? JSON.parse(String(init.body)) : null,
      });
      return Response.json({ tier: base });
    });
    const onChanged = vi.fn(async () => {});
    render(<AdminTierCard userId="u1" info={base} headers={() => ({})} onChanged={onChanged} />);
    expect(screen.getByText('Не назначен', { selector: 'dd' })).toBeInTheDocument();
    expect(screen.getByText('Тарифа нет — посетители видели бы только форму')).toBeInTheDocument();
    expect(screen.getByText(/Тарифы ещё не включены/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Назначить тариф'), { target: { value: 'growth' } });
    fireEvent.change(screen.getByLabelText('Комментарий'), { target: { value: 'свой аккаунт' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить тариф' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(calls).toEqual([
      {
        url: '/api/admin/users/u1/tier',
        method: 'PUT',
        body: { tier: 'growth', note: 'свой аккаунт' },
      },
    ]);
    expect(screen.getByText('Тариф сохранён')).toBeInTheDocument();
  });

  it('с тарифом: обращения из лимита; «не назначен» снимает тариф; ошибка сервера видна', async () => {
    const info: AdminTierInfo = {
      ...base,
      tier: 'start',
      used: 1_150,
      included: 1_000,
      limit: 1_100,
      state: 'leads_only',
      action: 'leads_only',
      wouldLimit: 50,
      setBy: 'admin_key',
      setAt: '2026-11-15T10:00:00.000Z',
    };
    const methods: string[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit = {}) => {
      methods.push(init.method ?? 'GET');
      return Response.json(
        { error: { code: 'tier_not_saved', message: 'Тариф не сохранён: база недоступна.' } },
        { status: 503 },
      );
    });
    render(
      <AdminTierCard userId="u1" info={info} headers={() => ({})} onChanged={async () => {}} />,
    );
    expect(screen.getByText(/1\s150 из 1\s000 \(до 1\s100 с льготными\)/)).toBeInTheDocument();
    expect(screen.getByText('Режим заявок')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Назначить тариф'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить тариф' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('база недоступна');
    expect(methods).toEqual(['DELETE']);
  });
});
