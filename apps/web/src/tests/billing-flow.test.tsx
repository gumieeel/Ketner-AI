import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useAuth } from '@/features/auth/auth-store';
import { useBilling } from '@/features/billing/billing-store';
import {
  cleanDigits,
  formatCardCvc,
  formatCardExpiry,
  formatCardNumber,
  validateCardCvc,
  validateCardExpiry,
  validateCardNumber,
} from '@/lib/card-mask';
import { installFakeApi } from './fake-api';
import { renderRoute, resetAuth, resetBilling, resetChat, resetPreferences } from './test-utils';

describe('card-mask: утилиты форматирования и валидации карты', () => {
  it('cleanDigits очищает любые нецифровые символы', () => {
    expect(cleanDigits('4242-abcd-1234')).toBe('42421234');
    expect(cleanDigits('   ')).toBe('');
  });

  it('formatCardNumber группирует по 4 цифры до 16 символов', () => {
    expect(formatCardNumber('12345678')).toBe('1234 5678');
    expect(formatCardNumber('12345678901234567890')).toBe('1234 5678 9012 3456');
  });

  it('formatCardExpiry форматирует месяц и год', () => {
    expect(formatCardExpiry('12')).toBe('12');
    expect(formatCardExpiry('1228')).toBe('12 / 28');
  });

  it('formatCardCvc ограничивает длину до 4 цифр', () => {
    expect(formatCardCvc('12345')).toBe('1234');
    expect(formatCardCvc('999')).toBe('999');
  });

  it('валидация номера карты, срока действия и CVC', () => {
    expect(validateCardNumber('1234 5678 9012 3456')).toBe(true);
    expect(validateCardNumber('1234 5678')).toBe(false);

    expect(validateCardExpiry('12 / 30')).toBe(true);
    expect(validateCardExpiry('13 / 30')).toBe(false); // некорректный месяц
    expect(validateCardExpiry('01 / 20')).toBe(false); // прошедший год

    expect(validateCardCvc('123')).toBe(true);
    expect(validateCardCvc('1234')).toBe(true);
    expect(validateCardCvc('12')).toBe(false);
  });
});

describe('billing-flow: каталог тарифов, чекаут и управление подпиской', () => {
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

  it('страница тарифов отображает доступные планы и текущий статус', async () => {
    // Вход как пользователь с бесплатным планом
    useAuth.setState({
      status: 'authenticated',
      token: 'mock-token',
      user: {
        id: 'demo-user',
        email: 'demo@ketner.ai',
        name: 'Демо Пользователь',
        plan: 'free',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    });

    renderRoute('/pricing');

    expect(screen.getByRole('heading', { level: 1, name: 'Тарифы' })).toBeInTheDocument();
    expect(screen.getByText('Free')).toBeInTheDocument();
    expect(screen.getByText('Plus')).toBeInTheDocument();
    expect(screen.getByText('Pro')).toBeInTheDocument();
    expect(screen.getByText('Ultra')).toBeInTheDocument();

    // Кнопка для бесплатного плана должна быть помечена как текущий план
    expect(screen.getByRole('button', { name: /Текущий план/i })).toBeDisabled();

    // Для Plus и Pro должны быть доступны кнопки выбора тарифа
    const upgradeButtons = screen.getAllByText(/Выбрать план/i);
    expect(upgradeButtons.length).toBeGreaterThan(0);
  });

  it('чекаут: неавторизованный пользователь перенаправляется на регистрацию', async () => {
    resetAuth();
    renderRoute('/checkout/plus');

    expect(screen.getByRole('heading', { level: 1, name: 'Создание аккаунта' })).toBeInTheDocument();
    expect(
      screen.getByText('Для оформления подписки необходимо сначала войти или создать аккаунт.'),
    ).toBeInTheDocument();
  });

  it('чекаут: по умолчанию отображается СБП с суммой в рублях и кнопкой подтверждения', async () => {
    useAuth.setState({
      status: 'authenticated',
      token: 'mock-token',
      user: {
        id: 'demo-user',
        email: 'demo@ketner.ai',
        name: 'Демо Пользователь',
        plan: 'free',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    });

    renderRoute('/checkout/plus');

    expect(
      screen.getByRole('heading', { level: 1, name: 'Оформление подписки' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Plus')).toBeInTheDocument();
    expect(screen.getAllByText(/990 ₽/i).length).toBeGreaterThan(0);

    const confirmSbp = screen.getByRole('button', { name: /Подтвердить оплату через СБП/i });
    expect(confirmSbp).toBeInTheDocument();
  });

  it('чекаут: выбор способа оплаты Криптовалюта отображает реквизиты и подтверждает транзакцию', async () => {
    useAuth.setState({
      status: 'authenticated',
      token: 'mock-token',
      user: {
        id: 'demo-user',
        email: 'demo@ketner.ai',
        name: 'Демо Пользователь',
        plan: 'free',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    });

    renderRoute('/checkout/plus');

    // Кликаем по способу оплаты «Криптовалюта»
    const cryptoTab = screen.getByRole('button', { name: /Криптовалюта/i });
    fireEvent.click(cryptoTab);

    // Должны появиться заголовок криптовалюты, сеть и адрес кошелька
    expect(await screen.findByText(/Оплата криптовалютой/i)).toBeInTheDocument();
    expect(screen.getByText(/USDT \(TRC-20\)/i)).toBeInTheDocument();
    expect(screen.getByText(/TDyeGqX4ranC94g7RMw6cGsCPvRQ7XAtQP/i)).toBeInTheDocument();

    const confirmCryptoButton = screen.getByRole('button', {
      name: /Подтвердить оплату криптовалютой/i,
    });
    fireEvent.click(confirmCryptoButton);

    await waitFor(() => {
      expect(screen.getByText(/Подписка успешно оформлена/i)).toBeInTheDocument();
      expect(screen.getByText(/Перейти в чат/i)).toBeInTheDocument();
      expect(screen.getByText(/В настройки/i)).toBeInTheDocument();
    });

    // Проверяем, что в auth-store план пользователя синхронизирован с 'plus'
    expect(useAuth.getState().user?.plan).toBe('plus');
    expect(useBilling.getState().subscription?.plan).toBe('plus');
  });

  it('настройки: отображение платной подписки и отмена подписки', async () => {
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
      plans: [],
      loading: false,
      error: null,
    });

    renderRoute('/settings');

    expect(screen.getByText('Plus')).toBeInTheDocument();
    const cancelButton = screen.getByRole('button', { name: /Отменить подписку/i });
    expect(cancelButton).toBeInTheDocument();

    fireEvent.click(cancelButton);

    await waitFor(() => {
      // План пользователя должен стать 'free'
      expect(useAuth.getState().user?.plan).toBe('free');
      expect(useBilling.getState().subscription?.status).toBe('canceled');
    });
  });

  it('чекаут: выбор способа оплаты СБП показывает QR-код и подтверждает оплату', async () => {
    useAuth.setState({
      status: 'authenticated',
      token: 'mock-token',
      user: {
        id: 'demo-user',
        email: 'demo@ketner.ai',
        name: 'Демо Пользователь',
        plan: 'free',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    });

    renderRoute('/checkout/gpt-pro');

    // Кликаем по вкладке СБП
    const sbpTab = screen.getByRole('button', { name: /СБП по QR/i });
    fireEvent.click(sbpTab);

    // Должен появиться блок СБП с кнопкой банка и кнопкой подтверждения
    expect(await screen.findByText(/Оплата через СБП/i)).toBeInTheDocument();
    expect(screen.getByText(/Отсканируйте QR-код в приложении любого банка/i)).toBeInTheDocument();

    const confirmButton = screen.getByRole('button', { name: /Подтвердить оплату через СБП/i });
    expect(confirmButton).toBeInTheDocument();

    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(screen.getByText(/Подписка успешно оформлена/i)).toBeInTheDocument();
      expect(screen.getByText(/Перейти в чат/i)).toBeInTheDocument();
    });

    expect(useAuth.getState().user?.plan).toBe('gpt-pro');
  });

  it('чекаут: выбор Telegram Stars отображает количество звёзд и ссылку на бота', async () => {
    useAuth.setState({
      status: 'authenticated',
      token: 'mock-token',
      user: {
        id: 'demo-user',
        email: 'demo@ketner.ai',
        name: 'Демо Пользователь',
        plan: 'free',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    });

    renderRoute('/checkout/ultra');

    // Кликаем по вкладке Telegram Stars
    const starsTab = screen.getByRole('button', { name: /Telegram Stars/i });
    fireEvent.click(starsTab);

    // Должны появиться 1350 Stars и кнопка перехода в бота
    expect(await screen.findByText('1350')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Оплатить в Telegram/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Подтвердить оплату Stars/i })).toBeInTheDocument();
  });
});
