import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { renderRoute, resetPreferences } from './test-utils';

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

  it('страница тарифов перечисляет пять планов и ведёт на оформление', () => {
    renderRoute('/pricing');

    expect(screen.getByRole('heading', { level: 1, name: 'Тарифы' })).toBeInTheDocument();
    for (const plan of ['Free', 'GPT Pro', 'Claude Pro', 'Gemini Pro', 'Ultra']) {
      expect(screen.getByRole('heading', { level: 2, name: plan })).toBeInTheDocument();
    }

    const paidLinks = screen.getAllByRole('link', { name: 'Выбрать план' });
    expect(paidLinks.map((link) => link.getAttribute('href'))).toEqual([
      '/checkout/gpt-pro',
      '/checkout/claude-pro',
      '/checkout/gemini-pro',
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
    renderRoute('/checkout/plus');

    expect(
      screen.getByRole('heading', { level: 1, name: 'Оформление подписки' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Plus' })).toBeInTheDocument();
    expect(screen.getByLabelText('Номер карты')).toBeInTheDocument();
  });

  it('неизвестный тариф на оформлении приводит к экрану «не найдено»', () => {
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
