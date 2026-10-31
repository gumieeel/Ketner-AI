import { Link } from 'react-router-dom';
import planFacts from '@/features/billing/plan-facts.json';
import { priceText } from '@/features/discovery/format';
import { useTranslation, type TranslationKey } from '@/i18n';
import { formatCredits } from '@/lib/format-date';

const { limits, prices } = planFacts.platform;

/**
 * Анализ задач, планы и помощники на странице «Кредиты». Числа — из plan-facts.json, раздел
 * platform; тест services/plan-facts.test.ts сверяет его с services/discovery-limits.ts и ценами.
 */
export function PlatformPricing() {
  const translator = useTranslation();
  const { t, language } = translator;
  const rows: Array<{
    title: TranslationKey;
    price: { model: string; typicalCredits: number; maxCredits: number };
  }> = [
    { title: 'platformPricing.analysisPaid', price: prices.analysisPaid },
    { title: 'platformPricing.analysisDeep', price: prices.analysisDeep },
    { title: 'platformPricing.planPaid', price: prices.planPaid },
    { title: 'platformPricing.planDeep', price: prices.planDeep },
    { title: 'platformPricing.assistantDraft', price: prices.assistantDraft },
  ];
  const number = (value: number) => formatCredits(value, language);

  return (
    <section aria-labelledby="platform-pricing" className="flex w-full flex-col gap-6 text-left">
      <div className="flex flex-col gap-1.5">
        <h2 id="platform-pricing" className="t-title text-text">
          {t('platformPricing.title')}
        </h2>
        <p className="max-w-[70ch] text-sm text-muted md:text-[15px]">
          {t('platformPricing.lead')}
        </p>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <div className="flex flex-col gap-3 rounded-2xl border border-accent/30 bg-accent-soft/40 p-5">
          <h3 className="text-[15px] font-semibold text-text">{t('platformPricing.freeTitle')}</h3>
          <ul className="flex flex-col gap-2 text-[14px] leading-6 text-text">
            <li>
              {t('platformPricing.freeAnalysis', {
                count: limits.analyses.freePerDay,
                model: prices.freeModel,
              })}
            </li>
            <li>{t('platformPricing.freePlan', { steps: limits.plans.briefSteps })}</li>
            <li>{t('platformPricing.freeGuest')}</li>
          </ul>
          <p className="text-[13px] leading-5 text-muted">{t('platformPricing.freeNote')}</p>
          <Link
            to="/"
            className="self-start text-[14px] font-medium text-accent underline underline-offset-4"
          >
            {t('platformPricing.start')}
          </Link>
        </div>

        <div className="rounded-2xl border border-stroke bg-surface p-5">
          <h3 className="text-[15px] font-semibold text-text">{t('platformPricing.paidTitle')}</h3>
          <dl className="mt-3 divide-y divide-stroke/70">
            {rows.map((row) => (
              <div
                key={row.title}
                className="flex flex-col gap-0.5 py-2.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4"
              >
                <dt className="text-[14px] text-text">
                  {t(row.title)} <span className="text-subtle">· {row.price.model}</span>
                </dt>
                <dd className="shrink-0 text-[14px] font-medium text-text">
                  {priceText(translator, row.price.typicalCredits, row.price.maxCredits)}
                </dd>
              </div>
            ))}
            <div className="flex flex-col gap-0.5 py-2.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
              <dt className="text-[14px] text-text">{t('platformPricing.assistantTests')}</dt>
              <dd className="text-[14px] text-muted sm:text-right">
                {t('platformPricing.assistantTestsPrice')}
              </dd>
            </div>
            <div className="flex flex-col gap-0.5 py-2.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
              <dt className="text-[14px] text-text">{t('platformPricing.assistantChat')}</dt>
              <dd className="text-[14px] text-muted sm:text-right">
                {t('platformPricing.assistantChatPrice')}
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-[13px] leading-5 text-subtle">{t('platformPricing.paidNote')}</p>
        </div>
      </div>

      <div className="rounded-2xl border border-stroke bg-surface p-5">
        <h3 className="text-[15px] font-semibold text-text">{t('platformPricing.limitsTitle')}</h3>
        <ul className="mt-3 grid gap-x-6 gap-y-2 text-[14px] leading-6 text-muted sm:grid-cols-2">
          <li>{t('platformPricing.limitAnalyses', { count: number(limits.analyses.perDay) })}</li>
          <li>
            {t('platformPricing.limitIp', {
              count: number(limits.analyses.freePerIpPerDay),
              days: limits.analyses.youngAccountDays,
            })}
          </li>
          <li>{t('platformPricing.limitText', { count: number(limits.analyses.textChars) })}</li>
          <li>
            {t('platformPricing.limitPlans', {
              brief: limits.plans.briefSteps,
              full: limits.plans.fullSteps,
            })}
          </li>
          <li>
            {t('platformPricing.limitAssistants', { count: number(limits.assistants.perUser) })}
          </li>
          <li>{t('platformPricing.limitCases', { count: number(limits.assistants.testCases) })}</li>
          <li>
            {t('platformPricing.limitKnowledge', {
              count: number(limits.assistants.knowledgeChars),
            })}
          </li>
        </ul>
      </div>
    </section>
  );
}
