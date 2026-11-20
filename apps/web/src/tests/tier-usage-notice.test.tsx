import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import type { BotOverview } from '@/features/builder/api';
import { TierUsageNotice } from '@/pages/solutions/bot-panel';
import { resetPreferences } from './test-utils';

type Requests = NonNullable<BotOverview['requests']>;

const base: Requests = {
  tier: 'growth',
  used: 4_012,
  included: 5_000,
  limit: 5_500,
  state: 'warning',
  periodEnd: '2026-12-01T00:00:00.000Z',
  enforced: true,
};

function show(requests: Requests) {
  return render(
    <MemoryRouter>
      <TierUsageNotice requests={requests} />
    </MemoryRouter>,
  );
}

/** Предупреждение об объёме тарифа в панели бота: при 80%, в льготном объёме, в режиме заявок. */
describe('панель бота: предупреждение об объёме тарифа', () => {
  beforeEach(() => resetPreferences());

  it('80%: сколько использовано, сколько ещё без доплаты, когда — только заявки', () => {
    show(base);
    expect(screen.getByRole('status')).toHaveTextContent(
      /Использовано 80% обращений тарифа Growth\. Сверх объёма — ещё 10% без доплаты, до 5\s500; дальше до 30 ноября бот будет только принимать заявки\./,
    );
    expect(screen.getByRole('link', { name: 'Написать нам' })).toHaveAttribute(
      'href',
      '/contacts?topic=payment',
    );
  });

  it('льготный объём и режим заявок', () => {
    const grace = show({ ...base, used: 5_100, state: 'grace' });
    expect(screen.getByRole('status')).toHaveTextContent(/идут льготные обращения — до 5\s500/);
    grace.unmount();
    show({ ...base, used: 5_500, state: 'leads_only' });
    expect(screen.getByRole('status')).toHaveTextContent(
      'Бот принимает только заявки до 30 ноября: объём тарифа и льготные 10% исчерпаны. С нового месяца ответы возобновятся сами.',
    );
  });

  it('тариф не назначен при включённых тарифах — бот принимает только заявки', () => {
    show({ ...base, tier: null, included: null, limit: null, used: 3, state: 'no_tier' });
    expect(screen.getByRole('status')).toHaveTextContent(
      'Тариф не назначен: бот не отвечает с помощью ИИ, а принимает заявки.',
    );
  });

  it('ниже 80% и пока тарифы не включены — предупреждения нет', () => {
    const ok = show({ ...base, used: 100, state: 'ok' });
    expect(screen.queryByRole('status')).toBeNull();
    ok.unmount();
    show({ ...base, enforced: false });
    expect(screen.queryByRole('status')).toBeNull();
  });
});
