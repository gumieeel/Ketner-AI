import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useAuthNotice } from '@/features/auth/auth-notice';
import { useAuth } from '@/features/auth/auth-store';
import { FAKE_SIGNUP_CODE, installFakeApi } from './fake-api';
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

    // Пароль верный — дальше код из письма; почта на экране замаскирована
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Код для входа' }),
    ).toBeInTheDocument();
    // Страница кода — в каркасе входа, без шапки сайта поверх
    expect(screen.queryByRole('link', { name: 'Возможности' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByText(/d\*\*\*o@ketner\.ai/)).toBeInTheDocument();
    expect(screen.queryByText(/demo@ketner\.ai/)).not.toBeInTheDocument();
    expect(useAuth.getState().status).not.toBe('authenticated');

    fireEvent.change(screen.getByLabelText('Код из письма'), {
      target: { value: FAKE_SIGNUP_CODE },
    });
    await waitFor(() => {
      expect(useAuth.getState().status).toBe('authenticated');
      expect(useAuth.getState().user?.email).toBe('demo@ketner.ai');
    });
    expect(useAuthNotice.getState().notice).toBe('logged-in');
  });

  it('на странице входа нет демо-входа, но есть ссылки на условия', () => {
    renderRoute('/login');

    expect(screen.queryByText(/Быстрый вход/i)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /соглашение и оферту/i })).toHaveAttribute(
      'href',
      '/terms',
    );
    expect(screen.getByRole('link', { name: /политику конфиденциальности/i })).toHaveAttribute(
      'href',
      '/privacy',
    );
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

    // Форма не создаёт аккаунт сразу: открывается страница ввода кода из письма
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Подтвердите почту' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/a\*\*\*x@example\.com/)).toBeInTheDocument();
    expect(useAuth.getState().status).not.toBe('authenticated');
    expect(screen.getByRole('button', { name: /Отправить код ещё раз через/ })).toBeDisabled();

    const codeInput = screen.getByLabelText('Код из письма');
    fireEvent.change(codeInput, { target: { value: '000000' } });
    expect(await screen.findByText(/Неверный код/)).toBeInTheDocument();
    expect(useAuth.getState().status).not.toBe('authenticated');

    fireEvent.change(codeInput, { target: { value: FAKE_SIGNUP_CODE } });
    await waitFor(() => {
      expect(useAuth.getState().status).toBe('authenticated');
      expect(useAuth.getState().user?.name).toBe('Александр');
    });
    expect(useAuthNotice.getState().notice).toBe('signed-up');
  });

  it('страница кода без начатой регистрации возвращает на форму', async () => {
    renderRoute('/signup/verify');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Создание аккаунта' }),
    ).toBeInTheDocument();
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

  it('регистрация с параметром ?redirect=/checkout/gpt-pro перенаправляет обратно на чекаут и показывает уведомление', async () => {
    renderRoute('/signup?redirect=%2Fcheckout%2Fgpt-pro');

    expect(
      screen.getByText('Для оформления подписки необходимо сначала войти или создать аккаунт.'),
    ).toBeInTheDocument();

    const nameInput = screen.getByLabelText(/Имя/i);
    const emailInput = screen.getByLabelText(/Email/i);
    const passwordInput = screen.getByLabelText(/Пароль/i);
    const submitButton = screen.getByRole('button', { name: 'Зарегистрироваться' });

    fireEvent.change(nameInput, { target: { value: 'Покупатель' } });
    fireEvent.change(emailInput, { target: { value: 'buyer@example.com' } });
    fireEvent.change(passwordInput, { target: { value: 'secretPassword123' } });
    fireEvent.click(submitButton);

    fireEvent.change(await screen.findByLabelText('Код из письма'), {
      target: { value: FAKE_SIGNUP_CODE },
    });

    await waitFor(() => {
      expect(useAuth.getState().status).toBe('authenticated');
      expect(
        screen.getByRole('heading', { level: 1, name: 'Оформление подписки' }),
      ).toBeInTheDocument();
      expect(screen.getByText('GPT Pro')).toBeInTheDocument();
    });
  });

  it('на странице /login виден h1, две OAuth-кнопки и переключатель видимости пароля', () => {
    renderRoute('/login');

    expect(screen.getByRole('heading', { level: 1, name: 'Вход в Ketner AI' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Продолжить с Google' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Продолжить с GitHub' })).toBeInTheDocument();

    const passwordInput = screen.getByLabelText(/Пароль/i) as HTMLInputElement;
    expect(passwordInput.type).toBe('password');

    const toggleButton = screen.getByRole('button', { name: /Показать/i });
    expect(toggleButton).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(toggleButton);
    expect(passwordInput.type).toBe('text');
    expect(toggleButton).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(toggleButton);
    expect(passwordInput.type).toBe('password');
    expect(toggleButton).toHaveAttribute('aria-pressed', 'false');
  });
});
