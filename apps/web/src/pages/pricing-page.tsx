import { Link } from 'react-router-dom';
import { CreditsIcon } from '@/components/icons';
import { PackCards } from '@/components/pricing/pack-cards';
import { AutomationPlan } from '@/components/pricing/automation-plan';
import { PlatformPricing } from '@/components/pricing/platform-pricing';
import { buttonClasses } from '@/components/ui/button-classes';
import { useAuth } from '@/features/auth/auth-store';
import planFacts from '@/features/billing/plan-facts.json';
import { PACKS, PACK_VALID_DAYS, TRIAL } from '@/features/billing/plans';
import { maxCompareModels } from '@/features/chat/compare-policy';
import { useTranslation, type TranslationKey } from '@/i18n';
import { formatCredits, pluralForm } from '@/lib/format-date';
import { siteFeatures } from '@/lib/features';
import { LandingFaq } from '@/pages/landing/faq';

type Localized = { ru: string; en: string };
type Level = (typeof planFacts.levels)[keyof typeof planFacts.levels];

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

const IMAGE_NAMES: Record<string, string> = {
  'flux-schnell': 'FLUX.1 schnell',
  'flux-2-klein': 'FLUX.2 klein',
  'flux-2-dev': 'FLUX.2 dev',
  'seedream-5-flash': 'Seedream',
  'flux-2-pro': 'FLUX.2 pro',
  'nano-banana-2': 'Nano Banana 2',
};

interface ComparisonRow {
  feature: Localized;
  free: Localized;
  credits: Localized;
}

/** Строка сравнения, считаемая по уровню лимитов из plan-facts.json. */
function levelRow(feature: Localized, cell: (level: Level) => Localized): ComparisonRow {
  return {
    feature,
    free: cell(planFacts.levels.free),
    credits: cell(planFacts.levels.credits),
  };
}

const smallestPack = PACKS[0];
const largestPack = PACKS[PACKS.length - 1];

/**
 * Что меняется после первой покупки. Все модели, режим Max, сравнение и Ketner Code открыты с
 * регистрации, а покупка снимает технические лимиты: числа берутся из plan-facts.json, который
 * сверяет с сервером apps/mock-api/src/services/plan-facts.test.ts.
 */
const COMPARISON_ROWS: ComparisonRow[] = [
  {
    feature: { ru: 'Кредиты', en: 'Credits' },
    free: {
      ru: `${formatNumber(TRIAL.credits, 'ru')} один раз при регистрации, действуют ${TRIAL.days} дней`,
      en: `${formatNumber(TRIAL.credits, 'en')} once at sign-up, valid for ${TRIAL.days} days`,
    },
    credits: {
      ru: `От ${formatNumber(smallestPack.credits, 'ru')} до ${formatNumber(largestPack.credits, 'ru')} кредитов в пакете, действуют ${PACK_VALID_DAYS} дней`,
      en: `${formatNumber(smallestPack.credits, 'en')} to ${formatNumber(largestPack.credits, 'en')} credits per pack, valid for ${PACK_VALID_DAYS} days`,
    },
  },
  {
    feature: { ru: 'Модели и режим Max', en: 'Models and Max mode' },
    free: {
      ru: 'Все модели и режим Max, пока хватает кредитов',
      en: 'All models and Max mode while credits last',
    },
    credits: {
      ru: 'Все модели и режим Max, тратятся только кредиты',
      en: 'All models and Max mode, only credits are spent',
    },
  },
  {
    feature: { ru: 'Сравнение ответов', en: 'Answer comparison' },
    free: {
      ru: `До ${maxCompareModels('free')} моделей`,
      en: `Up to ${maxCompareModels('free')} models`,
    },
    credits: {
      ru: `До ${maxCompareModels('credits')} моделей`,
      en: `Up to ${maxCompareModels('credits')} models`,
    },
  },
  levelRow({ ru: 'Сообщений в сутки', en: 'Messages per day' }, (level) =>
    same(formatNumber(level.messagesPerDay, 'ru')),
  ),
  levelRow({ ru: 'Частота сообщений', en: 'Message rate' }, (level) => ({
    ru: `до ${level.requestsPerMinute} в минуту и ${formatNumber(level.requestsPerHour, 'ru')} в час`,
    en: `up to ${level.requestsPerMinute} a minute and ${formatNumber(level.requestsPerHour, 'en')} an hour`,
  })),
  levelRow({ ru: 'Запросов одновременно', en: 'Requests at once' }, (level) =>
    same(String(level.concurrency)),
  ),
  levelRow({ ru: 'Длина ответа', en: 'Answer length' }, (level) => ({
    ru: `до ${formatNumber(level.maxAnswerTokens, 'ru')} токенов`,
    en: `up to ${formatNumber(level.maxAnswerTokens, 'en')} tokens`,
  })),
  levelRow({ ru: 'Токены (вопрос + ответ)', en: 'Tokens (prompt + answer)' }, (level) => ({
    ru: `${formatTokens(level.tokensPerHour, 'ru')} в час, ${formatTokens(level.tokensPerDay, 'ru')} в сутки`,
    en: `${formatTokens(level.tokensPerHour, 'en')} an hour, ${formatTokens(level.tokensPerDay, 'en')} a day`,
  })),
  levelRow({ ru: 'Картинки в сутки', en: 'Images per day' }, (level) =>
    same(
      Object.entries(level.imagesPerDay as Record<string, number>)
        .map(([id, count]) => `${IMAGE_NAMES[id] ?? id}: ${count}`)
        .join(', '),
    ),
  ),
  levelRow({ ru: 'Ketner Code', en: 'Ketner Code' }, (level) => ({
    ru: `${level.codeRunsPerDay} запусков в сутки, до ${formatNumber(Math.round(level.codeRunBudgetUsd * 1000), 'ru')} кредитов на запуск`,
    en: `${level.codeRunsPerDay} runs a day, up to ${formatNumber(Math.round(level.codeRunBudgetUsd * 1000), 'en')} credits per run`,
  })),
  levelRow({ ru: 'API для редакторов и кода', en: 'API for editors and code' }, (level) =>
    level.api ? { ru: 'По API-ключу', en: 'With an API key' } : same('—'),
  ),
  {
    feature: { ru: 'Когда кредиты кончились', en: 'When credits run out' },
    free: {
      ru: 'Отвечает бесплатная модель, кредиты не тратятся',
      en: 'A free model answers, no credits are spent',
    },
    credits: {
      ru: 'Отвечает бесплатная модель; лимиты возвращаются к бесплатным, пока вы не пополните кредиты',
      en: 'A free model answers; limits go back to the free ones until you top up',
    },
  },
];

export function PricingPage() {
  const { t, language } = useTranslation();

  return (
    <div className="relative mx-auto flex w-full max-w-7xl flex-col gap-14 py-4 text-left md:gap-20 md:py-8">
      {/* Заголовок страницы: крупно слева, пояснение справа — как секции главной */}
      <div className="grid grid-cols-1 gap-5 md:grid-cols-12 md:items-end md:gap-8">
        <h1 className="t-display text-[clamp(2.75rem,5vw+0.5rem,5rem)] text-text md:col-span-7">
          {t('pricing.title')}
        </h1>
        <p className="max-w-[46ch] text-[17px] leading-relaxed text-muted md:col-span-5 md:justify-self-end">
          {t('pricing.subtitle', { days: PACK_VALID_DAYS })}
        </p>
      </div>

      {/* Подписка «Автоматизации» (этап E) — при включённой платформе решений. */}
      {siteFeatures().discovery && siteFeatures().cardPayments ? (
        <AutomationPlan returnPath="/solutions" />
      ) : null}

      <TrialBanner />

      {/* Пакеты кредитов */}
      <section aria-labelledby="packs-title" className="flex w-full flex-col gap-6">
        <div className="flex flex-col gap-1.5">
          <h2 id="packs-title" className="t-title text-text">
            {t('pricing.packsTitle')}
          </h2>
          <p className="max-w-[70ch] text-sm text-muted md:text-[15px]">
            {t('pricing.packsLead', { days: PACK_VALID_DAYS })}
          </p>
        </div>
        <PackCards variant="full" />
      </section>

      {/* Анализ задач, планы и помощники — только при включённой платформе решений. */}
      {siteFeatures().discovery ? <PlatformPricing /> : null}

      {/* Что меняется после первой покупки */}
      <div className="flex w-full flex-col gap-6 text-left">
        <div className="flex flex-col gap-1.5">
          <h2 className="t-title text-text">{t('pricing.compare')}</h2>
          <p className="max-w-[70ch] text-sm text-muted md:text-[15px]">
            {t('pricing.compareLead')}
          </p>
        </div>

        {/* Mobile: каждая строка — отдельная карточка с двумя значениями */}
        <div className="flex flex-col gap-3 md:hidden">
          {COMPARISON_ROWS.map((row) => (
            <div
              key={row.feature.en}
              className="flex flex-col gap-2.5 rounded-xl border border-stroke bg-surface p-4"
            >
              <span className="text-xs font-medium text-subtle">{row.feature[language]}</span>
              <div className="flex flex-col gap-1.5 text-sm">
                <p className="text-muted">
                  <span className="font-medium text-text">{t('pricing.colFree')}: </span>
                  {row.free[language]}
                </p>
                <p className="text-text">
                  <span className="font-medium text-accent">{t('pricing.colCredits')}: </span>
                  {row.credits[language]}
                </p>
              </div>
            </div>
          ))}
        </div>

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
                <th className="min-w-[220px] p-4 text-left font-semibold text-text">
                  {t('pricing.colFree')}
                </th>
                <th className="min-w-[260px] p-4 text-left font-semibold text-accent">
                  {t('pricing.colCredits')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stroke/60">
              {COMPARISON_ROWS.map((row) => (
                <tr key={row.feature.en} className="transition-colors hover:bg-surface-2/40">
                  <td className="sticky left-0 z-10 border-r border-stroke bg-surface p-4 font-medium text-text">
                    {row.feature[language]}
                  </td>
                  <td className="p-4 text-[13px] leading-5 text-muted">{row.free[language]}</td>
                  <td className="bg-accent-soft/40 p-4 text-[13px] leading-5 font-medium text-text">
                    {row.credits[language]}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <CreditsExplained />

      {/* Вопросы и ответы — раздел прежней главной агрегатора. */}
      <LandingFaq />

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

/** Пробные кредиты: каждому новому аккаунту один раз, с примерами «на что хватит». */
function TrialBanner() {
  const { t, language } = useTranslation();
  const user = useAuth((state) => state.user);

  return (
    <section
      aria-labelledby="trial-title"
      data-testid="trial-banner"
      className="grid grid-cols-1 gap-6 rounded-xl bg-surface-2 px-6 py-6 md:grid-cols-[1fr_auto] md:items-center md:px-8"
    >
      <div className="flex flex-col gap-2">
        <h2
          id="trial-title"
          className="flex items-center gap-2.5 text-[20px] font-medium text-text"
        >
          <CreditsIcon className="size-5 shrink-0 text-accent" aria-hidden="true" />
          {t('pricing.trialTitle', { count: formatCredits(TRIAL.credits, language) })}
        </h2>
        <p className="max-w-[70ch] text-[14px] leading-relaxed text-muted">
          {t('pricing.trialText', { days: TRIAL.days })}
        </p>
        <ul className="flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-muted">
          {TRIAL.examples.map((item) => (
            <li key={item.model} className="tabular">
              {t('pricing.creditsExample', {
                requests: t(
                  `pricing.requests.${pluralForm(item.requests, language)}` as TranslationKey,
                  {
                    count: formatCredits(item.requests, language),
                  },
                ),
                model: item.name,
              })}
            </li>
          ))}
        </ul>
      </div>
      <Link
        to={user ? '/chat' : '/signup'}
        className={buttonClasses({ variant: 'outline', className: 'w-full md:w-auto' })}
      >
        {user ? t('landing.cta') : t('pricing.trialCta')}
      </Link>
    </section>
  );
}

const midPack = PACKS.find((pack) => pack.id === 'credits-10') ?? PACKS[0];

/** «940 запросов Ketner Pro, 133 запроса GPT-6.1 Sol или 66 запросов Claude Opus 5.5». */
function packExamples(language: 'ru' | 'en'): string {
  const parts = midPack.examples
    .filter((item) => ['ketner-pro', 'gpt-6.1-sol', 'claude-opus-5.5'].includes(item.model))
    .map((item) =>
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
    title: {
      ru: `Пример: пакет $${midPack.priceUsd}`,
      en: `Example: the $${midPack.priceUsd} pack`,
    },
    text: (language) =>
      language === 'ru'
        ? `${formatNumber(midPack.credits, 'ru')} кредитов хватит примерно на ${packExamples('ru')}. Каждый запрос списывает ровно свою стоимость, поэтому модели можно свободно смешивать. Цена запроса каждой модели — на странице «Модели».`
        : `${formatNumber(midPack.credits, 'en')} credits cover about ${packExamples('en')}. Each request is charged at its real cost, so you can mix models freely. The price of each model is on the Models page.`,
  },
  {
    title: { ru: 'Один пул на всё', en: 'One pool for everything' },
    text: (language) =>
      language === 'ru'
        ? 'Чат, сравнение ответов, картинки и Ketner Code тратят одни и те же кредиты. Остаток и цена запроса выбранной модели видны под полем ввода в чате.'
        : 'Chat, answer comparison, images and Ketner Code all spend the same credits. Your balance and the price of the selected model are shown under the chat input.',
  },
  {
    title: {
      ru: `${PACK_VALID_DAYS} дней без подписки`,
      en: `${PACK_VALID_DAYS} days, no subscription`,
    },
    text: (language) =>
      language === 'ru'
        ? `Пакет оплачивается один раз, автосписаний нет. Кредиты действуют ${PACK_VALID_DAYS} дней; первыми тратятся те, что сгорают раньше. Дата сгорания видна в чате за неделю до срока. Докупить можно в любой момент: новый пакет не отменяет остаток.`
        : `A pack is paid once, with no automatic charges. Credits are valid for ${PACK_VALID_DAYS} days; the ones that expire sooner are spent first. The expiry date shows in the chat a week before. You can top up any time: a new pack does not cancel your balance.`,
  },
  {
    title: { ru: 'Когда кредиты кончились', en: 'When credits run out' },
    text: (language) =>
      language === 'ru'
        ? `Работа не прекращается: в чате отвечает бесплатная Nemotron 3 Ultra, в Ketner Code — бесплатная North Mini Code, кредиты не тратятся. Картинки — только FLUX.1 schnell, до ${planFacts.levels.free.imagesPerDay['flux-schnell']} в сутки. Лимиты возвращаются к бесплатным, пока вы не пополните кредиты. Если кредитов не хватает на выбранную модель, но хватает на другую, отвечает модель подешевле.`
        : `Work does not stop: free Nemotron 3 Ultra answers in chat and free North Mini Code in Ketner Code, and no credits are spent. Images fall back to FLUX.1 schnell, up to ${planFacts.levels.free.imagesPerDay['flux-schnell']} a day. Limits go back to the free ones until you top up. If the selected model is too expensive for your balance, a cheaper one answers instead.`,
  },
  {
    title: { ru: 'Технические лимиты', en: 'Technical limits' },
    text: (language) =>
      language === 'ru'
        ? `Кроме кредитов есть защита от перегрузки: сообщений в сутки (после покупки — ${formatNumber(planFacts.levels.credits.messagesPerDay, 'ru')}), не больше ${planFacts.levels.credits.requestsPerHour} в час, токены и одновременные запросы. Окна скользящие: сообщение, отправленное вчера в 15:00, перестаёт учитываться сегодня в 15:00. При обычной работе до них не доходит.`
        : `Besides credits there is protection against overload: messages per day (${formatNumber(planFacts.levels.credits.messagesPerDay, 'en')} after a purchase), at most ${planFacts.levels.credits.requestsPerHour} an hour, tokens and concurrent requests. Windows are rolling: a message sent yesterday at 3 pm stops counting today at 3 pm. Normal use does not reach them.`,
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
            ? 'Вы покупаете кредиты один раз и сами решаете, на что их потратить. Каждый запрос списывает свою настоящую стоимость, поэтому дорогих моделей не надо бояться.'
            : 'You buy credits once and decide what to spend them on. Every request is charged its real cost, so there is nothing to fear in expensive models.'}
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
        <Link
          to="/models"
          className="text-accent underline decoration-accent/40 underline-offset-4 hover:decoration-accent"
        >
          {language === 'ru' ? '«Модели»' : 'Models page'}
        </Link>
        .
      </p>
    </section>
  );
}
