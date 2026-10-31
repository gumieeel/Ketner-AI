import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { buttonClasses } from '@/components/ui/button-classes';
import { Spinner } from '@/components/ui/spinner';
import {
  DiscoveryApiError,
  fetchPlan,
  retryPlan,
  setPlanStepStatus,
  type PlanRetryQuote,
  type PlanStep,
  type PlanStepStatus,
  type PlanView,
} from '@/features/discovery/api';
import { creditsText, priceText } from '@/features/discovery/format';
import { POLL_MS } from '@/features/discovery/use-analysis';
import { useTranslation, type TranslationKey } from '@/i18n';
import { cn } from '@/lib/cn';
import { siteFeatures } from '@/lib/features';
import { NotFoundPage } from '@/pages/not-found-page';
import { ErrorNotice } from './error-notice';

type Load =
  | { state: 'loading' }
  | { state: 'not_found' }
  | { state: 'error'; error: unknown }
  | { state: 'ready'; plan: PlanView; retry: PlanRetryQuote | null };

const STEP_STATUSES: readonly PlanStepStatus[] = ['todo', 'in_progress', 'done', 'skipped'];

/** План внедрения: шаги с зависимостями, критериями готовности и статусами. */
export function PlanPage() {
  const { analysisId = '', planId = '' } = useParams();
  if (!siteFeatures().discovery) return <NotFoundPage />;
  return <PlanScreen key={planId} analysisId={analysisId} planId={planId} />;
}

function PlanScreen({ analysisId, planId }: { analysisId: string; planId: string }) {
  const translator = useTranslation();
  const { t } = translator;
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const response = await fetchPlan(analysisId, planId);
      if (alive.current) setLoad({ state: 'ready', ...response });
    } catch (error) {
      if (!alive.current) return;
      if (error instanceof DiscoveryApiError && error.status === 404)
        setLoad({ state: 'not_found' });
      else
        setLoad((previous) => (previous.state === 'ready' ? previous : { state: 'error', error }));
    }
  }, [analysisId, planId]);

  useEffect(() => {
    alive.current = true;
    void refresh();
    return () => {
      alive.current = false;
    };
  }, [refresh]);

  const generating = load.state === 'ready' && load.plan.status === 'generating';
  useEffect(() => {
    if (!generating) return;
    const timer = window.setTimeout(() => void refresh(), POLL_MS);
    return () => window.clearTimeout(timer);
  }, [generating, load, refresh]);

  const back = `/analyses/${analysisId}`;
  const title =
    load.state === 'ready'
      ? t('analysis.plan.title', { title: load.plan.opportunityTitle })
      : load.state === 'not_found'
        ? t('analysis.plan.notFound')
        : t('analysis.plan.titleShort');

  return (
    <section
      aria-labelledby="plan-title"
      className="mx-auto flex w-full max-w-[44rem] flex-col px-4 pt-[clamp(2.5rem,8vh,5rem)] pb-20 sm:px-6"
    >
      <Link
        to={back}
        className="mb-3 self-start text-[14px] text-muted underline underline-offset-4 hover:text-text"
      >
        {t('analysis.plan.back')}
      </Link>
      <h1
        id="plan-title"
        className="text-[clamp(1.75rem,1.6vw+1.25rem,2.375rem)] leading-tight font-[480] tracking-[-0.03em] text-balance text-text"
      >
        {title}
      </h1>

      {load.state === 'loading' ? (
        <p className="mt-8 flex items-center gap-2 text-[14px] text-muted">
          <Spinner /> {t('analysis.page.loading')}
        </p>
      ) : null}
      {load.state === 'not_found' ? (
        <p className="t-lead mt-4">{t('analysis.page.notFoundLead')}</p>
      ) : null}
      {load.state === 'error' ? (
        <div className="mt-8">
          <ErrorNotice error={load.error} redirect={back} />
        </div>
      ) : null}

      {load.state === 'ready' && load.plan.status === 'generating' ? (
        <div className="mt-8 rounded-xl border border-stroke px-5 py-4" aria-live="polite">
          <p className="flex items-center gap-2 text-[15px] text-text">
            <Spinner /> {t('analysis.plan.generating')}
          </p>
          <p className="mt-1 text-[13px] text-subtle">{t('analysis.page.keepOpen')}</p>
        </div>
      ) : null}

      {load.state === 'ready' && load.plan.status === 'failed' ? (
        <FailedPlan plan={load.plan} quote={load.retry} onDone={refresh} />
      ) : null}

      {load.state === 'ready' && load.plan.status === 'ready' ? (
        <ReadyPlan
          plan={load.plan}
          onChange={(plan) => setLoad({ state: 'ready', plan, retry: null })}
        />
      ) : null}
      {load.state === 'ready' && load.plan.status !== 'generating' ? (
        <p className="mt-8 text-[13px] text-subtle">
          {[
            t(load.plan.kind === 'brief' ? 'analysis.plan.brief' : 'analysis.plan.full'),
            load.plan.cost.sponsored && load.plan.cost.chargedCredits === 0
              ? t('analysis.plan.free')
              : t('analysis.plan.charged', {
                  amount: creditsText(translator, load.plan.cost.chargedCredits),
                }),
            load.plan.model?.name,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      ) : null}
    </section>
  );
}

function FailedPlan({
  plan,
  quote,
  onDone,
}: {
  plan: PlanView;
  quote: PlanRetryQuote | null;
  onDone: () => Promise<void>;
}) {
  const translator = useTranslation();
  const { t } = translator;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const back = `/analyses/${plan.analysisId}/plans/${plan.id}`;
  return (
    <section className="mt-8 rounded-xl border border-danger/25 bg-danger-soft px-5 py-4">
      <h2 className="text-[16px] font-medium text-text">{t('analysis.plan.failed')}</h2>
      {plan.error?.message ? (
        <p className="mt-1 text-[14px] leading-6 text-text">{plan.error.message}</p>
      ) : null}
      <p className="mt-2 text-[13px] text-muted">
        {quote?.sponsored
          ? t('analysis.failed.retryFree')
          : quote
            ? t('analysis.failed.retryPaid', {
                price: priceText(translator, quote.typicalCredits, quote.maxCredits),
                model: quote.model,
              })
            : null}
      </p>
      {error ? (
        <div className="mt-3">
          <ErrorNotice error={error} redirect={back} />
        </div>
      ) : null}
      <div className="mt-4">
        {quote && !quote.sponsored && quote.loginRequired ? (
          <Link
            to={`/login?redirect=${encodeURIComponent(back)}`}
            className={buttonClasses({ variant: 'primary', size: 'md' })}
          >
            {t('analysis.failed.loginToRetry')}
          </Link>
        ) : (
          <Button
            loading={busy}
            disabled={busy}
            className="max-sm:w-full"
            onClick={() => {
              setBusy(true);
              setError(null);
              retryPlan(plan.analysisId, plan.id, true)
                .then(onDone)
                .catch((caught: unknown) => setError(caught))
                .finally(() => setBusy(false));
            }}
          >
            {t('analysis.failed.retry')}
          </Button>
        )}
      </div>
    </section>
  );
}

function ReadyPlan({ plan, onChange }: { plan: PlanView; onChange: (plan: PlanView) => void }) {
  const { t } = useTranslation();
  const [error, setError] = useState<unknown>(null);
  const counted = plan.steps.filter((step) => step.status !== 'skipped');
  const done = counted.filter((step) => step.status === 'done').length;
  const numberOf = (id: string) => plan.steps.findIndex((step) => step.id === id) + 1;

  const change = (step: PlanStep, status: PlanStepStatus) => {
    setError(null);
    const previous = plan;
    // Сразу на экране; при ошибке — вернуть как было.
    onChange({
      ...plan,
      steps: plan.steps.map((item) => (item.id === step.id ? { ...item, status } : item)),
    });
    setPlanStepStatus(plan.analysisId, plan.id, step.id, status)
      .then(onChange)
      .catch((caught: unknown) => {
        onChange(previous);
        setError(caught);
      });
  };

  return (
    <>
      {plan.summary ? (
        <p className="mt-4 text-[16px] leading-[1.65] text-text">{plan.summary}</p>
      ) : null}
      <div className="mt-6">
        <p className="text-[14px] text-muted" aria-live="polite">
          {t('analysis.plan.progress', { done, total: counted.length })}
        </p>
        <div
          className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-3"
          role="progressbar"
          aria-label={t('analysis.plan.progressLabel')}
          aria-valuemin={0}
          aria-valuemax={counted.length}
          aria-valuenow={done}
        >
          <div
            className="h-full rounded-full bg-accent transition-[width]"
            style={{ width: `${counted.length ? (done / counted.length) * 100 : 0}%` }}
          />
        </div>
      </div>
      {error ? (
        <div className="mt-4">
          <ErrorNotice error={error} redirect={`/analyses/${plan.analysisId}/plans/${plan.id}`} />
        </div>
      ) : null}

      <h2 className="mt-8 text-[18px] font-medium text-text">{t('analysis.plan.steps')}</h2>
      <ol className="mt-3 flex flex-col gap-3">
        {plan.steps.map((step, index) => (
          <StepCard
            key={step.id}
            number={index + 1}
            step={step}
            waitsFor={step.dependsOn
              .filter((id) => plan.steps.find((item) => item.id === id)?.status !== 'done')
              .map(numberOf)}
            dependsOn={step.dependsOn.map(numberOf)}
            onStatus={(status) => change(step, status)}
          />
        ))}
      </ol>

      <Link
        to="/chat"
        state={{
          prompt: t('analysis.chat.planPrompt', {
            title: plan.opportunityTitle,
            steps: plan.steps
              .map(
                (step, index) =>
                  `${index + 1}. ${step.title} — ${t(`analysis.plan.status.${step.status}` as TranslationKey).toLowerCase()}`,
              )
              .join('\n'),
          }),
        }}
        className={buttonClasses({ variant: 'outline', size: 'sm', className: 'mt-6 self-start' })}
      >
        {t('analysis.chat.discussPlan')}
      </Link>

      {plan.successCriteria.length > 0 ? (
        <section className="mt-8">
          <h2 className="text-[18px] font-medium text-text">{t('analysis.report.success')}</h2>
          <ul className="mt-2 list-disc pl-5 text-[15px] leading-6 text-text">
            {plan.successCriteria.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      ) : null}
      {plan.risks.length > 0 ? (
        <section className="mt-8">
          <h2 className="text-[18px] font-medium text-text">{t('analysis.report.risks')}</h2>
          <ul className="mt-2 list-disc pl-5 text-[15px] leading-6 text-text">
            {plan.risks.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

function StepCard({
  number,
  step,
  dependsOn,
  waitsFor,
  onStatus,
}: {
  number: number;
  step: PlanStep;
  dependsOn: number[];
  waitsFor: number[];
  onStatus: (status: PlanStepStatus) => void;
}) {
  const { t } = useTranslation();
  const selectId = useId();
  return (
    <li
      className={cn(
        'rounded-xl border bg-surface px-5 py-4',
        step.status === 'done' ? 'border-success/30' : 'border-stroke',
      )}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <h3
          className={cn(
            'min-w-0 text-[16px] leading-6 font-medium',
            step.status === 'skipped' ? 'text-subtle line-through' : 'text-text',
          )}
        >
          <span className="text-subtle">{number}. </span>
          {step.title}
        </h3>
        <div className="flex shrink-0 flex-col gap-1">
          <label htmlFor={selectId} className="sr-only">
            {t('analysis.plan.stepStatus', { number })}
          </label>
          <select
            id={selectId}
            value={step.status}
            onChange={(event) => onStatus(event.target.value as PlanStepStatus)}
            className="h-11 rounded-full border border-stroke bg-surface-2 px-4 text-[14px] text-text focus:border-stroke-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 md:h-10"
          >
            {STEP_STATUSES.map((status) => (
              <option key={status} value={status}>
                {t(`analysis.plan.status.${status}` as TranslationKey)}
              </option>
            ))}
          </select>
        </div>
      </div>
      {step.description ? (
        <p className="mt-2 text-[15px] leading-6 text-muted">{step.description}</p>
      ) : null}
      <dl className="mt-2 flex flex-col gap-1 text-[14px] leading-6">
        {step.doneWhen ? (
          <div>
            <dt className="inline text-subtle">{t('analysis.plan.doneWhen')}: </dt>
            <dd className="inline text-text">{step.doneWhen}</dd>
          </div>
        ) : null}
        {dependsOn.length > 0 ? (
          <div>
            <dt className="inline text-subtle">{t('analysis.plan.after')}: </dt>
            <dd className="inline text-text">{dependsOn.join(', ')}</dd>
          </div>
        ) : null}
      </dl>
      {waitsFor.length > 0 && step.status === 'in_progress' ? (
        <p className="mt-1 text-[13px] text-warning">
          {t('analysis.plan.waitsFor', { steps: waitsFor.join(', ') })}
        </p>
      ) : null}
    </li>
  );
}
