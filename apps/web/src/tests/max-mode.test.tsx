import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { useAuth } from '@/features/auth/auth-store';
import { useCreditsModal } from '@/features/billing/credits-modal-store';
import { usePreferences } from '@/features/preferences/preferences-store';
import { installFakeApi } from './fake-api';
import { renderRoute, resetAuth, resetChat, resetPreferences } from './test-utils';
import { setProductSwitchesForTests } from '@/lib/product-switches';

// Закрытые возможности (lib/product-switches.ts): здесь проверяется их спящий код.
setProductSwitchesForTests({ chat: true });

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

describe('режим Max', () => {
  beforeEach(() => {
    resetAuth();
    resetPreferences();
    resetChat();
    useCreditsModal.getState().close();
  });

  it('на Free включается без окна покупки и уходит на сервер как reasoningMode: max', async () => {
    const api = installFakeApi({ reply: 'Готово', plan: 'free' });
    loginAs('free');
    const user = userEvent.setup();
    renderRoute('/chat');

    const toggle = await screen.findByRole('button', { name: /^Max:/ });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(toggle).toHaveAccessibleName(/запрос стоит дороже/);
    await user.click(toggle);
    expect(useCreditsModal.getState().isOpen).toBe(false);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(usePreferences.getState().maxMode).toBe(true);
    expect(window.localStorage.getItem('ketner.maxMode')).toBe('1');

    await user.type(await screen.findByLabelText(COMPOSER), 'Докажи теорему');
    await user.click(screen.getByRole('button', { name: 'Отправить' }));
    await waitFor(() => expect(api.completionBodies.length).toBe(1));
    expect(api.completionBodies[0].reasoningMode).toBe('max');
  });

  it('у покупателя кредитов режим Max, включённый раньше, сохраняется и уходит на сервер', async () => {
    const api = installFakeApi({ reply: 'Готово', plan: 'credits' });
    loginAs('credits');
    usePreferences.setState({ maxMode: true });
    const user = userEvent.setup();
    renderRoute('/chat');

    const toggle = await screen.findByRole('button', { name: /^Max:/ });
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(toggle).toHaveAccessibleName(/Режим Max включён/);

    await user.type(await screen.findByLabelText(COMPOSER), 'Привет');
    await user.click(screen.getByRole('button', { name: 'Отправить' }));
    await waitFor(() => expect(api.completionBodies.length).toBe(1));
    expect(api.completionBodies[0].reasoningMode).toBe('max');
  });

  it('гость не может включить Max: запрос уходит в обычном режиме', async () => {
    const api = installFakeApi({ reply: 'Готово' });
    usePreferences.setState({ maxMode: true });
    const user = userEvent.setup();
    renderRoute('/chat');

    await user.type(await screen.findByLabelText(COMPOSER), 'Привет');
    await user.click(screen.getByRole('button', { name: 'Отправить' }));
    await waitFor(() => expect(api.completionBodies.length).toBe(1));
    expect(api.completionBodies[0].reasoningMode).toBeUndefined();
  });
});
