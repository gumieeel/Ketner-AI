import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useAuth } from '@/features/auth/auth-store';
import { getFreeUsage, incrementFreeUsage, isFreeLimitReached } from '@/features/billing/free-usage';
import { installFakeApi } from './fake-api';
import { renderRoute, resetAuth, resetChat, resetPreferences } from './test-utils';

describe('auth-flow: сценарии авторизации и сессии', () => {
  beforeEach(() => {
    resetPreferences();
    resetChat();
    resetAuth();
    installFakeApi();
  });

  afterEach(() => {
    resetPreferences();
    resetChat();
    resetAuth();
  });

  it('валидация полей на странице входа', async () => {
    renderRoute('/login');

    const submitButton = screen.getByRole('button', { name: 'Войти' });
    fireEvent.click(submitButton);

    // Должны появиться ошибки валидации email и пароля
    expect(screen.getByText(/Введите корректный email/i)).toBeInTheDocument();
    expect(screen.getByText(/Пароль должен содержать/i)).toBeInTheDocument();
  });

  it('успешный вход под демо-пользователем', async () => {
    renderRoute('/login');

    const emailInput = screen.getByLabelText(/Email/i);
    const passwordInput = screen.getByLabelText(/Пароль/i);
    const submitButton = screen.getByRole('button', { name: 'Войти' });

    fireEvent.change(emailInput, { target: { value: 'demo@ketner.ai' } });
    fireEvent.change(passwordInput, { target: { value: 'password123' } });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(useAuth.getState().status).toBe('authenticated');
      expect(useAuth.getState().user?.email).toBe('demo@ketner.ai');
    });
  });

  it('быстрый демо-вход по ссылке', async () => {
    renderRoute('/login');

    const quickFill = screen.getByText(/Быстрый вход как демо-пользователь/i);
    fireEvent.click(quickFill);

    const emailInput = screen.getByLabelText(/Email/i) as HTMLInputElement;
    const passwordInput = screen.getByLabelText(/Пароль/i) as HTMLInputElement;

    expect(emailInput.value).toBe('demo@ketner.ai');
    expect(passwordInput.value).toBe('password123');
  });

  it('валидация и успешная регистрация на странице /signup', async () => {
    renderRoute('/signup');

    const submitButton = screen.getByRole('button', { name: 'Зарегистрироваться' });
    fireEvent.click(submitButton);

    expect(screen.getByText(/Пожалуйста, укажите имя/i)).toBeInTheDocument();
    expect(screen.getByText(/Введите корректный email/i)).toBeInTheDocument();
    expect(screen.getByText(/Пароль должен содержать/i)).toBeInTheDocument();

    const nameInput = screen.getByLabelText(/Имя/i);
    const emailInput = screen.getByLabelText(/Email/i);
    const passwordInput = screen.getByLabelText(/Пароль/i);

    fireEvent.change(nameInput, { target: { value: 'Александр' } });
    fireEvent.change(emailInput, { target: { value: 'alex@example.com' } });
    fireEvent.change(passwordInput, { target: { value: 'superSecret123' } });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(useAuth.getState().status).toBe('authenticated');
      expect(useAuth.getState().user?.name).toBe('Александр');
    });
  });

  it('mock-OAuth создаёт сессию по клику', async () => {
    renderRoute('/login');

    const googleBtn = screen.getByRole('button', { name: /Продолжить с Google/i });
    fireEvent.click(googleBtn);

    await waitFor(() => {
      expect(useAuth.getState().status).toBe('authenticated');
      expect(useAuth.getState().user?.name).toBe('google User');
    });
  });

  it('выход из аккаунта в настройках переводит в гостя', async () => {
    // Предварительно авторизуем
    useAuth.setState({
      user: {
        id: 'test-user',
        email: 'test@example.com',
        name: 'Тестовый Пользователь',
        plan: 'free',
        createdAt: new Date().toISOString(),
      },
      token: 'fake-token',
      status: 'authenticated',
    });

    renderRoute('/settings');

    expect(screen.getAllByText('Тестовый Пользователь').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/test@example.com/i).length).toBeGreaterThanOrEqual(1);

    const logoutButton = screen.getByRole('button', { name: /Выйти/i });
    fireEvent.click(logoutButton);

    await waitFor(() => {
      expect(useAuth.getState().status).toBe('unauthenticated');
      expect(useAuth.getState().user).toBeNull();
    });
  });

  it('при входе в аккаунт лимит обновляется и у каждого аккаунта свои независимые лимиты', async () => {
    // 1. Гость тратит 3 сообщения и исчерпывает лимит
    incrementFreeUsage('guest');
    incrementFreeUsage('guest');
    incrementFreeUsage('guest');
    expect(isFreeLimitReached('guest')).toBe(true);

    // 2. Входим под аккаунтом demo@ketner.ai
    renderRoute('/login');
    const emailInput = screen.getByLabelText(/Email/i);
    const passwordInput = screen.getByLabelText(/Пароль/i);
    const submitButton = screen.getByRole('button', { name: 'Войти' });

    fireEvent.change(emailInput, { target: { value: 'demo@ketner.ai' } });
    fireEvent.change(passwordInput, { target: { value: 'password123' } });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(useAuth.getState().status).toBe('authenticated');
    });

    const activeUser = useAuth.getState().user!;
    // Лимит для аккаунта обновился / свежий (не заблокирован гостевым лимитом)
    expect(isFreeLimitReached(activeUser.id)).toBe(false);
    expect(getFreeUsage(activeUser.id).remaining).toBe(3);

    // 3. Аккаунт 1 тратит свои сообщения
    incrementFreeUsage(activeUser.id);
    incrementFreeUsage(activeUser.id);
    incrementFreeUsage(activeUser.id);
    expect(isFreeLimitReached(activeUser.id)).toBe(true);

    // 4. Другой аккаунт 'user-2' имеет свой независимый лимит
    expect(isFreeLimitReached('user-2')).toBe(false);
    expect(getFreeUsage('user-2').remaining).toBe(3);
  });
});
