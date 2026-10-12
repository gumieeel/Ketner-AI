import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PlanCards } from '@/components/pricing/plan-cards';
import { Reveal } from '@/components/ui/reveal';
import { SectionLabel } from '@/components/ui/section-label';
import { Tab, TabList, TabPanel, Tabs } from '@/components/ui/tabs';
import type { TranslationKey } from '@/i18n';
import { useTranslation } from '@/i18n';
import { cn } from '@/lib/cn';

type PlanKey = 'free' | 'plus' | 'pro' | 'ultra';

const PLAN_KEYS: readonly PlanKey[] = ['free', 'plus', 'pro', 'ultra'];

const PLAN_NAME_KEYS: Record<PlanKey, TranslationKey> = {
  free: 'pricing.free',
  plus: 'pricing.plus',
  pro: 'pricing.pro',
  ultra: 'pricing.ultra',
};

const TIER_DOT: Record<PlanKey, string> = {
  free: 'bg-subtle',
  plus: 'bg-tier-plus',
  pro: 'bg-tier-pro',
  ultra: 'bg-tier-ultra',
};

interface ComparisonRow {
  feature: { ru: string; en: string };
  free: { ru: string; en: string };
  plus: { ru: string; en: string };
  pro: { ru: string; en: string };
  ultra: { ru: string; en: string };
}

const COMPARISON_ROWS: ComparisonRow[] = [
  {
    feature: { ru: 'Доступные модели', en: 'Available models' },
    free: { ru: 'Ketner Mini', en: 'Ketner Mini' },
    plus: { ru: 'Ketner Pro, GPT-6.1 Sol, Claude Haiku 5.5, DeepSeek V4.1 Flash', en: 'Ketner Pro, GPT-6.1 Sol, Claude Haiku 5.5, DeepSeek V4.1 Flash' },
    pro: { ru: 'Все из Plus + Claude Opus 5.5, Sonnet 5.5, Fable 5.1, GPT-6 Astra, GPT-5.6 Sol, GPT-5.6 Terra xhigh, Grok 4.7 xhigh', en: 'All Plus + Claude Opus 5.5, Sonnet 5.5, Fable 5.1, GPT-6 Astra, GPT-5.6 Sol, GPT-5.6 Terra xhigh, Grok 4.7 xhigh' },
    ultra: { ru: 'Все модели Pro + режим Max (xhigh), лимиты в 2–3 раза выше', en: 'All Pro models + Max mode (xhigh), 2–3× higher limits' },
  },
  {
    feature: { ru: 'Скорость генерации', en: 'Generation speed' },
    free: { ru: 'Базовая', en: 'Standard' },
    plus: { ru: 'Быстрая', en: 'Fast' },
    pro: { ru: 'Средняя (пониженная)', en: 'Standard (reduced vs Ultra)' },
    ultra: { ru: 'Максимальная (100% скорость)', en: 'Maximum (100% speed)' },
  },
  {
    feature: { ru: 'Размер контекста', en: 'Context window' },
    free: { ru: 'Базовый контекст', en: 'Basic context' },
    plus: { ru: 'Стандартный', en: 'Standard' },
    pro: { ru: 'Повышенный контекст', en: 'Extended context' },
    ultra: { ru: 'Максимальный контекст', en: 'Maximum context' },
  },
  {
    feature: { ru: 'Использование моделей', en: 'Model capacity usage' },
    free: { ru: 'Базовое (до 3 сообщ./час)', en: 'Basic (up to 3 msgs/hr)' },
    plus: { ru: 'Стандартное без очередей', en: 'Standard without queuing' },
    pro: { ru: 'Топовые модели с оптимизацией квот', en: 'Top models with quota optimization' },
    ultra: { ru: '100% использование без ограничений', en: '100% usage without limitations' },
  },
  {
    feature: { ru: 'Приоритет очереди', en: 'Queue priority' },
    free: { ru: 'Стандартный', en: 'Standard' },
    plus: { ru: 'Повышенный', en: 'Enhanced' },
    pro: { ru: 'Высокий серверный', en: 'High server' },
    ultra: { ru: 'Выделенный VIP-приоритет', en: 'Dedicated VIP priority' },
  },
  {
    feature: { ru: 'API & Доступ для агентов', en: 'API & Agent access' },
    free: { ru: '—', en: '—' },
    plus: { ru: '—', en: '—' },
    pro: { ru: 'Доступно по ключу', en: 'API key included' },
    ultra: { ru: 'Высокие лимиты API + MCP', en: 'High limits API + MCP' },
  },
];

export function PricingPage() {
  const { t, language } = useTranslation();
  const [activeMobilePlan, setActiveMobilePlan] = useState<PlanKey>('pro');

  return (
    <div className="relative mx-auto flex w-full max-w-7xl flex-col gap-14 px-4 py-12 text-center sm:px-6 md:gap-20 md:py-16 lg:px-8">
      {/* Атмосфера за заголовком */}
      <div
        aria-hidden="true"
        className="bg-aurora pointer-events-none absolute inset-x-0 -top-10 h-[360px] opacity-60 [mask-image:linear-gradient(to_bottom,black,transparent)]"
      />

      {/* Заголовок страницы */}
      <Reveal eager className="relative flex flex-col items-center gap-4">
        <SectionLabel>{t('pricing.nextGenBadge')}</SectionLabel>
        <h1 className="t-headline text-text">{t('pricing.title')}</h1>
        <p className="max-w-[56ch] text-[15px] leading-relaxed text-balance text-muted md:text-[17px]">
          {t('pricing.subtitle')}
        </p>
      </Reveal>

      {/* 4 Карточки тарифов */}
      <PlanCards variant="full" />

      {/* Таблица сравнения */}
      <div className="flex w-full flex-col gap-6 text-left">
        <div className="flex flex-col gap-1.5">
          <h2 className="text-2xl font-semibold tracking-tight text-text">{t('pricing.compare')}</h2>
          <p className="text-sm text-muted md:text-[15px]">{t('pricing.compareLead')}</p>
        </div>

        {/* Mobile: выбор тарифа и одна карточка со значениями */}
        <Tabs value={activeMobilePlan} onValueChange={(value) => setActiveMobilePlan(value as PlanKey)} className="md:hidden">
          <TabList aria-label={t('pricing.planPicker')} className="w-full rounded-xl">
            {PLAN_KEYS.map((plan) => (
              <Tab key={plan} value={plan} className="flex-1 gap-1.5 px-2">
                <span aria-hidden="true" className={cn('size-1.5 rounded-full', TIER_DOT[plan])} />
                {t(PLAN_NAME_KEYS[plan])}
              </Tab>
            ))}
          </TabList>

          <TabPanel value={activeMobilePlan} className="mt-4 flex flex-col gap-4 rounded-2xl border border-stroke bg-surface p-5 shadow-sm">
            <div className="flex items-center justify-between border-b border-stroke pb-3">
              <h3 className="flex items-center gap-2 text-lg font-semibold text-text">
                <span aria-hidden="true" className={cn('size-2 rounded-full', TIER_DOT[activeMobilePlan])} />
                {t(PLAN_NAME_KEYS[activeMobilePlan])}
              </h3>
              {activeMobilePlan === 'pro' && (
                <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-semibold text-accent">
                  {t('pricing.popular')}
                </span>
              )}
            </div>
            {COMPARISON_ROWS.map((row, idx) => (
              <div key={idx} className="flex flex-col gap-1 border-b border-stroke/60 pb-3 last:border-b-0 last:pb-0">
                <span className="text-xs font-medium text-subtle">{row.feature[language]}</span>
                <span className="text-sm font-medium text-text">{row[activeMobilePlan][language]}</span>
              </div>
            ))}
          </TabPanel>
        </Tabs>

        {/* Desktop table view */}
        <div
          data-testid="pricing-table"
          className="hidden overflow-x-auto rounded-2xl border border-stroke bg-surface shadow-sm md:block"
        >
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-stroke bg-surface-2/80 text-[13px]">
                <th className="sticky left-0 z-20 min-w-[200px] border-r border-stroke bg-surface-2 p-4 text-left font-semibold text-text">
                  {t('pricing.colFeature')}
                </th>
                {PLAN_KEYS.map((plan) => (
                  <th
                    key={plan}
                    className={cn(
                      'min-w-[150px] p-4 text-left font-semibold',
                      plan === 'pro' ? 'text-accent' : 'text-text',
                    )}
                  >
                    <span className="inline-flex items-center gap-2">
                      <span aria-hidden="true" className={cn('size-2 rounded-full', TIER_DOT[plan])} />
                      {t('pricing.colPlan', { plan: t(PLAN_NAME_KEYS[plan]) })}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-stroke/60">
              {COMPARISON_ROWS.map((row, idx) => (
                <tr key={idx} className="transition-colors hover:bg-surface-2/40">
                  <td className="sticky left-0 z-10 border-r border-stroke bg-surface p-4 font-medium text-text">
                    {row.feature[language]}
                  </td>
                  <td className="p-4 text-[13px] leading-5 text-muted">{row.free[language]}</td>
                  <td className="p-4 text-[13px] leading-5 text-muted">{row.plus[language]}</td>
                  <td className="bg-accent-soft/40 p-4 text-[13px] leading-5 font-medium text-text">{row.pro[language]}</td>
                  <td className="p-4 text-[13px] leading-5 font-medium text-text">{row.ultra[language]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Нижняя сноска */}
      <div className="flex flex-col items-center gap-3 border-t border-stroke pt-8 text-center text-[13px] text-muted">
        <p className="max-w-[70ch] text-balance">{t('pricing.notice')}</p>
        <Link
          to="/docs"
          className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-accent hover:underline"
        >
          {t('pricing.docsLink')}
        </Link>
      </div>
    </div>
  );
}
