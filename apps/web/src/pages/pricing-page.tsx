import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PlanCards } from '@/components/pricing/plan-cards';
import { PremiumPacks } from '@/components/pricing/premium-packs';
import { Tab, TabList, TabPanel, Tabs } from '@/components/ui/tabs';
import type { TranslationKey } from '@/i18n';
import { useTranslation } from '@/i18n';
import { cn } from '@/lib/cn';
import planFacts from '@/features/billing/plan-facts.json';

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

type Localized = { ru: string; en: string };

const same = (text: string): Localized => ({ ru: text, en: text });

const formatNumber = (value: number, language: 'ru' | 'en') =>
  value.toLocaleString(language === 'ru' ? 'ru-RU' : 'en-US');

/** 150 000 → «150 тыс.», 1 500 000 → «1,5 млн». */
function formatTokens(value: number, language: 'ru' | 'en'): string {
  const millions = value >= 1_000_000;
  const amount = millions ? value / 1_000_000 : value / 1_000;
  const text = amount.toLocaleString(language === 'ru' ? 'ru-RU' : 'en-US', {
    maximumFractionDigits: 1,
  });
  if (language === 'ru') return `${text} ${millions ? 'млн' : 'тыс.'}`;
  return `${text}${millions ? 'M' : 'K'}`;
}

/** Строка сравнения из plan-facts.json: одно правило на все четыре тарифа. */
function factRow(
  feature: Localized,
  cell: (plan: (typeof planFacts.plans)[PlanKey]) => Localized,
): ComparisonRow {
  return {
    feature,
    free: cell(planFacts.plans.free),
    plus: cell(planFacts.plans.plus),
    pro: cell(planFacts.plans.pro),
    ultra: cell(planFacts.plans.ultra),
  };
}

const IMAGE_NAMES: Record<string, string> = {
  'flux-schnell': 'FLUX.1 schnell',
  'flux-2-klein': 'FLUX.2 klein',
  'flux-2-dev': 'FLUX.2 dev',
  'seedream-5-flash': 'Seedream',
  'flux-2-pro': 'FLUX.2 pro',
  'nano-banana-2': 'Nano Banana 2',
};

/**
 * Таблица сравнения — только проверяемые числа (их сверяет с сервером
 * apps/mock-api/src/services/plan-facts.test.ts). Очереди по тарифам нет, поэтому строк
 * «скорость» и «приоритет» тоже нет.
 */
const COMPARISON_ROWS: ComparisonRow[] = [
  factRow({ ru: 'Цена', en: 'Price' }, (plan) =>
    plan.priceUsd === 0
      ? { ru: 'Бесплатно', en: 'Free' }
      : {
          ru: `$${plan.priceUsd} за 30 дней`,
          en: `$${plan.priceUsd} per 30 days`,
        },
  ),
  {
    feature: { ru: 'Модели', en: 'Models' },
    free: {
      ru: 'Бесплатная Nemotron 3 Ultra, запасная — Ketner Mini',
      en: 'Free Nemotron 3 Ultra, Ketner Mini as backup',
    },
    plus: {
      ru: 'Ketner Pro, GPT-6.1 Sol, Claude Haiku 5.5, DeepSeek V4.1 Flash, Gemini 3.7 Flash, GLM-5.3 и др.',
      en: 'Ketner Pro, GPT-6.1 Sol, Claude Haiku 5.5, DeepSeek V4.1 Flash, Gemini 3.7 Flash, GLM-5.3 and more',
    },
    pro: {
      ru: 'Все из Plus + Claude Opus 5.5, Sonnet 5.5, GPT-6 Astra, GPT-5.6 Sol, GPT-5.6 Terra xhigh, Grok 4.7 xhigh',
      en: 'All Plus + Claude Opus 5.5, Sonnet 5.5, GPT-6 Astra, GPT-5.6 Sol, GPT-5.6 Terra xhigh, Grok 4.7 xhigh',
    },
    ultra: { ru: 'Все модели Pro + режим Max', en: 'All Pro models + Max mode' },
  },
  factRow({ ru: 'Сообщений в сутки', en: 'Messages per day' }, (plan) => ({
    ru: formatNumber(plan.messagesPerDay, 'ru'),
    en: formatNumber(plan.messagesPerDay, 'en'),
  })),
  factRow({ ru: 'Частота сообщений', en: 'Message rate' }, (plan) => ({
    ru: `до ${plan.requestsPerMinute} в минуту и ${formatNumber(plan.requestsPerHour, 'ru')} в час`,
    en: `up to ${plan.requestsPerMinute} a minute and ${formatNumber(plan.requestsPerHour, 'en')} an hour`,
  })),
  factRow({ ru: 'Запросов одновременно', en: 'Requests at once' }, (plan) =>
    same(String(plan.concurrency)),
  ),
  factRow({ ru: 'Длина ответа', en: 'Answer length' }, (plan) => ({
    ru: `до ${formatNumber(plan.maxAnswerTokens, 'ru')} токенов`,
    en: `up to ${formatNumber(plan.maxAnswerTokens, 'en')} tokens`,
  })),
  factRow({ ru: 'Токены (вопрос + ответ)', en: 'Tokens (prompt + answer)' }, (plan) => ({
    ru: `${formatTokens(plan.tokensPerHour, 'ru')} в час, ${formatTokens(plan.tokensPerDay, 'ru')} в сутки`,
    en: `${formatTokens(plan.tokensPerHour, 'en')} an hour, ${formatTokens(plan.tokensPerDay, 'en')} a day`,
  })),
  factRow({ ru: 'Картинки в сутки', en: 'Images per day' }, (plan) =>
    same(
      Object.entries(plan.imagesPerDay as Record<string, number>)
        .map(([id, count]) => `${IMAGE_NAMES[id] ?? id}: ${count}`)
        .join(', '),
    ),
  ),
  factRow({ ru: 'Ketner Code', en: 'Ketner Code' }, (plan) => ({
    ru: `${plan.codeRunsPerDay} запусков в сутки, до $${plan.codeRunBudgetUsd} на запуск`,
    en: `${plan.codeRunsPerDay} runs a day, up to $${plan.codeRunBudgetUsd} per run`,
  })),
  factRow({ ru: 'API для редакторов и кода', en: 'API for editors and code' }, (plan) =>
    plan.api ? { ru: 'По API-ключу', en: 'With an API key' } : same('—'),
  ),
  factRow({ ru: 'Продление и отмена', en: 'Renewal and cancellation' }, (plan) =>
    plan.priceUsd === 0
      ? same('—')
      : {
          ru: 'Разовая оплата без автосписаний; автопродление звёздами — только если включить, отключается в любой момент',
          en: 'One-off payment, no automatic charges; Stars auto-renewal only if you turn it on, off any time',
        },
  ),
];

export function PricingPage() {
  const { t, language } = useTranslation();
  const [activeMobilePlan, setActiveMobilePlan] = useState<PlanKey>('pro');

  return (
    <div className="relative mx-auto flex w-full max-w-7xl flex-col gap-14 py-4 text-left md:gap-20 md:py-8">
      {/* Заголовок страницы: крупно слева, пояснение справа — как секции главной */}
      <div className="grid grid-cols-1 gap-5 md:grid-cols-12 md:items-end md:gap-8">
        <h1 className="t-display text-[clamp(2.75rem,5vw+0.5rem,5rem)] text-text md:col-span-7">
          {t('pricing.title')}
        </h1>
        <p className="max-w-[46ch] text-[17px] leading-relaxed text-muted md:col-span-5 md:justify-self-end">
          {t('pricing.subtitle')}
        </p>
      </div>

      {/* 4 Карточки тарифов */}
      <PlanCards variant="full" />

      {/* Пакеты премиум-квоты поверх подписки (только для платных тарифов) */}
      <PremiumPacks />

      {/* Таблица сравнения */}
      <div className="flex w-full flex-col gap-6 text-left">
        <div className="flex flex-col gap-1.5">
          <h2 className="t-title text-text">{t('pricing.compare')}</h2>
          <p className="text-sm text-muted md:text-[15px]">{t('pricing.compareLead')}</p>
        </div>

        {/* Mobile: выбор тарифа и одна карточка со значениями */}
        <Tabs
          value={activeMobilePlan}
          onValueChange={(value) => setActiveMobilePlan(value as PlanKey)}
          className="md:hidden"
        >
          <TabList aria-label={t('pricing.planPicker')} className="w-full rounded-xl">
            {PLAN_KEYS.map((plan) => (
              <Tab key={plan} value={plan} className="flex-1 gap-1.5 px-2">
                <span aria-hidden="true" className={cn('size-1.5 rounded-full', TIER_DOT[plan])} />
                {t(PLAN_NAME_KEYS[plan])}
              </Tab>
            ))}
          </TabList>

          <TabPanel
            value={activeMobilePlan}
            className="mt-4 flex flex-col gap-4 rounded-2xl border border-stroke bg-surface p-5 shadow-sm"
          >
            <div className="flex items-center justify-between border-b border-stroke pb-3">
              <h3 className="flex items-center gap-2 text-lg font-semibold text-text">
                <span
                  aria-hidden="true"
                  className={cn('size-2 rounded-full', TIER_DOT[activeMobilePlan])}
                />
                {t(PLAN_NAME_KEYS[activeMobilePlan])}
              </h3>
              {activeMobilePlan === 'pro' && (
                <span className="rounded-xs bg-brand-gradient px-2 py-0.5 text-xs font-medium text-accent-text">
                  {t('pricing.popular')}
                </span>
              )}
            </div>
            {COMPARISON_ROWS.map((row, idx) => (
              <div
                key={idx}
                className="flex flex-col gap-1 border-b border-stroke/60 pb-3 last:border-b-0 last:pb-0"
              >
                <span className="text-xs font-medium text-subtle">{row.feature[language]}</span>
                <span className="text-sm font-medium text-text">
                  {row[activeMobilePlan][language]}
                </span>
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
                      <span
                        aria-hidden="true"
                        className={cn('size-2 rounded-full', TIER_DOT[plan])}
                      />
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
                  <td className="bg-accent-soft/40 p-4 text-[13px] leading-5 font-medium text-text">
                    {row.pro[language]}
                  </td>
                  <td className="p-4 text-[13px] leading-5 font-medium text-text">
                    {row.ultra[language]}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <LimitsExplained />

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

const pro = planFacts.plans.pro;
const opus = pro.flagship[0];

/**
 * Как работают лимиты — на примерах тарифа Pro. Числа берутся из plan-facts.json, который тест
 * сверяет с сервером.
 */
const LIMIT_EXAMPLES: { title: Localized; text: Localized }[] = [
  {
    title: { ru: 'Сообщения', en: 'Messages' },
    text: {
      ru: `Каждое отправленное сообщение — одно в лимите, на любой модели. На Pro это ${formatNumber(pro.messagesPerDay, 'ru')} за последние 24 часа, не больше ${pro.requestsPerHour} в час. Окна скользящие: сообщение, отправленное вчера в 15:00, перестаёт учитываться сегодня в 15:00.`,
      en: `Every message you send counts as one, on any model. On Pro that is ${formatNumber(pro.messagesPerDay, 'en')} in the last 24 hours, at most ${pro.requestsPerHour} an hour. Windows are rolling: a message sent yesterday at 3 pm stops counting today at 3 pm.`,
    },
  },
  {
    title: { ru: 'Дорогие модели', en: 'Expensive models' },
    text: {
      ru: `У флагманов свой недельный лимит. На Pro можно отправить ${opus.weeklyPool} запрос ${opus.name} за 7 дней, но не больше ${opus.perDay} за сутки: например, 8 в понедельник и ни одного во вторник. Когда лимит исчерпан, отвечает запасная модель (для ${opus.name} — Claude Sonnet 5.5), и под ответом видно, какая модель ответила. Режим Max на Ultra считается за 2 запроса.`,
      en: `Flagships have their own weekly limit. On Pro you can send ${opus.weeklyPool} ${opus.name} requests in 7 days, at most ${opus.perDay} a day: for example, 8 on Monday and none on Tuesday. When the limit runs out, a backup model answers (Claude Sonnet 5.5 for ${opus.name}), and the answer shows which model replied. Max mode on Ultra counts as 2 requests.`,
    },
  },
  {
    title: { ru: 'Квота премиум-моделей', en: 'Premium quota' },
    text: {
      ru: `Запросы к сильным моделям (Claude, GPT-6 Astra, GPT-5.6, Grok и др.) списываются ещё и с общей квоты в долларах по их реальной цене: длинный вопрос стоит дороже короткого. На Pro квота $${pro.premiumQuotaUsd} на 30 дней — ${pro.premiumExamples?.ru ?? ''}. Если пользоваться несколькими моделями, квота кончается раньше, дальше отвечает Ketner Pro. Её можно пополнить пакетом.`,
      en: `Requests to strong models (Claude, GPT-6 Astra, GPT-5.6, Grok and others) also draw on a shared dollar quota at their real price: a long prompt costs more than a short one. On Pro the quota is $${pro.premiumQuotaUsd} per 30 days, ${pro.premiumExamples?.en ?? ''}. Using several models drains it sooner; after that Ketner Pro answers. You can top it up with a pack.`,
    },
  },
  {
    title: { ru: 'Общий расход', en: 'Overall spend' },
    text: {
      ru: `Чтобы один аккаунт не тратил больше, чем стоит подписка, расход на все модели ограничен по себестоимости: на Pro — $${pro.dailyCostCapUsd} в сутки и $${pro.costBudgetUsd} за 30 дней. После 80% бюджета ответы короче и идут на недорогие модели, после 100% — только на самые дешёвые, после 125% запросы не выполняются, пока расход за последние 30 дней не снизится. При обычной переписке до этих границ, как правило, не доходит: они срабатывают при очень активной работе с дорогими моделями или в Ketner Code.`,
      en: `So that one account does not cost more than its subscription, spend on all models is capped at cost: on Pro, $${pro.dailyCostCapUsd} a day and $${pro.costBudgetUsd} per 30 days. Past 80% of the budget answers get shorter and go to cheaper models, past 100% only to the cheapest, and past 125% requests stop until 30-day spend drops. Normal chatting usually stays well below these caps; heavy use of expensive models or Ketner Code can.`,
    },
  },
];

function LimitsExplained() {
  const { language } = useTranslation();
  return (
    <section aria-labelledby="limits-explained" className="flex w-full flex-col gap-6 text-left">
      <div className="flex flex-col gap-1.5">
        <h2 id="limits-explained" className="t-title text-text">
          {language === 'ru' ? 'Как работают лимиты' : 'How limits work'}
        </h2>
        <p className="max-w-[70ch] text-sm text-muted md:text-[15px]">
          {language === 'ru'
            ? 'Когда кончается лимит сильной модели, ответы не прекращаются — дальше отвечает модель попроще. Ниже — как это устроено на примере тарифа Pro; лимиты моделей на каждом тарифе — на странице «Модели».'
            : 'When a strong model hits its limit, answers do not stop: a simpler model takes over. Below is how it works on Pro; per-plan model limits are on the Models page.'}
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {LIMIT_EXAMPLES.map((example) => (
          <div
            key={example.title.en}
            className="flex flex-col gap-2 rounded-2xl border border-stroke bg-surface p-5"
          >
            <h3 className="text-[15px] font-semibold text-text">{example.title[language]}</h3>
            <p className="text-[14px] leading-6 text-muted">{example.text[language]}</p>
          </div>
        ))}
      </div>
      <p className="text-[13px] text-subtle">
        {language === 'ru'
          ? 'Запасные модели и лимиты каждой модели — на странице '
          : 'Backup models and per-model limits are on the '}
        <Link to="/models" className="text-accent hover:underline">
          {language === 'ru' ? '«Модели»' : 'Models page'}
        </Link>
        .
      </p>
    </section>
  );
}
