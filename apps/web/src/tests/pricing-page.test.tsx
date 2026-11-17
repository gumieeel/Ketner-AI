import { screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import planFacts from '@/features/billing/plan-facts.json';
import { setSiteFeatures } from '@/lib/features';
import { renderRoute, resetAuth, resetPreferences } from './test-utils';

/**
 * «Тарифы» (Group 2, часть задачи 0b): бесплатно — анализ, создание и проверка; платно — тариф на
 * аккаунт. Названия, цены и объёмы — из plan-facts.json, который сверяет с services/tiers.ts
 * серверный тест plan-facts.test.ts.
 */
describe('страница «Тарифы»', () => {
  beforeEach(() => {
    resetPreferences();
    resetAuth();
    setSiteFeatures({ discovery: true });
  });
  afterEach(() => setSiteFeatures(null));

  it('тарифы — из plan-facts.json: цена, решения, обращения, внешние сервисы, помощь', async () => {
    renderRoute('/pricing');
    expect(await screen.findByRole('heading', { level: 1, name: 'Тарифы' })).toBeInTheDocument();
    for (const tier of planFacts.tiers.items) {
      const card = screen.getByTestId(`tier-${tier.id}`);
      expect(within(card).getByRole('heading', { level: 3, name: tier.name })).toBeVisible();
      expect(card).toHaveTextContent(`$${tier.priceUsd}`);
      expect(card).toHaveTextContent(
        new RegExp(
          `До ${String(tier.monthlyRequests).replace(/\B(?=(\d{3})+$)/g, '\\s')} обращений в месяц`,
        ),
      );
    }
    const start = screen.getByTestId('tier-start');
    expect(start).toHaveTextContent('1 активное решение');
    expect(start).toHaveTextContent('Без внешних сервисов');
    expect(start).toHaveTextContent('Установка кнопки на сайт командой Ketner');
    const growth = screen.getByTestId('tier-growth');
    expect(growth).toHaveTextContent('3 активных решения');
    expect(growth).toHaveTextContent('2 внешних сервиса');
    expect(growth).toHaveTextContent('2 ч помощи с подключением в месяц');
    expect(screen.getByTestId('tier-business')).toHaveTextContent('5 внешних сервисов');
  });

  it('бесплатно — анализ, создание и проверка; правила объёма — из каталога тарифов', () => {
    renderRoute('/pricing');
    const free = screen.getByRole('heading', { level: 2, name: 'Бесплатно' }).closest('section')!;
    expect(free).toHaveTextContent(/Один анализ в день — без регистрации/);
    expect(free).toHaveTextContent(/в пределах бесплатного месячного лимита/);
    const rules = screen
      .getByRole('heading', { level: 2, name: 'Если обращений больше' })
      .closest('section')!;
    expect(rules).toHaveTextContent(
      `При ${Math.round(planFacts.tiers.warnRate * 100)}% объёма предупредим заранее.`,
    );
    expect(rules).toHaveTextContent(
      `Ещё ${Math.round(planFacts.tiers.graceRate * 100)}% сверх объёма — без доплаты.`,
    );
    expect(rules).toHaveTextContent('Тариф выше — только с вашего согласия.');
  });

  it('тариф подключает команда: ссылка на обратную связь; ни кредитов, ни пакетов, ни звёзд', () => {
    renderRoute('/pricing');
    expect(screen.getByRole('link', { name: 'Подключить тариф' })).toHaveAttribute(
      'href',
      '/contacts?topic=payment',
    );
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/кредит|Купить|⭐|звёзд|без подписки|\$15 в месяц/i);
    expect(screen.queryByTestId('pack-list')).toBeNull();
  });
});
