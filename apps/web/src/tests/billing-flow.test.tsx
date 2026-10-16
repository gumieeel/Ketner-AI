import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
    expect(screen.getAllByText('Free').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Plus').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Pro').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Ultra').length).toBeGreaterThan(0);

    // Кнопка для бесплатного плана должна быть помечена как текущий план
    expect(screen.getByRole('button', { name: /Текущий план/i })).toBeDisabled();

    // Для Plus и Pro должны быть доступны кнопки выбора тарифа
    const upgradeButtons = screen.getAllByText(/Выбрать план/i);
    expect(upgradeButtons.length).toBeGreaterThan(0);
  });

  it('чекаут: неавторизованный пользователь перенаправляется на регистрацию', async () => {
    resetAuth();
    renderRoute('/checkout/plus');

    expect(
      screen.getByRole('heading', { level: 1, name: 'Создание аккаунта' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Для оформления подписки необходимо сначала войти или создать аккаунт.'),
    ).toBeInTheDocument();
  });

  it('чекаут: по умолчанию отображается криптовалюта, СБП среди способов оплаты нет', async () => {
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
    expect(await screen.findByText(/Оплата криптовалютой/i)).toBeInTheDocument();

    const confirmCrypto = screen.getByRole('button', { name: /Подтвердить оплату криптовалютой/i });
    expect(confirmCrypto).toBeInTheDocument();

    // СБП пока убрана: остаются криптовалюта и Telegram Stars.
    expect(screen.queryByRole('button', { name: /СБП/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Telegram Stars/i })).toBeInTheDocument();
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
    expect(screen.getByRole('button', { name: /USDT · Tron \(TRC-20\)/ })).toBeInTheDocument();
    // Оплата — в виджете Trybit: окно открывается кнопкой, реквизиты и ввод TxID на сайте не показываются.
    const openSpy = vi
      .spyOn(window, 'open')
      .mockReturnValue({ focus: vi.fn(), close: vi.fn() } as unknown as Window);
    const widgetButton = await screen.findByRole('link', { name: /Оплатить в виджете Trybit/ });
    fireEvent.click(widgetButton);
    expect(openSpy).toHaveBeenCalledWith(
      'https://pay.trybit.com/DEMO123',
      'ketner-trybit-pay',
      expect.stringContaining('popup=yes'),
    );
    expect(await screen.findByText(/Окно оплаты открыто/)).toBeInTheDocument();
    expect(screen.queryByText(/TTrybitH2hDemoAddrUsdtTrc20xxxxxx/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Прямой перевод/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/TxID|хеш транзакции/i)).not.toBeInTheDocument();

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

  it('чекаут: если Trybit не выставил счёт — понятная ошибка и повтор', async () => {
    useAuth.setState({
      status: 'authenticated',
      token: 'mock-token',
      user: {
        id: 'demo-user',
        email: 'demo@ketner.ai',
        name: 'Демо',
        plan: 'free',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    });
    const base = globalThis.fetch;
    let attempts = 0;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/billing/crypto/create-invoice') {
        attempts += 1;
        if (attempts === 1) {
          return Response.json(
            {
              error: {
                code: 'gateway_unavailable',
                message: 'Trybit не выставил счёт. Попробуйте ещё раз через минуту.',
              },
            },
            { status: 502 },
          );
        }
      }
      return base(input, init);
    });
    renderRoute('/checkout/plus');
    fireEvent.click(screen.getByRole('button', { name: /Криптовалюта/i }));

    expect(
      await screen.findByText('Trybit не выставил счёт. Попробуйте ещё раз через минуту.'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Выставить счёт заново' }));
    expect(
      await screen.findByRole('link', { name: /Оплатить в виджете Trybit/ }),
    ).toBeInTheDocument();
    expect(attempts).toBe(2);
  });

  it('чекаут: все монеты и сети Trybit, поиск и комиссии', async () => {
    useAuth.setState({
      status: 'authenticated',
      token: 'mock-token',
      user: {
        id: 'demo-user',
        email: 'demo@ketner.ai',
        name: 'Демо',
        plan: 'free',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    });
    const base = globalThis.fetch;
    const requested: string[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/billing/crypto/create-invoice') {
        requested.push((JSON.parse(String(init?.body)) as { currency: string }).currency);
      }
      return base(input, init);
    });
    renderRoute('/checkout/plus');
    fireEvent.click(screen.getByRole('button', { name: /Криптовалюта/i }));

    // Счёт по умолчанию — USDT в Tron: комиссии берутся из счёта Trybit
    expect(await screen.findByText('Итого к оплате')).toBeInTheDocument();
    expect(screen.getAllByText('$10.57').length).toBeGreaterThan(0);
    expect(screen.getByText(/сервис \$0\.17, перевод \$1\.40/)).toBeInTheDocument();
    expect(screen.getByText(/Комиссию сети блокчейна за отправку платите вы/)).toBeInTheDocument();

    // Все монеты доступны; редкая находится поиском, сети выбираются отдельно
    fireEvent.click(screen.getByRole('button', { name: /Показать все \(18\)/ }));
    expect(screen.getByRole('button', { name: /TRUMP/ })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'bnb' } });
    fireEvent.click(screen.getByRole('button', { name: /^BNB\s?BNB$/ }));
    await waitFor(() => expect(requested).toContain('BNB'));
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'usdc' } });
    fireEvent.click(screen.getByRole('button', { name: /^USDC\s?USD Coin/ }));
    expect(
      await screen.findByRole('button', { name: /USDC · Solana \(SOL\)/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /USDC · Ethereum \(ERC-20\)/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /USDC · Base/ }));
    await waitFor(() => expect(requested).toContain('USDC_BASE'));
    // В сети без комиссии перевода в счёте только комиссия сервиса
    await waitFor(() => expect(screen.getAllByText('$9.17').length).toBeGreaterThan(0));
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

    // Должны появиться 2460 Stars, их цена по официальному курсу Telegram и кнопка перехода в бота
    expect(await screen.findByText('2460')).toBeInTheDocument();
    expect(
      screen.getByText('≈ $49.18 по официальному курсу Telegram (1 000 ⭐ = $19.99)'),
    ).toBeInTheDocument();
    // Цена в звёздах — как картой (разница только в округлении), пометки «дороже» нет
    expect(screen.queryByText(/В звёздах дороже/)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Оплатить в Telegram/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Подтвердить оплату Stars/i })).toBeInTheDocument();
  });
});

describe('пакеты премиум-квоты', () => {
  beforeEach(() => {
    resetPreferences();
    resetChat();
    resetAuth();
    resetBilling();
  });

  const loginPro = () =>
    useAuth.setState({
      status: 'authenticated',
      token: 'mock-token',
      user: {
        id: 'demo-user',
        email: 'demo@ketner.ai',
        name: 'Демо',
        plan: 'pro',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    });

  it('на странице тарифов платный пользователь видит пакеты со ссылкой на оплату', async () => {
    installFakeApi({ plan: 'pro' });
    loginPro();
    renderRoute('/pricing');
    expect(await screen.findByText('Докупить запросы к топ-моделям')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Купить за $9' })).toHaveAttribute(
      'href',
      '/checkout/pack/premium-5',
    );
  });

  it('пакет +$5: оплата криптой начисляет квоту, тариф не меняется', async () => {
    installFakeApi({ plan: 'pro' });
    loginPro();
    renderRoute('/checkout/pack/premium-5');
    expect((await screen.findAllByText('+$5 премиум-квоты')).length).toBeGreaterThan(0);
    // Счёт Trybit выставлен на цену пакета.
    await screen.findByRole('link', { name: /Оплатить в виджете Trybit/ });
    fireEvent.click(screen.getByRole('button', { name: /Подтвердить оплату криптовалютой/i }));
    expect(await screen.findByText('Премиум-квота пополнена')).toBeInTheDocument();
    expect(screen.getByText(/Квота начислена · действует до/)).toBeInTheDocument();
    expect(useAuth.getState().user?.plan).toBe('pro');
  });

  it('на Free пакетов на странице тарифов нет', async () => {
    installFakeApi({ plan: 'free' });
    useAuth.setState({
      status: 'authenticated',
      token: 'mock-token',
      user: {
        id: 'demo-user',
        email: 'demo@ketner.ai',
        name: 'Демо',
        plan: 'free',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    });
    renderRoute('/pricing');
    await screen.findAllByText(/Ultra/);
    expect(screen.queryByText('Докупить запросы к топ-моделям')).not.toBeInTheDocument();
  });
});

describe('бонус за оплату криптой', () => {
  beforeEach(() => {
    resetPreferences();
    resetChat();
    resetAuth();
    resetBilling();
    installFakeApi();
  });

  it('страница оплаты тарифа объясняет +15% к квоте в цифрах тарифа', async () => {
    useAuth.setState({
      status: 'authenticated',
      token: 'mock-token',
      user: {
        id: 'demo-user',
        email: 'demo@ketner.ai',
        name: 'Демо',
        plan: 'free',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    });
    renderRoute('/checkout/pro');
    expect(
      await screen.findByText('Бонус +15% к квоте топ-моделей за оплату криптой'),
    ).toBeInTheDocument();
    expect(screen.getByText(/вырастет с \$8\.00 до \$9\.20/)).toBeInTheDocument();
    expect(screen.getByText(/Trybit · \+15% к квоте топ-моделей/)).toBeInTheDocument();
  });
});
