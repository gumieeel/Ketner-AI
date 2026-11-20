import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuth } from '@/features/auth/auth-store';
import { DiscoveryApiError } from '@/features/discovery/api';
import { ErrorNotice } from '@/pages/analysis/error-notice';
import { AllowanceLine } from '@/pages/solutions/allowance-line';
import { resetAuth, resetPreferences } from './test-utils';

function allowance(spentCredits: number, limitCredits = 2_000) {
  return {
    allowance: {
      tier: null,
      month: { spentCredits, limitCredits, resetsAt: '2026-12-01T00:00:00.000Z' },
      day: { spentCredits: 0, limitCredits: 500, resetsAt: '2026-11-21T00:00:00.000Z' },
    },
  };
}

function stubAllowance(body: unknown, status = 200) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return new Response(JSON.stringify(body), { status });
  });
  return calls;
}

function signIn() {
  useAuth.setState({
    status: 'authenticated',
    token: 'token',
    user: {
      id: 'u1',
      email: 'owner@example.com',
      name: 'Владелец',
      plan: 'free',
      createdAt: '2026-11-01T00:00:00.000Z',
    },
  });
}

describe('бесплатный лимит месяца одной строкой (задача 0b)', () => {
  beforeEach(() => {
    resetAuth();
    resetPreferences();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('«использовано N%» — без кредитов', async () => {
    signIn();
    const calls = stubAllowance(allowance(731));
    render(<AllowanceLine />);
    expect(
      await screen.findByText('Бесплатный лимит месяца: использовано 36%'),
    ).toBeInTheDocument();
    expect(calls).toEqual(['/api/solutions/allowance']);
    expect(screen.getByTestId('allowance-line').textContent).not.toMatch(/кредит/);
  });

  it('исчерпан — «обновится 1-го»', async () => {
    signIn();
    stubAllowance(allowance(2_000));
    render(<AllowanceLine />);
    expect(
      await screen.findByText('Бесплатный лимит на этот месяц исчерпан, обновится 1-го'),
    ).toBeInTheDocument();
  });

  it('гостю и при ошибке сервера — ничего', async () => {
    const calls = stubAllowance(allowance(10));
    const { unmount } = render(<AllowanceLine />);
    expect(screen.queryByTestId('allowance-line')).not.toBeInTheDocument();
    expect(calls).toEqual([]);
    unmount();

    signIn();
    stubAllowance({ error: { code: 'unavailable' } }, 503);
    render(<AllowanceLine />);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByTestId('allowance-line')).not.toBeInTheDocument();
  });

  it('отказ «лимит исчерпан»: текст сервера и строка лимита; «Пополнить баланс» нет', async () => {
    signIn();
    stubAllowance(allowance(1_990));
    render(
      <MemoryRouter>
        <ErrorNotice
          error={
            new DiscoveryApiError(
              'build_allowance_exhausted',
              'Бесплатный лимит на сегодня исчерпан, обновится завтра.',
              402,
              { scope: 'day', resetsAt: '2026-11-21T00:00:00.000Z' },
            )
          }
          redirect="/solutions"
        />
      </MemoryRouter>,
    );
    expect(
      screen.getByText('Бесплатный лимит на сегодня исчерпан, обновится завтра.'),
    ).toBeInTheDocument();
    expect(
      await screen.findByText('Бесплатный лимит месяца: использовано 99%'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Пополнить баланс')).not.toBeInTheDocument();
  });
});
