import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { useAuth } from '@/features/auth/auth-store';
import { usePreferences } from '@/features/preferences/preferences-store';
import { useQuota } from '@/features/usage/quota-store';
import { pluralForm } from '@/lib/format-date';
import { installFakeApi } from './fake-api';
import { renderRoute, resetAuth, resetChat, resetPreferences } from './test-utils';

const COMPOSER = 'Спросите что-нибудь…';

function loginAs(plan: 'pro' | 'ultra'): void {
  useAuth.setState({
    user: {
      id: 'demo-user',
      email: 'demo@ketner.ai',
      name: 'Демо',
      plan,
      createdAt: new Date().toISOString(),
    },
    token: 'fake.jwt.token',
    status: 'authenticated',
  });
}

function quota(opusRemaining: number, usedPct = 30, mode: 'standard' | 'max' = 'standard') {
  return {
    plan: 'pro',
    reasoningMode: mode,
    premium: {
      budgetUsd: 8,
      spentUsd: (8 * usedPct) / 100,
      remainingUsd: 8 - (8 * usedPct) / 100,
      usedPct,
      available: usedPct < 100,
      warning: usedPct >= 80,
      restoresAt: '2026-11-01T10:00:00.000Z',
    },
    budget: { stage: 'normal', usedPct: 20 },
    models: [
      {
        id: 'claude-opus-5.5',
        name: 'Claude Opus 5.5',
        requestCostUsd: 0.0704,
        priceSource: 'estimate',
        remaining: opusRemaining,
        remainingByQuota: opusRemaining,
        pool: { weekly: 21, perDay: 8, weekRemaining: 21, dayRemaining: opusRemaining },
        limitedBy: opusRemaining > 0 ? null : 'day',
        restoresAt: opusRemaining > 0 ? null : '2026-10-17T09:30:00.000Z',
      },
    ],
  };
}

describe('строка остатка под выбором модели', () => {
  beforeEach(() => {
    resetAuth();
    resetPreferences();
    resetChat();
    useQuota.getState().reset();
  });

  it('показывает, сколько запросов выбранной топ-модели осталось, и обновляется после ответа', async () => {
    let remaining = 8;
    installFakeApi({ reply: 'Готово', plan: 'pro', quota: () => quota(remaining) });
    loginAs('pro');
    usePreferences.setState({ chatModelId: 'claude-opus-5.5' });
    const user = userEvent.setup();
    renderRoute('/chat');

    expect(await screen.findByText('Осталось ~8 запросов Claude Opus 5.5')).toBeInTheDocument();

    remaining = 7;
    await user.type(await screen.findByLabelText(COMPOSER), 'Объясни теорему');
    await user.click(screen.getByRole('button', { name: 'Отправить' }));
    expect(await screen.findByText('Осталось ~7 запросов Claude Opus 5.5')).toBeInTheDocument();
  });

  it('с 80% квоты — предупреждение; при нуле — причина и когда вернутся', async () => {
    installFakeApi({ plan: 'pro', quota: () => quota(0, 84) });
    loginAs('pro');
    usePreferences.setState({ chatModelId: 'claude-opus-5.5' });
    renderRoute('/chat');

    const line = await screen.findByRole('status');
    await waitFor(() =>
      expect(line).toHaveTextContent('Израсходовано 84% премиум-квоты за 30 дней'),
    );
    expect(line).toHaveTextContent(
      'Запросы Claude Opus 5.5 пока закончились (лимит модели на сутки): ответит запасная модель',
    );
    expect(line).toHaveTextContent('вернутся');
  });

  it('для лёгкой модели и без предупреждения строки нет', async () => {
    installFakeApi({ plan: 'pro', quota: () => quota(8) });
    loginAs('pro');
    usePreferences.setState({ chatModelId: 'ketner-mini' });
    renderRoute('/chat');
    await screen.findByLabelText(COMPOSER);
    await waitFor(() => expect(useQuota.getState().report).not.toBeNull());
    expect(screen.queryByText(/Осталось ~/)).not.toBeInTheDocument();
  });

  it('русские формы числа: 1 запрос, 3 запроса, 5 и 11 запросов', () => {
    expect([1, 3, 5, 11, 21, 22, 112].map((n) => pluralForm(n, 'ru'))).toEqual([
      'one',
      'few',
      'many',
      'many',
      'one',
      'few',
      'many',
    ]);
    expect(pluralForm(1, 'en')).toBe('one');
    expect(pluralForm(2, 'en')).toBe('many');
  });
});
