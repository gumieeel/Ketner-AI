import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { useAuth } from '@/features/auth/auth-store';
import { usePreferences } from '@/features/preferences/preferences-store';
import { useCredits } from '@/features/usage/credits-store';
import type { CreditsReport } from '@/features/usage/types';
import { formatCredits, pluralForm } from '@/lib/format-date';
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

/** Отчёт сервера для Pro: на балансе `balance` кредитов из 11 000. */
function report(balance: number, overrides: Partial<CreditsReport> = {}): CreditsReport {
  const exhausted = balance < 1;
  const price = 70.4;
  return {
    plan: 'pro',
    reasoningMode: 'standard',
    balance,
    monthly: 11000,
    stage: exhausted ? 'exhausted' : 'normal',
    low: !exhausted && balance < 1650,
    nextExpiresAt: exhausted ? null : '2099-12-01T10:00:00.000Z',
    nextExpiring: balance,
    refreshAt: '2026-11-20T10:00:00.000Z',
    grants: [],
    freeModel: { id: 'nemotron-ultra', name: 'Nemotron 3 Ultra' },
    models: [
      {
        id: 'claude-opus-5.5',
        name: 'Claude Opus 5.5',
        requestCredits: price,
        priceSource: 'estimate',
        free: false,
        remaining: Math.floor(balance / price),
        affordable: balance >= price,
      },
      {
        id: 'ketner-mini',
        name: 'Ketner Mini',
        requestCredits: 1.8,
        priceSource: 'estimate',
        free: false,
        remaining: Math.floor(balance / 1.8),
        affordable: balance >= 1.8,
      },
      {
        id: 'nemotron-ultra',
        name: 'Nemotron 3 Ultra',
        requestCredits: 0,
        priceSource: 'estimate',
        free: true,
        remaining: null,
        affordable: true,
      },
    ],
    ...overrides,
  };
}

describe('строка кредитов под выбором модели', () => {
  beforeEach(() => {
    resetAuth();
    resetPreferences();
    resetChat();
    useCredits.getState().reset();
  });

  it('показывает остаток, цену запроса выбранной модели и обновляется после ответа', async () => {
    let balance = 5000;
    installFakeApi({ reply: 'Готово', plan: 'pro', credits: () => report(balance) });
    loginAs('pro');
    usePreferences.setState({ chatModelId: 'claude-opus-5.5' });
    const user = userEvent.setup();
    renderRoute('/chat');

    const line = await screen.findByTestId('credits-line');
    await waitFor(() => expect(line).toHaveTextContent('Кредиты: 5 000'));
    expect(line).toHaveTextContent('Claude Opus 5.5 ≈ 70,4 кр. за запрос, хватит примерно на 71');
    expect(line).toHaveAttribute('data-stage', 'normal');

    balance = 4930;
    await user.type(await screen.findByLabelText(COMPOSER), 'Объясни теорему');
    await user.click(screen.getByRole('button', { name: 'Отправить' }));
    await waitFor(() =>
      expect(screen.getByTestId('credits-line')).toHaveTextContent('Кредиты: 4 930'),
    );
    expect(screen.getByTestId('credits-line')).toHaveTextContent('хватит примерно на 70');
  });

  it('когда кредитов мало — предупреждение, кто ответит дальше, и ссылка на тарифы', async () => {
    installFakeApi({ plan: 'pro', credits: () => report(900) });
    loginAs('pro');
    usePreferences.setState({ chatModelId: 'claude-opus-5.5' });
    renderRoute('/chat');

    const line = await screen.findByTestId('credits-line');
    await waitFor(() => expect(line).toHaveAttribute('data-stage', 'low'));
    expect(line).toHaveTextContent('Кредиты на исходе');
    expect(line).toHaveTextContent('ответит бесплатная Nemotron 3 Ultra');
    expect(screen.getByRole('link', { name: 'Тарифы' })).toHaveAttribute('href', '/pricing');
  });

  it('кредиты кончились: отвечает бесплатная модель, кредиты не тратятся, видно, когда придут новые', async () => {
    installFakeApi({ plan: 'pro', credits: () => report(0) });
    loginAs('pro');
    usePreferences.setState({ chatModelId: 'claude-opus-5.5' });
    renderRoute('/chat');

    const line = await screen.findByTestId('credits-line');
    await waitFor(() => expect(line).toHaveAttribute('data-stage', 'exhausted'));
    expect(line).toHaveTextContent('Кредиты: 0');
    expect(line).toHaveTextContent(
      'Кредиты закончились: отвечает бесплатная Nemotron 3 Ultra, кредиты не тратятся',
    );
    expect(line).toHaveTextContent('Новые кредиты —');
  });

  it('на выбранную модель не хватает, а кредиты на исходе: предупреждение плюс причина', async () => {
    installFakeApi({ plan: 'pro', credits: () => report(40) });
    loginAs('pro');
    usePreferences.setState({ chatModelId: 'claude-opus-5.5' });
    renderRoute('/chat');

    const line = await screen.findByTestId('credits-line');
    await waitFor(() => expect(line).toHaveAttribute('data-stage', 'low'));
    expect(line).toHaveTextContent('Кредиты на исходе');
    expect(line).toHaveTextContent(
      'На Claude Opus 5.5 не хватает кредитов (нужно ≈ 70,4): ответит модель попроще',
    );
  });

  it('на тарифе с запасом кредитов, но без кредитов на выбранную модель — только причина', async () => {
    const data = report(5000);
    data.models[0] = { ...data.models[0]!, affordable: false, remaining: 0 };
    installFakeApi({ plan: 'pro', credits: () => data });
    loginAs('pro');
    usePreferences.setState({ chatModelId: 'claude-opus-5.5' });
    renderRoute('/chat');

    const line = await screen.findByTestId('credits-line');
    await waitFor(() => expect(line).toHaveTextContent('На Claude Opus 5.5 не хватает кредитов'));
    expect(line).not.toHaveTextContent('Кредиты на исходе');
  });

  it('бесплатная модель кредитов не тратит; без выбранной модели — выдача за 30 дней', async () => {
    const data = report(5000);
    data.models[1] = { ...data.models[1]!, free: true, requestCredits: 0, remaining: null };
    installFakeApi({ plan: 'pro', credits: () => data });
    loginAs('pro');
    usePreferences.setState({ chatModelId: 'ketner-mini' });
    renderRoute('/chat');
    const line = await screen.findByTestId('credits-line');
    await waitFor(() =>
      expect(line).toHaveTextContent('Ketner Mini бесплатна: кредиты не тратятся'),
    );

    usePreferences.setState({ chatModelId: 'auto' });
    await waitFor(() => expect(line).toHaveTextContent('из 11 000 за 30 дней'));
  });

  it('если сервер не ответил, строки нет', async () => {
    installFakeApi({ plan: 'pro' });
    loginAs('pro');
    renderRoute('/chat');
    await screen.findByLabelText(COMPOSER);
    expect(screen.queryByTestId('credits-line')).not.toBeInTheDocument();
  });

  it('числа кредитов: тысячи через пробел, цена запроса с десятыми', () => {
    expect(formatCredits(11000, 'ru').replace(/\s/g, ' ')).toBe('11 000');
    expect(formatCredits(1.8, 'ru', 1)).toBe('1,8');
    expect(formatCredits(35, 'ru', 1)).toBe('35');
    expect(formatCredits(11000, 'en')).toBe('11,000');
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
