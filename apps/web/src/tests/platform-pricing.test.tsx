import { screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import planFacts from '@/features/billing/plan-facts.json';
import { setSiteFeatures } from '@/lib/features';
import { renderRoute, resetAuth, resetPreferences } from './test-utils';

describe('страница «Кредиты»: анализ задач, планы и помощники', () => {
  beforeEach(() => {
    resetPreferences();
    resetAuth();
  });
  afterEach(() => setSiteFeatures(null));

  it('при платформе решений: бесплатное, цены до запуска и лимиты — из plan-facts.json', () => {
    setSiteFeatures({ discovery: true });
    renderRoute('/pricing');
    const section = screen
      .getByRole('heading', { level: 2, name: 'Анализ задач, планы и помощники' })
      .closest('section')!;
    const { prices, limits } = planFacts.platform;
    expect(
      within(section).getByText(`1 анализ задачи в сутки на модели ${prices.freeModel}`),
    ).toBeVisible();
    expect(
      within(section).getByText(
        `Краткий план внедрения (до ${limits.plans.briefSteps} шагов) для одной возможности из этого анализа`,
      ),
    ).toBeVisible();
    const analysis = within(section).getByText('Анализ задачи').closest('div')!;
    expect(analysis).toHaveTextContent(prices.analysisPaid.model);
    expect(analysis).toHaveTextContent(
      // Склонение зависит от числа («29 кредитов», «33 кредита») — проверяем числа, а не окончание.
      new RegExp(
        `≈ ${prices.analysisPaid.typicalCredits}, не больше ${prices.analysisPaid.maxCredits} кредит(ов|а)?`,
      ),
    );
    expect(within(section).getByText(`До ${limits.assistants.perUser} помощников`)).toBeVisible();
  });

  it('без платформы раздела нет', () => {
    renderRoute('/pricing');
    expect(screen.queryByRole('heading', { name: 'Анализ задач, планы и помощники' })).toBeNull();
  });
});
