import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { useAuth } from '@/features/auth/auth-store';
import { useUpgradeModal } from '@/features/billing/upgrade-modal-store';
import { usePreferences } from '@/features/preferences/preferences-store';
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

describe('режим Max', () => {
  beforeEach(() => {
    resetAuth();
    resetPreferences();
    resetChat();
    useUpgradeModal.getState().close();
  });

  it('на Ultra включается и уходит на сервер как reasoningMode: max', async () => {
    const api = installFakeApi({ reply: 'Готово', plan: 'ultra' });
    loginAs('ultra');
    const user = userEvent.setup();
    renderRoute('/chat');

    const toggle = await screen.findByRole('button', { name: /^Max:/ });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(usePreferences.getState().maxMode).toBe(true);
    expect(window.localStorage.getItem('ketner.maxMode')).toBe('1');

    await user.type(await screen.findByLabelText(COMPOSER), 'Докажи теорему');
    await user.click(screen.getByRole('button', { name: 'Отправить' }));
    await waitFor(() => expect(api.completionBodies.length).toBe(1));
    expect(api.completionBodies[0].reasoningMode).toBe('max');
  });

  it('на Pro кнопка с замком открывает переход на Ultra, а запрос уходит без Max', async () => {
    const api = installFakeApi({ reply: 'Готово', plan: 'pro' });
    loginAs('pro');
    usePreferences.setState({ maxMode: true }); // включили когда-то на Ultra, а тариф сменился
    const user = userEvent.setup();
    renderRoute('/chat');

    const toggle = await screen.findByRole('button', {
      name: /^Max: Режим Max доступен на тарифе Ultra/,
    });
    expect(toggle).not.toHaveAttribute('aria-pressed');
    await user.click(toggle);
    expect(useUpgradeModal.getState().isOpen).toBe(true);
    expect(useUpgradeModal.getState().reason).toBe('max_mode');
    expect(await screen.findByText('Режим Max доступен на Ultra')).toBeInTheDocument();
    useUpgradeModal.getState().close();

    await user.type(await screen.findByLabelText(COMPOSER), 'Привет');
    await user.click(screen.getByRole('button', { name: 'Отправить' }));
    await waitFor(() => expect(api.completionBodies.length).toBe(1));
    expect(api.completionBodies[0].reasoningMode).toBeUndefined();
  });
});
