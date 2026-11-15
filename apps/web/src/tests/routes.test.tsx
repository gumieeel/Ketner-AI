import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useAuth } from '@/features/auth/auth-store';
import { renderRoute, resetAuth, resetPreferences } from './test-utils';
import { setProductSwitchesForTests } from '@/lib/product-switches';

// Закрытые возможности (lib/product-switches.ts): здесь проверяется их спящий код.
setProductSwitchesForTests({ chat: true, code: true, images: true, developerApi: true });

describe('маршрутизация и каркас экранов', () => {
  beforeEach(() => {
    resetPreferences();
  });

  it('лендинг открывается и ведёт в чат', () => {
    renderRoute('/');

    expect(
      screen.getByRole('heading', { level: 1, name: 'Все сильные модели без подписки' }),
    ).toBeInTheDocument();
    const startLinks = screen.getAllByRole('link', { name: 'Начать бесплатно' });
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

  it('страница «Кредиты» перечисляет пакеты и ведёт на оформление', () => {
    renderRoute('/pricing');

    expect(screen.getByRole('heading', { level: 1, name: 'Кредиты' })).toBeInTheDocument();
    const buyLinks = screen.getAllByRole('link', { name: 'Купить' });
    expect(buyLinks.map((link) => link.getAttribute('href'))).toEqual([
      '/checkout/credits-5',
      '/checkout/credits-10',
      '/checkout/credits-25',
      '/checkout/credits-50',
      '/checkout/credits-100',
    ]);
  });

  it('страница документации открывается по /docs', () => {
    renderRoute('/docs');

    expect(
      screen.getByRole('heading', { level: 1, name: 'Документация Ketner AI' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Кредиты и пакеты')).toBeInTheDocument();
  });

  it('страница API для разработчиков открывается по /api-docs', () => {
    renderRoute('/api-docs');

    expect(
      screen.getByRole('heading', { level: 1, name: 'API для разработчиков' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'API-ключи' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Адрес API' })).toBeInTheDocument();
    // Гость видит приглашение войти, а не выдуманные ключи
    expect(screen.getByText('Войдите, чтобы создавать ключи и управлять ими.')).toBeInTheDocument();
    expect(screen.queryByText(/ketner_sk_live/)).toBeNull();
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

  it('оформление показывает выбранный пакет кредитов', () => {
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

    renderRoute('/checkout/credits-10');
    fireEvent.click(screen.getByRole('checkbox', { name: /Я хочу получить кредиты сразу/ }));

    expect(screen.getByRole('heading', { level: 1, name: 'Покупка кредитов' })).toBeInTheDocument();
    expect(screen.getByText('Выбранный пакет')).toBeInTheDocument();
    expect(screen.getAllByText(/4[\s\u00a0]700 кредитов/).length).toBeGreaterThan(0);
    expect(
      screen.getByRole('button', { name: /Подтвердить оплату криптовалютой/i }),
    ).toBeInTheDocument();
  });

  it('неавторизованный пользователь при попытке оформления пакета перенаправляется на регистрацию', () => {
    resetAuth();
    renderRoute('/checkout/credits-10');

    expect(
      screen.getByRole('heading', { level: 1, name: 'Создание аккаунта' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Чтобы купить кредиты, сначала войдите или создайте аккаунт.'),
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
