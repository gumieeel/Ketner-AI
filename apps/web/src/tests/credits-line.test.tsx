import { screen, waitFor, within } from '@testing-library/react';
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

function loginAs(plan: 'free' | 'credits'): void {
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

/** Отчёт сервера для покупателя пакета $25: на балансе `balance` кредитов из 11 900. */
function report(balance: number, overrides: Partial<CreditsReport> = {}): CreditsReport {
  const exhausted = balance < 1;
  const price = 70.4;
  return {
    plan: 'credits',
    reasoningMode: 'standard',
    balance,
    granted: 11900,
    trialCredits: 200,
    purchased: !exhausted,
    stage: exhausted ? 'exhausted' : 'normal',
    low: !exhausted && balance < 1785,
    nextExpiresAt: exhausted ? null : '2099-12-01T10:00:00.000Z',
    nextExpiring: balance,
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
    installFakeApi({ reply: 'Готово', plan: 'credits', credits: () => report(balance) });
    loginAs('credits');
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

  it('когда кредитов мало — предупреждение, кто ответит дальше, и ссылка на покупку', async () => {
    installFakeApi({ plan: 'credits', credits: () => report(900) });
    loginAs('credits');
    usePreferences.setState({ chatModelId: 'claude-opus-5.5' });
    renderRoute('/chat');

    const line = await screen.findByTestId('credits-line');
    await waitFor(() => expect(line).toHaveAttribute('data-stage', 'low'));
    expect(line).toHaveTextContent('Кредиты на исходе');
    expect(line).toHaveTextContent('ответит бесплатная Nemotron 3 Ultra');
    expect(within(line).getByRole('link', { name: 'Купить кредиты' })).toHaveAttribute(
      'href',
      '/pricing',
    );
  });

  it('кредиты кончились: отвечает бесплатная модель, кредиты не тратятся, есть ссылка на покупку', async () => {
    installFakeApi({ plan: 'credits', credits: () => report(0) });
    loginAs('credits');
    usePreferences.setState({ chatModelId: 'claude-opus-5.5' });
    renderRoute('/chat');

    const line = await screen.findByTestId('credits-line');
    await waitFor(() => expect(line).toHaveAttribute('data-stage', 'exhausted'));
    expect(line).toHaveTextContent('Кредиты: 0');
    expect(line).toHaveTextContent(
      'Кредиты закончились: отвечает бесплатная Nemotron 3 Ultra, кредиты не тратятся',
    );
    expect(within(line).getByRole('link', { name: 'Купить кредиты' })).toHaveAttribute(
      'href',
      '/pricing',
    );
  });

  it('на выбранную модель не хватает, а кредиты на исходе: предупреждение плюс причина', async () => {
    installFakeApi({ plan: 'credits', credits: () => report(40) });
    loginAs('credits');
    usePreferences.setState({ chatModelId: 'claude-opus-5.5' });
    renderRoute('/chat');

    const line = await screen.findByTestId('credits-line');
    await waitFor(() => expect(line).toHaveAttribute('data-stage', 'low'));
    expect(line).toHaveTextContent('Кредиты на исходе');
    expect(line).toHaveTextContent(
      'На Claude Opus 5.5 не хватает кредитов (нужно ≈ 70,4): ответит модель попроще',
    );
  });

  it('запас кредитов есть, но на выбранную модель не хватает — только причина', async () => {
    const data = report(5000);
    data.models[0] = { ...data.models[0]!, affordable: false, remaining: 0 };
    installFakeApi({ plan: 'credits', credits: () => data });
    loginAs('credits');
    usePreferences.setState({ chatModelId: 'claude-opus-5.5' });
    renderRoute('/chat');

    const line = await screen.findByTestId('credits-line');
    await waitFor(() => expect(line).toHaveTextContent('На Claude Opus 5.5 не хватает кредитов'));
    expect(line).not.toHaveTextContent('Кредиты на исходе');
  });

  it('бесплатная модель кредитов не тратит; без выбранной модели — сколько выдано', async () => {
    const data = report(5000);
    data.models[1] = { ...data.models[1]!, free: true, requestCredits: 0, remaining: null };
    installFakeApi({ plan: 'credits', credits: () => data });
    loginAs('credits');
    usePreferences.setState({ chatModelId: 'ketner-mini' });
    renderRoute('/chat');
    const line = await screen.findByTestId('credits-line');
    await waitFor(() =>
      expect(line).toHaveTextContent('Ketner Mini бесплатна: кредиты не тратятся'),
    );

    usePreferences.setState({ chatModelId: 'auto' });
    await waitFor(() => expect(line).toHaveTextContent('из 11 900 выданных'));
  });

  it('до первой покупки строка показывает пробные кредиты и зовёт купить пакет', async () => {
    installFakeApi({
      plan: 'free',
      credits: () =>
        report(180, {
          plan: 'free',
          granted: 200,
          purchased: false,
          low: false,
          nextExpiring: 180,
        }),
    });
    loginAs('free');
    usePreferences.setState({ chatModelId: 'claude-opus-5.5' });
    renderRoute('/chat');

    const line = await screen.findByTestId('credits-line');
    await waitFor(() => expect(line).toHaveTextContent('Кредиты: 180'));
    expect(line).toHaveAttribute('data-stage', 'normal');
    // Кредиты не на исходе, но покупки ещё не было: ссылка на пакеты остаётся
    expect(within(line).getByRole('link', { name: 'Купить кредиты' })).toHaveAttribute(
      'href',
      '/pricing',
    );
  });

  it('после покупки, пока кредитов хватает, ссылки на покупку нет', async () => {
    installFakeApi({ plan: 'credits', credits: () => report(5000) });
    loginAs('credits');
    renderRoute('/chat');

    const line = await screen.findByTestId('credits-line');
    await waitFor(() => expect(line).toHaveTextContent('Кредиты: 5 000'));
    expect(within(line).queryByRole('link', { name: 'Купить кредиты' })).not.toBeInTheDocument();
  });

  it('если сервер не ответил, строки нет', async () => {
    installFakeApi({ plan: 'credits' });
    loginAs('credits');
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

  it('остаток виден в шапке на любой странице и ведёт на «Кредиты»; на исходе — предупреждение', async () => {
    let balance = 5000;
    installFakeApi({ plan: 'credits', credits: () => report(balance) });
    loginAs('credits');
    const first = renderRoute('/models');
    const chips = await screen.findAllByTestId('balance-chip');
    expect(chips[0]).toHaveTextContent('5 000');
    expect(chips[0]).toHaveAttribute('href', '/pricing');
    expect(chips[0]).toHaveAccessibleName(/^Баланс кредитов: 5\s000\. Открыть «Кредиты»$/);
    first.unmount();

    balance = 900;
    useCredits.getState().reset();
    renderRoute('/pricing');
    await waitFor(() =>
      expect(screen.getAllByTestId('balance-chip')[0]).toHaveAccessibleName(
        'Кредиты на исходе: 900. Пополнить',
      ),
    );
  });
});
