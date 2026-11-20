import { Link } from 'react-router-dom';
import { buttonClasses } from '@/components/ui/button-classes';
import {
  EXTERNAL_SERVICES_LIVE,
  TIERS,
  TIER_GRACE_RATE,
  TIER_WARN_RATE,
} from '@/features/billing/tiers';
import { useTranslation, type TranslationKey } from '@/i18n';
import { pluralForm } from '@/lib/format-date';

/**
 * «Тарифы»: бесплатно — анализ, создание и проверка; платно — тариф на аккаунт за работающие решения
 * (docs/SUBSCRIPTION_PRICING_DESIGN.md). Названия, цены и объёмы — из plan-facts.json, который
 * сверяет с services/tiers.ts тест apps/mock-api/src/services/plan-facts.test.ts.
 */

const percent = (rate: number) => Math.round(rate * 100);

/** Куда писать, чтобы подключить тариф, пока оплаты тарифа на сайте нет. */
const CONNECT_PATH = '/contacts?topic=payment';

export function PricingPage() {
  const { t } = useTranslation();
  return (
    <div className="relative mx-auto flex w-full max-w-7xl flex-col gap-14 py-4 text-left md:gap-20 md:py-8">
      <div className="grid grid-cols-1 gap-5 md:grid-cols-12 md:items-end md:gap-8">
        <h1 className="t-display text-[clamp(2.75rem,5vw+0.5rem,5rem)] text-text md:col-span-7">
          {t('pricing.title')}
        </h1>
        <p className="max-w-[46ch] text-[17px] leading-relaxed text-muted md:col-span-5 md:justify-self-end">
          {t('pricing.subtitle')}
        </p>
      </div>

      <FreeSection />
      <TiersSection />
      <RulesSection />

      <section aria-labelledby="team-title" className="flex w-full flex-col gap-3">
        <h2 id="team-title" className="t-title text-text">
          {t('pricing.teamTitle')}
        </h2>
        <p className="max-w-[70ch] text-[15px] leading-7 text-muted">{t('pricing.teamText')}</p>
      </section>

      <div className="flex flex-col items-center gap-3 border-t border-stroke pt-8 text-center text-[13px] text-muted">
        <p className="max-w-[70ch] text-balance">{t('pricing.notice')}</p>
      </div>
    </div>
  );
}

function FreeSection() {
  const { t } = useTranslation();
  const items: TranslationKey[] = [
    'pricing.free.analysis',
    'pricing.free.build',
    'pricing.free.report',
  ];
  return (
    <section aria-labelledby="free-title" className="flex w-full flex-col gap-4">
      <h2 id="free-title" className="t-title text-text">
        {t('pricing.freeTitle')}
      </h2>
      <ul className="grid gap-3 md:grid-cols-3">
        {items.map((key) => (
          <li
            key={key}
            className="rounded-2xl border border-stroke bg-surface p-5 text-[15px] leading-6 text-text"
          >
            {t(key)}
          </li>
        ))}
      </ul>
      <div>
        <Link to="/" className={buttonClasses({ variant: 'primary', size: 'md' })}>
          {t('pricing.freeCta')}
        </Link>
      </div>
    </section>
  );
}

function TiersSection() {
  const { t, language } = useTranslation();
  const number = (value: number) => value.toLocaleString(language === 'ru' ? 'ru-RU' : 'en-US');
  return (
    <section aria-labelledby="tiers-title" className="flex w-full flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <h2 id="tiers-title" className="t-title text-text">
          {t('pricing.tiersTitle')}
        </h2>
        <p className="max-w-[70ch] text-sm text-muted md:text-[15px]">{t('pricing.tiersLead')}</p>
      </div>
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {TIERS.map((tier) => (
          <li
            key={tier.id}
            data-testid={`tier-${tier.id}`}
            className="flex flex-col gap-4 rounded-2xl border border-stroke bg-surface p-5"
          >
            <div className="flex flex-col gap-1">
              <h3 className="text-[17px] font-semibold text-text">{tier.name}</h3>
              <p className="text-text">
                <span className="text-[28px] font-semibold tracking-tight tabular-nums">
                  ${tier.priceUsd}
                </span>{' '}
                <span className="text-sm text-muted">{t('pricing.perMonth')}</span>
              </p>
            </div>
            <ul className="flex flex-col gap-1.5 text-[14px] leading-6 text-muted">
              <li>
                {t(
                  `pricing.tier.solutions.${pluralForm(tier.activeSolutions, language)}` as TranslationKey,
                  {
                    count: number(tier.activeSolutions),
                  },
                )}
              </li>
              <li>{t('pricing.tier.requests', { count: number(tier.monthlyRequests) })}</li>
              <li>
                {tier.externalServices === 0
                  ? t('pricing.tier.noServices')
                  : EXTERNAL_SERVICES_LIVE
                    ? t(
                        `pricing.tier.services.${pluralForm(tier.externalServices, language)}` as TranslationKey,
                        { count: number(tier.externalServices) },
                      )
                    : t('pricing.tier.servicesLater', { count: number(tier.externalServices) })}
              </li>
              <li>
                {tier.integrationHelp.kind === 'widget_install'
                  ? t('pricing.tier.helpWidget')
                  : t('pricing.tier.helpHours', { hours: tier.integrationHelp.hoursPerMonth })}
              </li>
            </ul>
          </li>
        ))}
      </ul>
      <div className="flex flex-col gap-3 rounded-2xl border border-stroke bg-surface-2/60 p-5 md:flex-row md:items-center md:justify-between">
        <p className="max-w-[70ch] text-[15px] leading-6 text-text">{t('pricing.tierHow')}</p>
        <Link
          to={CONNECT_PATH}
          className={buttonClasses({ variant: 'outline', size: 'md', className: 'shrink-0' })}
        >
          {t('pricing.tierCta')}
        </Link>
      </div>
    </section>
  );
}

function RulesSection() {
  const { t } = useTranslation();
  const rules = [
    t('pricing.rules.warn', { percent: percent(TIER_WARN_RATE) }),
    t('pricing.rules.grace', { percent: percent(TIER_GRACE_RATE) }),
    t('pricing.rules.leads'),
    t('pricing.rules.consent'),
  ];
  const terms: Array<[TranslationKey, TranslationKey]> = [
    ['pricing.terms.solution', 'pricing.terms.solutionText'],
    ['pricing.terms.request', 'pricing.terms.requestText'],
    [
      'pricing.terms.service',
      EXTERNAL_SERVICES_LIVE ? 'pricing.terms.serviceText' : 'pricing.terms.serviceTextLater',
    ],
  ];
  return (
    <div className="grid gap-10 md:grid-cols-2">
      <section aria-labelledby="rules-title" className="flex flex-col gap-3">
        <h2 id="rules-title" className="t-title text-text">
          {t('pricing.rulesTitle')}
        </h2>
        <ul className="flex list-disc flex-col gap-2 pl-5 text-[15px] leading-7 text-muted marker:text-subtle">
          {rules.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="terms-title" className="flex flex-col gap-3">
        <h2 id="terms-title" className="t-title text-text">
          {t('pricing.termsTitle')}
        </h2>
        <dl className="flex flex-col gap-3 text-[15px] leading-7">
          {terms.map(([term, text]) => (
            <div key={term}>
              <dt className="font-medium text-text">{t(term)}</dt>
              <dd className="text-muted">{t(text)}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
