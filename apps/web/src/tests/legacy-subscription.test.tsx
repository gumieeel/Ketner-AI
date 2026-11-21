import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useAuth } from '@/features/auth/auth-store';
import { useBilling } from '@/features/billing/billing-store';
import { installFakeApi } from './fake-api';
import { renderRoute, resetAuth, resetBilling, resetChat, resetPreferences } from './test-utils';

// Перенесено из billing-flow.test.tsx (страница оформления пакетов удалена, задача 0b): подписка
// прежней системы видна в настройках до конца оплаченного срока и отключается.
describe('настройки: подписка прежней системы', () => {
  beforeEach(() => {
    resetPreferences();
    resetChat();
    resetAuth();
    resetBilling();
    installFakeApi();
  });

  afterEach(() => {
    resetPreferences();
    resetChat();
    resetAuth();
    resetBilling();
  });

  it('видна и отключается, новых подписок нет', async () => {
    useAuth.setState({
      status: 'authenticated',
      token: 'mock-token',
      user: {
        id: 'demo-user',
        email: 'demo@ketner.ai',
        name: 'Демо Пользователь',
        plan: 'plus',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    });
    useBilling.setState({
      subscription: {
        userId: 'demo-user',
        plan: 'plus',
        status: 'active',
        renewsAt: '2026-12-31T00:00:00.000Z',
      },
      loading: false,
      error: null,
    });

    renderRoute('/settings');

    expect(screen.getAllByText('Plus').length).toBeGreaterThan(0);
    const cancelButton = screen.getByRole('button', { name: /Отменить подписку/i });
    fireEvent.click(cancelButton);

    await waitFor(() => {
      // Уровень доступа возвращается к бесплатному
      expect(useAuth.getState().user?.plan).toBe('free');
      expect(useBilling.getState().subscription?.status).toBe('canceled');
    });
  });
});
