import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { buttonClasses } from '@/components/ui/button-classes';
import { ArrowLeftIcon, CheckIcon, ClockIcon, CreditsIcon } from '@/components/icons';
import { Spinner } from '@/components/ui/spinner';
import {
  continueAnalysis,
  retryAnalysis,
  sameAnswers,
  type AnalysisView,
  type RerunQuote,
  type RetryQuote,
} from '@/features/discovery/api';
import { creditsText, priceText } from '@/features/discovery/format';
import { useAnalysis } from '@/features/discovery/use-analysis';
import { useTranslation, type TranslationKey } from '@/i18n';
import { cn } from '@/lib/cn';
import { siteFeatures } from '@/lib/features';
import { NotFoundPage } from '@/pages/not-found-page';
import { DiscoveryConversation } from './discovery-conversation';
import { ErrorNotice } from './error-notice';
import { QuestionsForm } from './questions-form';
import { Report } from './report';

/** Страница анализа: ход этапов, уточняющие вопросы, результат, правка ответов. */
export function AnalysisPage() {
  const { analysisId = '' } = useParams();
  if (!siteFeatures().discovery) return <NotFoundPage />;
  return <AnalysisScreen key={analysisId} id={analysisId} />;
}

function AnalysisScreen({ id }: { id: string }) {
  const { t } = useTranslation();
  const { load, refresh } = useAnalysis(id);

  if (load.state === 'loading') {
    return (
      <Shell>
        <p className="mt-8 flex items-center gap-2 text-[14px] text-muted">
          <Spinner /> {t('analysis.page.loading')}
        </p>
      </Shell>
    );
  }
  if (load.state === 'not_found') {
    return (
      <Shell title={t('analysis.page.notFoundTitle')}>
        <p className="t-lead mt-4">{t('analysis.page.notFoundLead')}</p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Link to="/" className={buttonClasses({ variant: 'primary', size: 'md' })}>
            {t('analysis.page.newAnalysis')}
          </Link>
          <Link
            to={`/login?redirect=${encodeURIComponent(`/analyses/${id}`)}`}
            className={buttonClasses({ variant: 'outline', size: 'md' })}
          >
            {t('analysis.error.login')}
          </Link>
        </div>
      </Shell>
    );
  }
  if (load.state === 'error') {
    return (
      <Shell>
        <div className="mt-8">
          <ErrorNotice error={load.error} redirect={`/analyses/${id}`} />
        </div>
      </Shell>
    );
  }

  const { analysis } = load;

  // Готовый анализ — отдельный экран результата: шире, с колонкой действий справа.
  if (analysis.status === 'ready') {
    return (
      <section
        aria-labelledby="analysis-title"
        className="mx-auto flex w-full max-w-[76rem] flex-col px-4 pt-[clamp(1.5rem,5vh,3rem)] pb-20 sm:px-6"
      >
        <Link
          to="/analyses"
          className="mb-5 inline-flex min-h-11 items-center gap-1.5 self-start text-[14px] text-accent hover:underline md:min-h-0"
        >
          <ArrowLeftIcon className="size-4" />
          {t('analysis.result.back')}
        </Link>
        <ResultHeader analysis={analysis} />
        <Report analysis={analysis} plans={load.plans} onChanged={refresh}>
          <details className="rounded-xl border border-stroke bg-surface px-5 py-3">
            <summary className="cursor-pointer text-[14px] font-medium text-muted hover:text-text">
              {t('analysis.page.yourTask')}
              {analysis.context?.domain ? (
                <span className="font-normal text-subtle"> · {analysis.context.domain}</span>
              ) : null}
            </summary>
            <p className="mt-2 text-[15px] leading-[1.6] break-words whitespace-pre-wrap text-text">
              {analysis.inputText}
            </p>
          </details>
          <ModelsNote analysis={analysis} />
          {analysis.questions.length > 0 ? (
            <AnswersSection analysis={analysis} quote={load.rerun} onDone={refresh} />
          ) : null}
        </Report>
      </section>
    );
  }

  return (
    <Shell>
      <details className="mt-6 rounded-xl border border-stroke bg-surface px-5 py-3">
        <summary className="cursor-pointer text-[14px] font-medium text-muted hover:text-text">
          {t('analysis.page.yourTask')}
          {analysis.context?.domain ? (
            <span className="font-normal text-subtle"> · {analysis.context.domain}</span>
          ) : null}
        </summary>
        <p className="mt-2 text-[15px] leading-[1.6] break-words whitespace-pre-wrap text-text">
          {analysis.inputText}
        </p>
      </details>

      <ProgressSteps analysis={analysis} />

      {analysis.status === 'analyzing' || analysis.status === 'discovering' ? (
        <div className="mt-8 rounded-xl border border-stroke px-5 py-4" aria-live="polite">
          <p className="flex items-center gap-2 text-[15px] text-text">
            <Spinner />
            {t(
              analysis.status === 'analyzing'
                ? 'analysis.page.analyzing'
                : 'analysis.page.discovering',
            )}
          </p>
          <p className="mt-1 text-[13px] text-subtle">{t('analysis.page.keepOpen')}</p>
        </div>
      ) : null}

      {analysis.status === 'needs_answers' ? (
        <DiscoveryConversation analysis={analysis} onDone={refresh} />
      ) : null}

      {analysis.status === 'failed' ? (
        <FailedStage analysis={analysis} quote={load.retry} onDone={refresh} />
      ) : null}
    </Shell>
  );
}

/** Сколько длились этапы анализа (без времени, пока человек отвечал на вопросы), мс. */
function analysisDurationMs(analysis: AnalysisView): number | null {
  let total = 0;
  for (const stage of [analysis.stages.context, analysis.stages.discovery]) {
    if (!stage?.startedAt || !stage.finishedAt) return null;
    const ms = Date.parse(stage.finishedAt) - Date.parse(stage.startedAt);
    if (!Number.isFinite(ms) || ms < 0) return null;
    total += ms;
  }
  return total;
}

/** Заголовок готового анализа: итог и карточка «Потрачено» / «Время анализа». */
function ResultHeader({ analysis }: { analysis: AnalysisView }) {
  const translator = useTranslation();
  const { t } = translator;
  const duration = analysisDurationMs(analysis);
  const free = analysis.cost.sponsored && analysis.cost.chargedCredits === 0;
  const seconds = duration === null ? 0 : Math.max(1, Math.round(duration / 1000));

  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
      <div className="flex gap-5">
        <span
          aria-hidden="true"
          className="flex size-14 shrink-0 items-center justify-center rounded-full bg-accent text-canvas sm:size-[4.5rem]"
        >
          <CheckIcon className="size-7 sm:size-9" />
        </span>
        <div className="min-w-0">
          <h1
            id="analysis-title"
            className="text-[clamp(1.75rem,1.6vw+1.25rem,2.375rem)] leading-tight font-[480] tracking-[-0.03em] text-text"
          >
            {t('analysis.result.title')}
          </h1>
          <p className="mt-2 max-w-[36rem] text-[16px] leading-6 text-muted">
            {t('analysis.result.lead', { count: analysis.opportunities.length })}
          </p>
        </div>
      </div>

      <dl className="grid shrink-0 grid-cols-2 divide-x divide-stroke rounded-2xl border border-stroke bg-surface px-1 py-4 lg:min-w-[30rem]">
        <div className="flex gap-3 px-4">
          <CreditsIcon aria-hidden="true" className="mt-0.5 size-6 shrink-0 text-muted" />
          <div>
            <dt className="text-[13px] text-subtle">{t('analysis.result.spent')}</dt>
            <dd className="mt-1 text-[20px] font-medium text-text">
              {free
                ? t('analysis.result.free')
                : `≈ ${creditsText(translator, analysis.cost.chargedCredits)}`}
            </dd>
            <dd className="mt-1 text-[12px] leading-4 text-subtle">
              {free ? t('analysis.result.freeNote') : t('analysis.result.spentNote')}
            </dd>
          </div>
        </div>
        <div className="flex gap-3 px-4">
          <ClockIcon aria-hidden="true" className="mt-0.5 size-6 shrink-0 text-muted" />
          <div>
            <dt className="text-[13px] text-subtle">{t('analysis.result.duration')}</dt>
            <dd className="mt-1 text-[20px] font-medium text-text">
              {duration === null
                ? '—'
                : seconds >= 60
                  ? t('analysis.result.minSec', {
                      min: Math.floor(seconds / 60),
                      sec: seconds % 60,
                    })
                  : t('analysis.result.sec', { sec: seconds })}
            </dd>
          </div>
        </div>
      </dl>
    </div>
  );
}

type StepState = 'done' | 'running' | 'waiting' | 'failed' | 'pending' | 'notNeeded';

function stepStates(analysis: AnalysisView): Array<{ key: string; state: StepState }> {
  const context = analysis.stages.context?.status ?? 'pending';
  const discovery = analysis.stages.discovery?.status ?? 'pending';
  const contextState: StepState =
    context === 'done' ? 'done' : context === 'failed' ? 'failed' : 'running';
  const questionsState: StepState =
    context !== 'done'
      ? 'pending'
      : analysis.questions.length === 0
        ? 'notNeeded'
        : analysis.status === 'needs_answers'
          ? 'waiting'
          : 'done';
  const discoveryState: StepState =
    discovery === 'done' && analysis.status === 'ready'
      ? 'done'
      : discovery === 'failed'
        ? 'failed'
        : analysis.status === 'discovering'
          ? 'running'
          : 'pending';
  return [
    { key: 'context', state: contextState },
    { key: 'questions', state: questionsState },
    { key: 'discovery', state: discoveryState },
  ];
}

/** Названия моделей этапов — в «Подробнее»: человеку без интереса к моделям они не нужны. */
function ModelsNote({ analysis }: { analysis: AnalysisView }) {
  const { t } = useTranslation();
  const models = (['context', 'discovery'] as const).flatMap((key) => {
    const name = analysis.stages[key]?.model?.name;
    return name ? [`${t(`analysis.steps.${key}` as TranslationKey)} — ${name}`] : [];
  });
  if (models.length === 0) return null;
  return (
    <details className="mt-2 text-[13px] text-subtle">
      <summary className="inline-flex min-h-11 cursor-pointer items-center underline underline-offset-4 hover:text-text md:min-h-0">
        {t('analysis.steps.details')}
      </summary>
      <p className="mt-1">{t('analysis.steps.models', { list: models.join('; ') })}</p>
    </details>
  );
}

function ProgressSteps({ analysis }: { analysis: AnalysisView }) {
  const { t } = useTranslation();
  return (
    <>
      <ol
        aria-label={t('analysis.steps.label')}
        className="mt-8 grid gap-2 sm:grid-cols-3 sm:gap-3"
      >
        {stepStates(analysis).map(({ key, state }, index) => (
          <li
            key={key}
            aria-current={state === 'running' || state === 'waiting' ? 'step' : undefined}
            className={cn(
              'flex items-center gap-3 rounded-xl border px-4 py-3 sm:flex-col sm:items-start sm:gap-1',
              state === 'running' || state === 'waiting'
                ? 'border-accent/40 bg-accent-soft/40'
                : state === 'failed'
                  ? 'border-danger/30'
                  : 'border-stroke',
            )}
          >
            <span className="text-[14px] font-medium text-text">
              <span className="text-subtle">{index + 1}. </span>
              {t(`analysis.steps.${key}` as TranslationKey)}
            </span>
            <span
              className={cn(
                'ml-auto text-[13px] sm:ml-0',
                state === 'failed' ? 'text-danger' : 'text-subtle',
              )}
            >
              {t(`analysis.steps.${state}` as TranslationKey)}
            </span>
          </li>
        ))}
      </ol>
      <ModelsNote analysis={analysis} />
    </>
  );
}

function FailedStage({
  analysis,
  quote,
  onDone,
}: {
  analysis: AnalysisView;
  quote: RetryQuote | null;
  onDone: () => Promise<void>;
}) {
  const translator = useTranslation();
  const { t } = translator;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const stage =
    quote?.stage ?? (analysis.stages.context?.status === 'failed' ? 'context' : 'discovery');
  const run = analysis.stages[stage];

  return (
    <section
      aria-labelledby="failed-title"
      className="mt-8 rounded-xl border border-danger/25 bg-danger-soft px-5 py-4"
    >
      <h2 id="failed-title" className="text-[16px] font-medium text-text">
        {t('analysis.failed.title', { stage: t(`analysis.steps.${stage}` as TranslationKey) })}
      </h2>
      {run?.error?.message ? (
        <p className="mt-1 text-[14px] leading-6 text-text">{run.error.message}</p>
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
          <ErrorNotice error={error} redirect={`/analyses/${analysis.id}`} />
        </div>
      ) : null}
      <div className="mt-4">
        {quote && !quote.sponsored && quote.loginRequired ? (
          <Link
            to={`/login?redirect=${encodeURIComponent(`/analyses/${analysis.id}`)}`}
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
              // Цена повтора показана рядом с кнопкой: нажатие — согласие.
              retryAnalysis(analysis.id, true)
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

function AnswersSection({
  analysis,
  quote,
  onDone,
}: {
  analysis: AnalysisView;
  quote: RerunQuote | null;
  onDone: () => Promise<void>;
}) {
  const translator = useTranslation();
  const { t } = translator;
  const [editing, setEditing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const loginHref = `/login?redirect=${encodeURIComponent(`/analyses/${analysis.id}`)}`;

  return (
    <section aria-labelledby="answers-title" className="mt-10 border-t border-stroke pt-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="answers-title" className="text-[18px] font-medium text-text">
          {t('analysis.answers.title')}
        </h2>
        {!editing ? (
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
            {t('analysis.answers.edit')}
          </Button>
        ) : null}
      </div>

      {!editing ? (
        <dl className="mt-4 flex flex-col gap-3">
          {analysis.questions.map((question) => {
            const answer = analysis.answers[question.id];
            return (
              <div key={question.id}>
                <dt className="text-[14px] text-subtle">{question.text}</dt>
                <dd className="text-[15px] leading-6 break-words whitespace-pre-wrap text-text">
                  {answer && 'value' in answer ? answer.value : t('analysis.answers.skipped')}
                </dd>
              </div>
            );
          })}
        </dl>
      ) : (
        <div className="mt-5">
          <QuestionsForm
            questions={analysis.questions}
            initial={analysis.answers}
            submitLabel={t('analysis.answers.rerun')}
            submitting={submitting}
            submitDisabled={(answers) => sameAnswers(answers, analysis.answers)}
            onSubmit={(answers) => {
              setSubmitting(true);
              setError(null);
              // Цена показана над кнопкой: нажатие — согласие на списание.
              continueAnalysis(analysis.id, answers, true)
                .then(async () => {
                  setEditing(false);
                  await onDone();
                })
                .catch((caught: unknown) => setError(caught))
                .finally(() => setSubmitting(false));
            }}
            footer={(answers) => (
              <>
                {sameAnswers(answers, analysis.answers) ? (
                  <p className="text-[13px] text-subtle" aria-live="polite">
                    {t('analysis.answers.unchanged')}
                  </p>
                ) : quote ? (
                  <p className="text-[14px] leading-6 text-muted" aria-live="polite">
                    {t('analysis.answers.rerunPrice', {
                      price: priceText(translator, quote.typicalCredits, quote.maxCredits),
                      model: quote.model,
                    })}
                  </p>
                ) : null}
                {error ? <ErrorNotice error={error} redirect={`/analyses/${analysis.id}`} /> : null}
              </>
            )}
            action={
              quote?.loginRequired ? (
                <Link to={loginHref} className={buttonClasses({ variant: 'primary', size: 'md' })}>
                  {t('analysis.answers.loginToRerun')}
                </Link>
              ) : undefined
            }
            secondary={
              <Button
                variant="ghost"
                onClick={() => {
                  setEditing(false);
                  setError(null);
                }}
              >
                {t('analysis.answers.cancel')}
              </Button>
            }
          />
        </div>
      )}
    </section>
  );
}

function Shell({ title, children }: { title?: string; children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <section
      aria-labelledby="analysis-title"
      className="mx-auto flex w-full max-w-[44rem] flex-col px-4 pt-[clamp(2.5rem,8vh,5rem)] pb-20 sm:px-6"
    >
      <Link
        to="/analyses"
        className="mb-3 self-start text-[14px] text-muted underline underline-offset-4 hover:text-text"
      >
        {t('analysis.page.allAnalyses')}
      </Link>
      <h1
        id="analysis-title"
        className="text-[clamp(1.75rem,1.6vw+1.25rem,2.375rem)] leading-tight font-[480] tracking-[-0.03em] text-text"
      >
        {title ?? t('analysis.page.title')}
      </h1>
      {children}
    </section>
  );
}
