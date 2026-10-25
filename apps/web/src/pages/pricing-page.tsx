import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PlanCards } from '@/components/pricing/plan-cards';
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

const FREE_MODEL_FALLBACK: Localized = {
  ru: 'Отвечает бесплатная модель, кредиты не тратятся',
  en: 'A free model answers, no credits are spent',
};

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
  factRow({ ru: 'Кредиты', en: 'Credits' }, (plan) => ({
    ru: `${formatNumber(plan.monthlyCredits, 'ru')} каждые 30 дней`,
    en: `${formatNumber(plan.monthlyCredits, 'en')} every 30 days`,
  })),
  factRow({ ru: 'Примерно на', en: 'Roughly enough for' }, (plan) =>
    plan.examples.length === 0
      ? {
          ru: 'Бесплатные модели кредиты не тратят; кредиты уходят на картинки',
          en: 'Free models spend no credits; credits go to images',
        }
      : {
          ru: plan.examples
            .map((item) => `${formatNumber(item.requests, 'ru')} запросов ${item.name}`)
            .join(', '),
          en: plan.examples
            .map((item) => `${formatNumber(item.requests, 'en')} ${item.name} requests`)
            .join(', '),
        },
  ),
  factRow({ ru: 'Бонус за оплату криптой', en: 'Crypto payment bonus' }, (plan) =>
    plan.cryptoBonusCredits > 0
      ? {
          ru: `+${formatNumber(plan.cryptoBonusCredits, 'ru')} кредитов`,
          en: `+${formatNumber(plan.cryptoBonusCredits, 'en')} credits`,
        }
      : same('—'),
  ),
  {
    feature: { ru: 'Когда кредиты кончились', en: 'When credits run out' },
    free: FREE_MODEL_FALLBACK,
    plus: FREE_MODEL_FALLBACK,
    pro: FREE_MODEL_FALLBACK,
    ultra: FREE_MODEL_FALLBACK,
  },
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
    ru: `${plan.codeRunsPerDay} запусков в сутки, до ${formatNumber(Math.round(plan.codeRunBudgetUsd * 1000), 'ru')} кредитов на запуск`,
    en: `${plan.codeRunsPerDay} runs a day, up to ${formatNumber(Math.round(plan.codeRunBudgetUsd * 1000), 'en')} credits per run`,
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

      <CreditsExplained />

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

/** «156 запросов Claude Opus 5.5, 312 запросов Claude Sonnet 5.5 и 2 200 запросов Ketner Pro». */
function proExamples(language: 'ru' | 'en'): string {
  const parts = pro.examples.map((item) =>
    language === 'ru'
      ? `${formatNumber(item.requests, 'ru')} запросов ${item.name}`
      : `${formatNumber(item.requests, 'en')} ${item.name} requests`,
  );
  const last = parts.pop();
  if (parts.length === 0) return last ?? '';
  return `${parts.join(', ')} ${language === 'ru' ? 'или' : 'or'} ${last}`;
}

/**
 * Как работают кредиты. Числа примера берутся из plan-facts.json, который тест сверяет с сервером
 * (apps/mock-api/src/services/plan-facts.test.ts).
 */
const CREDIT_EXPLAINERS: { title: Localized; text: (language: 'ru' | 'en') => string }[] = [
  {
    title: { ru: 'Что такое кредит', en: 'What a credit is' },
    text: (language) =>
      language === 'ru'
        ? 'Кредит — это одна тысячная доллара реальной стоимости запроса: столько с нас берёт поставщик модели. Короткий вопрос к Ketner Mini стоит около 2 кредитов, большой запрос к Claude Opus — десятки. Чем сложнее вопрос и длиннее диалог, тем больше кредитов уйдёт.'
        : 'A credit is a thousandth of a dollar of the real cost of a request: what the model provider charges us. A short question to Ketner Mini costs about 2 credits, a big request to Claude Opus costs tens. The harder the question and the longer the chat, the more credits it takes.',
  },
  {
    title: { ru: 'Примеры на Pro', en: 'Examples on Pro' },
    text: (language) =>
      language === 'ru'
        ? `На Pro ${formatNumber(pro.monthlyCredits, 'ru')} кредитов хватит примерно на ${proExamples('ru')}. Остаток списывается ровно по стоимости каждого запроса, поэтому можно свободно смешивать модели. Цена запроса каждой модели — на странице «Модели».`
        : `On Pro, ${formatNumber(pro.monthlyCredits, 'en')} credits cover about ${proExamples('en')}. Each request is charged at its real cost, so you can mix models freely. The price of each model is on the Models page.`,
  },
  {
    title: { ru: 'Один пул на всё', en: 'One pool for everything' },
    text: (language) =>
      language === 'ru'
        ? 'Чат, сравнение ответов, картинки и Ketner Code тратят одни и те же кредиты. Остаток и цена запроса выбранной модели видны под полем ввода в чате.'
        : 'Chat, answer comparison, images and Ketner Code all spend the same credits. Your balance and the price of the selected model are shown under the chat input.',
  },
  {
    title: { ru: '30 дней и перенос остатка', en: '30 days and carry-over' },
    text: (language) =>
      language === 'ru'
        ? 'Кредиты выдаются на 30 дней оплаченного периода. Что не потратили, переносится ещё на один период, а потом сгорает; первыми тратятся те кредиты, которые сгорают раньше. Дата сгорания видна в чате.'
        : 'Credits are issued for the 30-day paid period. Whatever you do not use carries over for one more period and then expires; credits that expire sooner are spent first. The expiry date is shown in the chat.',
  },
  {
    title: { ru: 'Когда кредиты кончились', en: 'When credits run out' },
    text: (language) =>
      language === 'ru'
        ? 'Работа не прекращается: чат отвечает бесплатная Nemotron 3 Ultra, в Ketner Code — бесплатная North Mini Code, кредиты не тратятся. Картинки — только FLUX.1 schnell, до 5 в сутки. Платные модели вернутся с новыми кредитами. Если кредитов не хватает на выбранную модель, но хватает на другую, отвечает модель подешевле.'
        : 'Work does not stop: free Nemotron 3 Ultra answers in chat and free North Mini Code in Ketner Code, and no credits are spent. Images fall back to FLUX.1 schnell, up to 5 a day. Paid models come back with new credits. If the selected model is too expensive for your balance, a cheaper one answers instead.',
  },
  {
    title: { ru: 'Технические лимиты', en: 'Technical limits' },
    text: (language) =>
      language === 'ru'
        ? `Кроме кредитов есть защита от перегрузки: сообщений в сутки (на Pro — ${formatNumber(pro.messagesPerDay, 'ru')}), не больше ${pro.requestsPerHour} в час, токены и одновременные запросы. Окна скользящие: сообщение, отправленное вчера в 15:00, перестаёт учитываться сегодня в 15:00. При обычной работе до них не доходит.`
        : `Besides credits there is protection against overload: messages per day (${formatNumber(pro.messagesPerDay, 'en')} on Pro), at most ${pro.requestsPerHour} an hour, tokens and concurrent requests. Windows are rolling: a message sent yesterday at 3 pm stops counting today at 3 pm. Normal use does not reach them.`,
  },
];

function CreditsExplained() {
  const { language } = useTranslation();
  return (
    <section aria-labelledby="credits-explained" className="flex w-full flex-col gap-6 text-left">
      <div className="flex flex-col gap-1.5">
        <h2 id="credits-explained" className="t-title text-text">
          {language === 'ru' ? 'Как работают кредиты' : 'How credits work'}
        </h2>
        <p className="max-w-[70ch] text-sm text-muted md:text-[15px]">
          {language === 'ru'
            ? 'Тариф даёт кредиты на 30 дней. Каждый запрос списывает свою настоящую стоимость, и дорогих моделей не надо бояться: вы сами решаете, на что потратить кредиты.'
            : 'Your plan gives you credits for 30 days. Every request is charged its real cost, so you decide what to spend credits on.'}
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {CREDIT_EXPLAINERS.map((item) => (
          <div
            key={item.title.en}
            className="flex flex-col gap-2 rounded-2xl border border-stroke bg-surface p-5"
          >
            <h3 className="text-[15px] font-semibold text-text">{item.title[language]}</h3>
            <p className="text-[14px] leading-6 text-muted">{item.text(language)}</p>
          </div>
        ))}
      </div>
      <p className="text-[13px] text-subtle">
        {language === 'ru'
          ? 'Цена запроса каждой модели — на странице '
          : 'The price of every model is on the '}
        <Link to="/models" className="text-accent hover:underline">
          {language === 'ru' ? '«Модели»' : 'Models page'}
        </Link>
        .
      </p>
    </section>
  );
}
