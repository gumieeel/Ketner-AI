import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useAuth } from '@/features/auth/auth-store';
import { installFakeApi } from './fake-api';
import { renderRoute, resetAuth, resetChat, resetPreferences } from './test-utils';

/** Задача 0b, часть 2: чат закрыт, пакеты кредитов не продаются — ни баланса, ни покупки. */
describe('боковая панель вошедшего: меню без чатов и покупки кредитов', () => {
  beforeEach(() => {
    resetAuth();
    resetPreferences();
    resetChat();
    installFakeApi({ plan: 'credits' });
    useAuth.setState({
      user: {
        id: 'demo-user',
        email: 'demo@ketner.ai',
        name: 'Демо',
        plan: 'credits',
        createdAt: new Date().toISOString(),
      },
      token: 'fake.jwt.token',
      status: 'authenticated',
    });
  });

  it('заголовок «Меню», ссылка «Тарифы»; нет «Чаты», «Купить кредиты», баланса и значка плана', async () => {
    renderRoute('/settings');
    const aside = await screen.findByRole('complementary', { name: 'Меню' });
    expect(within(aside).getByText('Меню')).toBeInTheDocument();
    expect(within(aside).getByRole('link', { name: 'Тарифы' })).toHaveAttribute('href', '/pricing');
    expect(within(aside).queryByText('Чаты')).not.toBeInTheDocument();
    expect(within(aside).queryByText('Купить кредиты')).not.toBeInTheDocument();
    expect(within(aside).queryByTestId('balance-chip')).not.toBeInTheDocument();
    expect(within(aside).queryByText('Кредиты')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Открыть меню' }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Открыть список чатов' })).not.toBeInTheDocument();
  });

  it('оформление пакета закрыто: адрес объясняет это и ведёт к тарифам', async () => {
    renderRoute('/checkout/credits-10');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Пакеты кредитов больше не продаются' }),
    ).toBeInTheDocument();
    const main = screen.getByRole('heading', { level: 1 }).parentElement!;
    expect(within(main).getByRole('link', { name: 'Тарифы' })).toHaveAttribute('href', '/pricing');
  });
});
