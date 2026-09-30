import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useAuth } from '@/features/auth/auth-store';
import { renderRoute, resetAuth, resetPreferences } from './test-utils';

describe('маршрутизация и каркас экранов', () => {
  beforeEach(() => {
    resetPreferences();
  });

  it('лендинг открывается и ведёт в чат', () => {
    renderRoute('/');

    expect(screen.getByRole('heading', { level: 1, name: 'Ketner AI' })).toBeInTheDocument();
    const startLinks = screen.getAllByRole('link', { name: 'Начать чат' });
    expect(startLinks.length).toBeGreaterThan(0);
    expect(startLinks[0]).toHaveAttribute('href', '/chat');
  });

  it('экран чата показывает каркас: сайдбар, пустое состояние и композер', () => {
    renderRoute('/chat');

    expect(screen.getByRole('complementary', { name: 'Чаты' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Новый чат' })).toHaveAttribute('href', '/chat');
    expect(screen.getByRole('heading', { level: 2, name: 'С чего начнём?' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Спросите что-нибудь…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Отправить' })).toBeDisabled();
  });

  it('диалог с идентификатором открывает тот же экран чата', () => {
    renderRoute('/chat/abc-123');

    expect(screen.getByRole('complementary', { name: 'Чаты' })).toBeInTheDocument();
  });

  it('страница тарифов перечисляет планы и ведёт на оформление', () => {
    renderRoute('/pricing');

    expect(screen.getByRole('heading', { level: 1, name: 'Тарифы' })).toBeInTheDocument();
    for (const plan of ['Free', 'Plus', 'Pro', 'Ultra']) {
      expect(screen.getByRole('heading', { level: 2, name: plan })).toBeInTheDocument();
    }

    const paidLinks = screen.getAllByRole('link', { name: 'Выбрать план' });
    expect(paidLinks.map((link) => link.getAttribute('href'))).toEqual([
      '/checkout/plus',
      '/checkout/pro',
      '/checkout/ultra',
    ]);
  });

  it('страница документации открывается по /docs', () => {
    renderRoute('/docs');

    expect(
      screen.getByRole('heading', { level: 1, name: 'Документация Ketner AI' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Тарифные планы и лимиты')).toBeInTheDocument();
  });

  it('страница API и подключения агентов открывается по /api-docs', () => {
    renderRoute('/api-docs');

    expect(
      screen.getByRole('heading', { level: 1, name: /API & Подключение AI-агентов к машине/ }),
    ).toBeInTheDocument();
    expect(screen.getByText('Секретные API-ключи')).toBeInTheDocument();
    expect(screen.getByText('Base URL (OpenAI V1)')).toBeInTheDocument();
  });

  it('страница входа показывает форму и кнопки OAuth-заглушек', () => {
    renderRoute('/login');

    expect(screen.getByRole('heading', { level: 1, name: 'Вход в Ketner AI' })).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Пароль')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Продолжить с Google' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Продолжить с GitHub' })).toBeInTheDocument();
  });

  it('настройки открываются в каркасе приложения', () => {
    renderRoute('/settings');

    expect(screen.getByRole('heading', { level: 1, name: 'Настройки' })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Чаты' })).toBeInTheDocument();
    // Переключателей темы два: в шапке и в футере сайдбара.
    expect(screen.getAllByRole('button', { name: /Тема/ }).length).toBeGreaterThan(0);
  });

  it('оформление подписки показывает выбранный план', () => {
    useAuth.setState({
      status: 'authenticated',
      token: 'mock-token',
      user: {
        id: 'test-user',
        email: 'test@ketner.ai',
        name: 'Тест',
        plan: 'free',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    });

    renderRoute('/checkout/plus');

    expect(
      screen.getByRole('heading', { level: 1, name: 'Оформление подписки' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Plus' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Подтвердить оплату через СБП/i })).toBeInTheDocument();
  });

  it('неавторизованный пользователь при попытке оформления подписки перенаправляется на регистрацию', () => {
    resetAuth();
    renderRoute('/checkout/gpt-pro');

    expect(
      screen.getByRole('heading', { level: 1, name: 'Создание аккаунта' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Для оформления подписки необходимо сначала войти или создать аккаунт.'),
    ).toBeInTheDocument();
  });

  it('неизвестный тариф на оформлении приводит к экрану «не найдено»', () => {
    useAuth.setState({
      status: 'authenticated',
      token: 'mock-token',
      user: {
        id: 'test-user',
        email: 'test@ketner.ai',
        name: 'Тест',
        plan: 'free',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    });

    renderRoute('/checkout/unknown-plan');

    expect(
      screen.getByRole('heading', { level: 1, name: 'Страница не найдена' }),
    ).toBeInTheDocument();
  });

  it('неизвестный адрес отдаёт 404', () => {
    renderRoute('/no-such-page');

    expect(
      screen.getByRole('heading', { level: 1, name: 'Страница не найдена' }),
    ).toBeInTheDocument();
  });
});
