import { screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuth } from '@/features/auth/auth-store';
import { STARTING_PRICE, TIERS } from '@/features/billing/tiers';
import { RELEASES, ROADMAP } from '@/features/content/changelog';
import { KNOWN_ISSUES } from '@/features/content/known-issues';
import { HOME_FAQ } from '@/features/discovery/home-content';
import { setSiteFeatures } from '@/lib/features';
import { installFakeApi } from './fake-api';
import { renderRoute, resetAuth, resetPreferences } from './test-utils';

/**
 * Тексты сайта о прежнем продукте (Group 2): мультимодельный чат, кредиты без подписки, звёзды.
 * Сейчас продукт — ИИ-агенты для бизнеса: бесплатно создать, тариф на аккаунт за работающие решения.
 */
const OLD_PRODUCT = /без подписки|в одном чате|звёзд|⭐|Ketner Code|кредит/i;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('тексты о продукте', () => {
  beforeEach(() => {
    resetPreferences();
    resetAuth();
    setSiteFeatures({ discovery: true });
  });
  afterEach(() => {
    setSiteFeatures(null);
    vi.unstubAllGlobals();
  });

  it('вход: слоган о ИИ-агентах для бизнеса, а не «все модели без подписки»', async () => {
    renderRoute('/login');
    expect(await screen.findByText('ИИ-агенты для вашего бизнеса.')).toBeInTheDocument();
    expect(screen.queryByText(/Все AI-модели/)).toBeNull();
    expect(screen.getByText(/Создание и проверка — бесплатно\./)).toBeInTheDocument();
  });

  it('главная: блок цен и вопрос «Сколько это стоит?» — тариф от младшей цены, без кредитов', async () => {
    renderRoute('/');
    const pricing = (await screen.findByRole('heading', { level: 2, name: 'Цены' })).closest(
      'section',
    )!;
    expect(pricing).toHaveTextContent(
      `Платите только за работающие решения: тариф на аккаунт от ${STARTING_PRICE} в месяц.`,
    );
    expect(pricing.textContent).not.toMatch(OLD_PRODUCT);
    const price = HOME_FAQ.find((item) => item.id === 'price')!;
    expect(price.a.ru).toContain(`от ${STARTING_PRICE} в месяц`);
    expect(price.a.ru).not.toMatch(OLD_PRODUCT);
    expect(price.a.en).not.toMatch(/credits|no subscription/i);
    expect(STARTING_PRICE).toBe(`$${Math.min(...TIERS.map((tier) => tier.priceUsd))}`);
  });

  it('«О проекте»: платформа ИИ-агентов, без чата, кредитов и звёзд', async () => {
    renderRoute('/about');
    const article = (await screen.findByRole('heading', { level: 1, name: 'О проекте' })).closest(
      'article',
    )!;
    expect(article).toHaveTextContent(/платформа ИИ-агентов для малого и среднего бизнеса/);
    expect(article).toHaveTextContent(`тариф на аккаунт от ${STARTING_PRICE} в месяц`);
    expect(within(article).getByRole('link', { name: '«Тарифы»' })).toHaveAttribute(
      'href',
      '/pricing',
    );
    // В истории закрытие чата и Ketner Code — факт; предложения о кредитах, звёздах и чате нет.
    expect(article.textContent).not.toMatch(/без подписки|в одном чате|звёзд|⭐|кредит/i);
  });

  it('«Что нового»: последняя запись — тарифы вместо кредитов, условия возврата за пакеты сохранены', () => {
    const [latest] = RELEASES;
    expect(latest?.date).toBe('2026-11-20');
    expect(latest?.title).toBe('Тарифы вместо кредитов');
    const text = latest!.items.map((item) => item.text).join(' ');
    expect(text).toMatch(/Пакеты кредитов больше не продаются/);
    expect(text).toMatch(/автоматических списаний нет/);
    expect(text).toMatch(/в течение 14 дней, пока из пакета ничего не потрачено/);
  });

  it('«Что нового»: запись о переходе на ИИ-агентов с тарифами из каталога; планы — без чата', () => {
    const release = RELEASES.find((item) => item.date === '2026-11-17');
    expect(release?.title).toBe('Ketner — ИИ-агенты для бизнеса');
    const text = release!.items.map((item) => item.text).join(' ');
    for (const tier of TIERS) expect(text).toContain(`${tier.name} — $${tier.priceUsd}`);
    expect(text).toMatch(/Общий чат с моделями, Ketner Code, генерация картинок/);
    expect(text).toMatch(/Оплата звёздами Telegram больше не принимается/);
    expect(ROADMAP.join(' ')).not.toMatch(/чат|Gemini|WhatsApp/i);
  });

  it('«Статус»: компоненты без чата, Code и API; известная проблема — об оплате тарифа', async () => {
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const path = new URL(String(input), 'http://localhost').pathname;
      if (path === '/api/status')
        return json(200, {
          state: 'operational',
          checkedAt: '2026-11-17T10:00:00.000Z',
          components: [
            { id: 'site', state: 'operational' },
            { id: 'database', state: 'operational' },
            { id: 'models', state: 'operational' },
            { id: 'images', state: 'unavailable', note: 'Раздел закрыт' },
            { id: 'payments', state: 'operational' },
            { id: 'telegram', state: 'operational' },
          ],
        });
      return json(404, {});
    });
    renderRoute('/status');
    expect(await screen.findByText('Модели ИИ для анализа, помощников и ботов')).toBeVisible();
    expect(screen.getByText('Аккаунты, анализы и решения')).toBeVisible();
    expect(screen.getByText('Раздел закрыт')).toBeVisible();
    expect(document.body.textContent).not.toMatch(
      /Ketner Code|чат, |API для|Оплата только криптовалютой/,
    );
    const payment = KNOWN_ISSUES.find((issue) => issue.id === 'payment-methods')!;
    expect(payment.title).toBe('Оплаты тарифа на сайте пока нет');
  });

  it('настройки: без раздела кредитов и без звёзд в описании Telegram', async () => {
    useAuth.setState({
      status: 'authenticated',
      token: 't',
      user: {
        id: 'u1',
        email: 'u1@example.com',
        name: 'Анна',
        plan: 'free',
        createdAt: '2026-11-01T10:00:00.000Z',
      } as never,
    });
    installFakeApi();
    renderRoute('/settings');
    expect(await screen.findByRole('heading', { level: 1, name: 'Настройки' })).toBeInTheDocument();
    expect(screen.getByText('Профиль, внешний вид и вход')).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Разделы настроек' });
    expect(within(nav).queryByText('Кредиты')).toBeNull();
    expect(within(nav).queryByText('GitHub')).toBeNull();
    expect(screen.queryByText(/Остаток, кредиты/)).toBeNull();
    expect(
      screen.getByText(
        'Вход без пароля, уведомления и возвраты прежних платежей — в боте Ketner в Telegram.',
      ),
    ).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Robo_kassa|оплата звёздами|Ketner Code/);
  });
});
