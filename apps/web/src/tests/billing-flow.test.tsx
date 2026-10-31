import { fireEvent, screen, waitFor, within } from '@testing-library/react';
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

const AUTH_USER = {
  id: 'demo-user',
  email: 'demo@ketner.ai',
  name: 'Демо Пользователь',
  plan: 'free' as const,
  createdAt: '2026-01-01T00:00:00.000Z',
};

/** Панели оплаты открываются после согласия на мгновенное начисление кредитов. */
function acceptWithdrawal(): void {
  fireEvent.click(screen.getByRole('checkbox', { name: /Я хочу получить кредиты сразу/ }));
}

function signIn(plan: 'free' | 'credits' | 'plus' = 'free'): void {
  useAuth.setState({
    status: 'authenticated',
    token: 'mock-token',
    user: { ...AUTH_USER, plan },
  });
}

describe('billing-flow: пакеты кредитов, оформление и подписка прежней системы', () => {
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

  it('страница «Кредиты» показывает пробные кредиты, пять пакетов и сравнение уровней', async () => {
    signIn();
    renderRoute('/pricing');

    expect(screen.getByRole('heading', { level: 1, name: 'Кредиты' })).toBeInTheDocument();
    // Подарок новым пользователям
    expect(screen.getByTestId('trial-banner')).toHaveTextContent(/200 кредитов в подарок/);

    // Пять пакетов от $5 до $100, у каждого — своя ссылка на оформление
    const list = screen.getByTestId('pack-list');
    expect(within(list).getAllByRole('listitem', { name: '' }).length).toBeGreaterThan(0);
    for (const [id, price] of [
      ['credits-5', '$5'],
      ['credits-10', '$10'],
      ['credits-25', '$25'],
      ['credits-50', '$50'],
      ['credits-100', '$100'],
    ] as const) {
      const row = screen.getByTestId(`pack-${id}`);
      expect(within(row).getByText(price)).toBeInTheDocument();
      expect(within(row).getByRole('link', { name: 'Купить' })).toHaveAttribute(
        'href',
        `/checkout/${id}`,
      );
    }
    // Самый большой пакет дешевле всех: скидка 20 % к цене за 1 000 кредитов
    expect(within(screen.getByTestId('pack-credits-100')).getByText('−20%')).toBeInTheDocument();
    // Звёзды и бонус за криптовалюту указаны заранее
    expect(
      within(screen.getByTestId('pack-credits-10')).getByText(/510 ⭐ в Telegram/),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId('pack-credits-10')).getByText(/\+705 кредитов при оплате криптой/),
    ).toBeInTheDocument();

    // Подписок и закрытых моделей на странице нет
    const table = screen.getByTestId('pricing-table');
    expect(within(table).getByText('Без покупок')).toBeInTheDocument();
    expect(within(table).getByText('Есть купленные кредиты')).toBeInTheDocument();
    expect(screen.queryByText(/Выбрать план|Текущий план/)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Plus|Ultra/ })).not.toBeInTheDocument();
  });

  it('чекаут: неавторизованный пользователь перенаправляется на регистрацию', async () => {
    resetAuth();
    renderRoute('/checkout/credits-10');

    expect(
      screen.getByRole('heading', { level: 1, name: 'Создание аккаунта' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Чтобы купить кредиты, сначала войдите или создайте аккаунт.'),
    ).toBeInTheDocument();
  });

  it('старые адреса оформления тарифов ведут на страницу «Кредиты»', async () => {
    signIn();
    renderRoute('/checkout/pro');
    expect(await screen.findByRole('heading', { level: 1, name: 'Кредиты' })).toBeInTheDocument();
  });

  it('чекаут: по умолчанию криптовалюта, СБП среди способов оплаты нет', async () => {
    signIn();
    renderRoute('/checkout/credits-10');
    acceptWithdrawal();

    expect(screen.getByRole('heading', { level: 1, name: 'Покупка кредитов' })).toBeInTheDocument();
    expect(await screen.findByText(/Оплата криптовалютой/i)).toBeInTheDocument();
    expect(screen.getByText(/Пакет: 4\s700 кредитов · 365 дней/)).toBeInTheDocument();

    const confirmCrypto = screen.getByRole('button', { name: /Подтвердить оплату криптовалютой/i });
    expect(confirmCrypto).toBeInTheDocument();

    // СБП пока убрана: остаются криптовалюта и Telegram Stars.
    expect(screen.queryByRole('button', { name: /СБП/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Telegram Stars/i })).toBeInTheDocument();
  });

  it('чекаут: криптовалюта показывает виджет Trybit и после оплаты начисляет кредиты', async () => {
    signIn();
    renderRoute('/checkout/credits-10');
    acceptWithdrawal();

    fireEvent.click(screen.getByRole('button', { name: /Криптовалюта/i }));

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

    fireEvent.click(screen.getByRole('button', { name: /Подтвердить оплату криптовалютой/i }));

    await waitFor(() => {
      expect(screen.getByText(/Кредиты начислены/i)).toBeInTheDocument();
      expect(screen.getByText(/Перейти в чат/i)).toBeInTheDocument();
      expect(screen.getByText(/В настройки/i)).toBeInTheDocument();
    });
    // Адрес после оплаты — для цели «Покупка» в рекламных кабинетах.
    expect(window.location.pathname).toBe('/checkout/success');
    expect(window.location.search).toBe('?item=credits-10');

    // Уровень доступа стал «кредиты», подписки у покупателя нет
    expect(useAuth.getState().user?.plan).toBe('credits');
    expect(useBilling.getState().subscription).toBeNull();
  });

  it('чекаут: если Trybit не выставил счёт — понятная ошибка и повтор', async () => {
    signIn();
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
    renderRoute('/checkout/credits-10');
    acceptWithdrawal();
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

  it('чекаут: все монеты и сети Trybit, поиск; комиссию шлюза платит сервис, а не покупатель', async () => {
    signIn();
    const base = globalThis.fetch;
    const requested: string[] = [];
    const bodies: Array<{ packId?: string }> = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/billing/crypto/create-invoice') {
        const body = JSON.parse(String(init?.body)) as { currency: string; packId?: string };
        requested.push(body.currency);
        bodies.push(body);
      }
      return base(input, init);
    });
    renderRoute('/checkout/credits-10');
    acceptWithdrawal();
    fireEvent.click(screen.getByRole('button', { name: /Криптовалюта/i }));

    // Счёт по умолчанию — USDT в Tron: покупатель платит ровно цену пакета, комиссия шлюза на сервисе
    expect(await screen.findByText('Итого к оплате')).toBeInTheDocument();
    expect(bodies[0]?.packId).toBe('credits-10');
    expect(screen.getAllByText('$10').length).toBeGreaterThan(0);
    expect(
      screen.getByText(/Комиссия Trybit \(\$0\.17 \+ \$1\.40\) на стороне сервиса/),
    ).toBeInTheDocument();
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
  });

  it('настройки: подписка прежней системы видна и отключается, новых подписок нет', async () => {
    signIn('plus');

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
    expect(cancelButton).toBeInTheDocument();

    fireEvent.click(cancelButton);

    await waitFor(() => {
      // Уровень доступа возвращается к бесплатному
      expect(useAuth.getState().user?.plan).toBe('free');
      expect(useBilling.getState().subscription?.status).toBe('canceled');
    });
  });

  it('чекаут: Telegram Stars показывает звёзды пакета, их цену и ссылку на бота', async () => {
    signIn();

    renderRoute('/checkout/credits-100');
    acceptWithdrawal();

    fireEvent.click(screen.getByRole('button', { name: /Telegram Stars/i }));

    // 5010 Stars, их цена по официальному курсу Telegram и кнопка перехода в бота
    expect(await screen.findByText('5010')).toBeInTheDocument();
    expect(
      screen.getByText('≈ $100.15 по официальному курсу Telegram (1 000 ⭐ = $19.99)'),
    ).toBeInTheDocument();
    expect(screen.getByText(/57\s500 кредитов · действуют 365 дней/)).toBeInTheDocument();
    // Разница с ценой пакета — только округление, пометки «дороже» нет
    expect(screen.queryByText(/В звёздах дороже/)).not.toBeInTheDocument();
    const payLink = screen.getByRole('link', { name: /Оплатить в Telegram/i });
    expect(payLink).toHaveAttribute(
      'href',
      'https://t.me/Robo_kassa_bot?start=pay_credits-100_demo-user',
    );
    expect(screen.getByRole('button', { name: /Подтвердить оплату Stars/i })).toBeInTheDocument();
  });

  it('чекаут: неизвестный пакет — страница «не найдено» со ссылкой на кредиты', async () => {
    signIn();
    renderRoute('/checkout/pack/premium-5');
    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(screen.queryByText(/премиум-квоты/)).not.toBeInTheDocument();
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

  it('страница оплаты пакета объясняет бонус +15 % кредитами и называет итог', async () => {
    signIn();
    renderRoute('/checkout/credits-25');
    acceptWithdrawal();
    expect(
      await screen.findByText(/Бонус \+1\s785 кредитов за оплату криптой/),
    ).toBeInTheDocument();
    expect(screen.getByText(/вместо 11\s900 вы получите 13\s685 кредитов/)).toBeInTheDocument();
    expect(screen.getByText(/Trybit · \+1\s785 кредитов в подарок/)).toBeInTheDocument();
  });
});
