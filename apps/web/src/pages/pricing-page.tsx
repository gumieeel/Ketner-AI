import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRightIcon, SparkleIcon } from '@/components/icons';
import { PlanCards } from '@/components/pricing/plan-cards';
import { useTranslation } from '@/i18n';
import { cn } from '@/lib/cn';

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
    free: { ru: 'Ketner Mini + GPT-4o mini', en: 'Ketner Mini + GPT-4o mini' },
    plus: { ru: 'DeepSeek v4.1 Flash, Claude Haiku 4.5, GPT-4o', en: 'DeepSeek v4.1 Flash, Claude Haiku 4.5, GPT-4o' },
    pro: { ru: 'Все из Plus + GPT-6 Astra, Claude Fable 5.1, Gemini Flash 3.8, Grok 4.7', en: 'All Plus + GPT-6 Astra, Claude Fable 5.1, Gemini Flash 3.8, Grok 4.7' },
    ultra: { ru: 'Все топовые модели на 100% без ограничений', en: 'All top models at 100% without limitations' },
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
  const [activeMobilePlan, setActiveMobilePlan] = useState<'free' | 'plus' | 'pro' | 'ultra'>('pro');

  return (
    <div className="relative mx-auto flex w-full max-w-7xl flex-col gap-12 md:gap-16 px-4 sm:px-6 lg:px-8 py-12 animate-fade-in text-center">
      {/* Заголовок страницы */}
      <div className="flex flex-col items-center gap-3">
        <div className="inline-flex items-center gap-2 rounded-sm border border-stroke bg-surface-2 px-2.5 py-1 font-mono text-[11px] font-semibold text-accent uppercase tracking-wider">
          <SparkleIcon className="size-3 text-accent" />
          <span>{t('pricing.nextGenBadge')}</span>
        </div>
        <h1 className="text-3xl md:text-5xl font-semibold tracking-[-0.03em] text-text">
          {t('pricing.title')}
        </h1>
        <p className="max-w-2xl text-sm md:text-base leading-relaxed text-muted">
          {t('pricing.subtitle')}
        </p>
      </div>

      {/* 4 Карточки тарифов */}
      <PlanCards variant="full" />

      {/* Таблица сравнения */}
      <div className="flex flex-col gap-6 w-full text-left">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold tracking-tight text-text">
            {t('pricing.compare')}
          </h2>
          <p className="text-sm text-muted">
            {language === 'ru'
              ? 'Подробный обзор возможностей каждого тарифа'
              : 'Detailed feature matrix across plans'}
          </p>
        </div>

        {/* Mobile Plan Selector Tabs */}
        <div className="md:hidden flex items-center p-1 rounded-lg border border-stroke bg-surface-2 gap-1 w-full">
          {(['free', 'plus', 'pro', 'ultra'] as const).map((plan) => (
            <button
              key={plan}
              type="button"
              onClick={() => setActiveMobilePlan(plan)}
              className={cn(
                'flex-1 py-2 text-xs font-mono font-medium rounded-md uppercase tracking-wider transition-all min-h-[44px] flex items-center justify-center',
                activeMobilePlan === plan
                  ? 'bg-surface text-accent border border-stroke shadow-xs font-semibold'
                  : 'text-muted hover:text-text',
              )}
            >
              {plan === 'free' ? 'Free' : plan === 'plus' ? 'Plus' : plan === 'pro' ? 'Pro' : 'Ultra'}
            </button>
          ))}
        </div>

        {/* Mobile Single Active Card View */}
        <div className="md:hidden w-full rounded-lg border border-stroke bg-surface p-5 flex flex-col gap-4 text-left shadow-sm">
          <div className="flex items-center justify-between border-b border-stroke pb-3 mb-1">
            <h3 className="text-base font-semibold text-text uppercase font-mono tracking-wide">
              {activeMobilePlan.toUpperCase()}
            </h3>
            {activeMobilePlan === 'pro' && (
              <span className="font-mono text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-accent/15 text-accent border border-accent/30 font-semibold">
                {language === 'ru' ? 'Популярный' : 'Popular'}
              </span>
            )}
          </div>
          {COMPARISON_ROWS.map((row, idx) => (
            <div key={idx} className="flex flex-col gap-1 pb-3 border-b border-stroke/50 last:border-b-0 last:pb-0">
              <span className="text-xs text-muted font-medium uppercase tracking-wider">
                {row.feature[language]}
              </span>
              <span className="text-sm font-medium text-text">
                {row[activeMobilePlan][language]}
              </span>
            </div>
          ))}
        </div>

        {/* Desktop table view */}
        <div data-testid="pricing-table" className="hidden md:block overflow-x-auto rounded-lg border border-stroke bg-surface">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-stroke bg-surface-2/90 text-xs font-mono uppercase tracking-wider text-muted">
                <th className="sticky left-0 bg-surface-2 p-4 text-left font-semibold text-text z-20 min-w-[200px] border-r border-stroke">
                  {language === 'ru' ? 'Функция' : 'Feature'}
                </th>
                <th className="p-4 text-left font-semibold text-text min-w-[140px]">
                  {language === 'ru' ? 'Тариф Free' : 'Free Plan'}
                </th>
                <th className="p-4 text-left font-semibold text-text min-w-[150px]">
                  {language === 'ru' ? 'Тариф Plus' : 'Plus Plan'}
                </th>
                <th className="p-4 text-left font-semibold text-accent min-w-[180px]">
                  {language === 'ru' ? 'Тариф Pro' : 'Pro Plan'}
                </th>
                <th className="p-4 text-left font-semibold text-text min-w-[180px]">
                  {language === 'ru' ? 'Тариф Ultra' : 'Ultra Plan'}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stroke/60">
              {COMPARISON_ROWS.map((row, idx) => (
                <tr
                  key={idx}
                  className="transition-colors hover:bg-surface-2/40"
                >
                  <td className="sticky left-0 bg-surface p-4 font-medium text-text z-10 border-r border-stroke">
                    {row.feature[language]}
                  </td>
                  <td className="p-4 text-muted text-xs">
                    {row.free[language]}
                  </td>
                  <td className="p-4 text-muted text-xs">
                    {row.plus[language]}
                  </td>
                  <td className="p-4 text-text text-xs font-medium">
                    {row.pro[language]}
                  </td>
                  <td className="p-4 text-text text-xs font-medium">
                    {row.ultra[language]}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Нижняя сноска */}
      <div className="flex flex-col items-center gap-3 text-center text-xs text-muted pt-4 border-t border-stroke">
        <p>{t('pricing.notice')}</p>
        <Link
          to="/docs"
          className="inline-flex items-center gap-1.5 text-accent font-medium hover:underline transition-colors font-mono uppercase tracking-wider text-[11px]"
        >
          <span>{t('pricing.docsLink')}</span>
          <ArrowRightIcon className="size-3" />
        </Link>
      </div>
    </div>
  );
}
