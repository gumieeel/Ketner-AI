import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { Spinner } from '@/components/ui/spinner';
import { DiscoveryApiError, newIdempotencyKey } from '@/features/discovery/api';
import { POLL_MS } from '@/features/discovery/use-analysis';
import {
  createAttempt,
  fetchAttempt,
  gradeAttempt,
  isActiveRun,
  listAttempts,
  quoteGrade,
  saveAnswers,
  submitAttempt,
  type AnswerResult,
  type AnswerValue,
  type AttemptQuestion,
  type AttemptSummary,
  type AttemptView,
  type QuestionSetView,
  type RunQuote,
  type ToolRunView,
  type Verdict,
} from '@/features/study/api';
import { VERDICT_LABEL } from '@/features/study/labels';
import { useTranslation } from '@/i18n';
import { formatDateTime } from '@/lib/format-date';
import { ErrorNotice } from '@/pages/analysis/error-notice';
import { BuilderGate, Page } from '../shared';
import { SourceChips } from './result-views';

const VERDICT_TONE: Record<Verdict, BadgeTone> = {
  correct: 'success',
  partial: 'warning',
  incorrect: 'danger',
  unanswered: 'neutral',
  pending: 'info',
};

const WRONG: ReadonlySet<Verdict> = new Set(['incorrect', 'partial', 'unanswered']);

function useNumber() {
  const { language } = useTranslation();
  return (value: number) => value.toLocaleString(language === 'en' ? 'en-US' : 'ru-RU');
}

/** Итог попытки: «2,5 из 3» — только по проверенным ответам. */
function ScoreText({
  attempt,
}: {
  attempt: Pick<AttemptSummary, 'score' | 'maxScore' | 'status'>;
}) {
  const { t } = useTranslation();
  const number = useNumber();
  if (attempt.status === 'in_progress' || attempt.score === null)
    return <>{t('study.attempt.inProgress')}</>;
  return (
    <>{t('study.attempt.score', { score: number(attempt.score), max: number(attempt.maxScore) })}</>
  );
}

/** Готовый тест на странице результата: что в нём, начать попытку, прошлые попытки. */
export function QuestionsOverview({ run, set }: { run: ToolRunView; set: QuestionSetView }) {
  const { t, language } = useTranslation();
  const navigate = useNavigate();
  const [attempts, setAttempts] = useState<AttemptSummary[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const topics = [...new Set(set.questions.map((question) => question.topic))];

  useEffect(() => {
    let alive = true;
    listAttempts(run.solutionId, run.id).then(
      (list) => alive && setAttempts(list),
      (caught: unknown) => alive && setError(caught),
    );
    return () => {
      alive = false;
    };
  }, [run.solutionId, run.id]);

  const begin = async (retryOf?: string) => {
    setBusy(true);
    setError(null);
    try {
      const attempt = await createAttempt(run.solutionId, run.id, retryOf);
      navigate(`/solutions/${run.solutionId}/attempts/${attempt.id}`);
    } catch (caught) {
      setError(caught);
      setBusy(false);
    }
  };

  return (
    <section aria-label={t('study.attempt.overview')} className="mt-8">
      <p className="text-[15px] leading-7 text-text">
        {t('study.attempt.summary', { count: set.questions.length, topics: topics.join(', ') })}
      </p>
      {set.rejected > 0 ? (
        <p className="mt-2 text-[13px] leading-5 text-subtle">
          {t('study.attempt.rejected', { count: set.rejected })}
        </p>
      ) : null}
      <div className="mt-5">
        <Button loading={busy} disabled={busy} onClick={() => void begin()}>
          {t(run.operation === 'quiz' ? 'study.attempt.startQuiz' : 'study.attempt.startSelfCheck')}
        </Button>
      </div>
      {error ? (
        <div className="mt-4">
          <ErrorNotice error={error} redirect={`/solutions/${run.solutionId}/runs/${run.id}`} />
        </div>
      ) : null}
      {attempts && attempts.length > 0 ? (
        <div className="mt-8">
          <h2 className="text-[17px] font-medium text-text">{t('study.attempt.history')}</h2>
          <ul aria-label={t('study.attempt.history')} className="mt-3 flex flex-col gap-2">
            {attempts.map((attempt) => (
              <li key={attempt.id}>
                <Link
                  to={`/solutions/${run.solutionId}/attempts/${attempt.id}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-stroke p-3 text-[14px] hover:bg-surface-2"
                >
                  <span className="text-text">
                    <ScoreText attempt={attempt} />
                    {attempt.pending > 0
                      ? ` · ${t('study.attempt.pendingShort', { count: attempt.pending })}`
                      : ''}
                  </span>
                  <span className="text-[13px] text-subtle">
                    {formatDateTime(attempt.createdAt, language)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

/** Страница попытки: ответы → сдача → разбор с ключами, цитатами и проверкой открытых ответов. */
export function AttemptPage() {
  const { solutionId = '', attemptId = '' } = useParams();
  return (
    <BuilderGate>
      <AttemptScreen key={attemptId} solutionId={solutionId} attemptId={attemptId} />
    </BuilderGate>
  );
}

function AttemptScreen({ solutionId, attemptId }: { solutionId: string; attemptId: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [attempt, setAttempt] = useState<AttemptView | null>(null);
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({});
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const dirty = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const next = await fetchAttempt(solutionId, attemptId);
      setAttempt(next);
      if (!dirty.current) setAnswers(next.answers);
    } catch (caught) {
      if (caught instanceof DiscoveryApiError && caught.status === 404) setMissing(true);
      else setError(caught);
    }
  }, [solutionId, attemptId]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Проверка открытых ответов идёт — обновлять, пока не закончится.
  const grading = attempt?.grade ? isActiveRun(attempt.grade) : false;
  useEffect(() => {
    if (!grading) return;
    const timer = window.setTimeout(() => void refresh(), POLL_MS);
    return () => window.clearTimeout(timer);
  }, [grading, attempt, refresh]);

  // Черновик ответов сохраняется сам, с паузой после ввода.
  const answering = attempt?.status === 'in_progress';
  useEffect(() => {
    if (!answering || !dirty.current) return;
    const timer = window.setTimeout(() => {
      saveAnswers(solutionId, attemptId, answers).then(
        () => undefined,
        (caught: unknown) => setError(caught),
      );
    }, 800);
    return () => window.clearTimeout(timer);
  }, [answers, answering, solutionId, attemptId]);

  const back = attempt
    ? { to: `/solutions/${solutionId}/runs/${attempt.runId}`, label: t('study.attempt.back') }
    : { to: `/solutions/${solutionId}`, label: t('study.result.back') };

  if (missing) {
    return (
      <Page title={t('study.attempt.notFound')} back={back}>
        <p className="t-lead mt-4">{t('study.result.notFoundLead')}</p>
      </Page>
    );
  }
  if (!attempt) {
    return (
      <Page title={t('study.badge')} back={back}>
        {error ? (
          <div className="mt-8">
            <ErrorNotice
              error={error}
              redirect={`/solutions/${solutionId}/attempts/${attemptId}`}
            />
          </div>
        ) : (
          <p className="mt-8 flex items-center gap-2 text-[14px] text-muted">
            <Spinner /> {t('analysis.page.loading')}
          </p>
        )}
      </Page>
    );
  }

  const answer = (id: string, value: AnswerValue) => {
    dirty.current = true;
    setAnswers((current) => ({ ...current, [id]: value }));
  };
  const unanswered = attempt.questions.filter((question) =>
    question.type === 'choice'
      ? answers[question.id]?.selected === undefined
      : !answers[question.id]?.text?.trim(),
  ).length;
  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const next = await submitAttempt(solutionId, attemptId, answers);
      dirty.current = false;
      setAttempt(next);
      window.scrollTo?.({ top: 0 });
    } catch (caught) {
      setError(caught);
    } finally {
      setSubmitting(false);
    }
  };
  const results = new Map((attempt.results ?? []).map((item) => [item.questionId, item]));
  const hasMistakes = (attempt.results ?? []).some((item) => WRONG.has(item.verdict));
  const pending = (attempt.results ?? []).filter((item) => item.verdict === 'pending').length;

  return (
    <Page title={attempt.title} back={back} wide>
      <p className="mt-3 text-[14px] text-muted">
        {t(attempt.kind === 'quiz' ? 'study.operation.quiz' : 'study.operation.self_check')}
        {' · '}
        <ScoreText attempt={attempt} />
        {pending > 0 ? ` · ${t('study.attempt.pendingShort', { count: pending })}` : ''}
      </p>

      {attempt.status === 'in_progress' ? (
        <form
          className="mt-8 flex flex-col gap-6"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          {attempt.questions.map((question, index) => (
            <QuestionInput
              key={question.id}
              index={index}
              question={question}
              value={answers[question.id]}
              onChange={(value) => answer(question.id, value)}
            />
          ))}
          <div className="flex flex-col gap-2 border-t border-stroke pt-6">
            {unanswered > 0 ? (
              <p className="text-[13px] text-subtle">
                {t('study.attempt.unansweredNote', { count: unanswered })}
              </p>
            ) : null}
            <div>
              <Button type="submit" loading={submitting} disabled={submitting}>
                {t('study.attempt.submit')}
              </Button>
            </div>
          </div>
        </form>
      ) : (
        <>
          {pending > 0 || attempt.grade ? (
            <GradePanel attempt={attempt} onChange={setAttempt} />
          ) : null}
          <ol aria-label={t('study.attempt.review')} className="mt-8 flex flex-col gap-6">
            {attempt.questions.map((question, index) => (
              <QuestionReview
                key={question.id}
                index={index}
                question={question}
                answer={attempt.answers[question.id]}
                result={results.get(question.id)}
                attempt={attempt}
              />
            ))}
          </ol>
          {hasMistakes ? (
            <div className="mt-8 border-t border-stroke pt-6">
              <Button
                loading={retrying}
                disabled={retrying}
                onClick={() => {
                  setRetrying(true);
                  createAttempt(solutionId, attempt.runId, attempt.id).then(
                    (next) => navigate(`/solutions/${solutionId}/attempts/${next.id}`),
                    (caught: unknown) => {
                      setError(caught);
                      setRetrying(false);
                    },
                  );
                }}
              >
                {t('study.attempt.retryMistakes')}
              </Button>
            </div>
          ) : null}
        </>
      )}
      {error ? (
        <div className="mt-6">
          <ErrorNotice error={error} redirect={`/solutions/${solutionId}/attempts/${attemptId}`} />
        </div>
      ) : null}
    </Page>
  );
}

function QuestionInput({
  index,
  question,
  value,
  onChange,
}: {
  index: number;
  question: AttemptQuestion;
  value: AnswerValue | undefined;
  onChange: (value: AnswerValue) => void;
}) {
  const { t } = useTranslation();
  return (
    <fieldset className="rounded-xl border border-stroke p-4">
      <legend className="px-1 text-[13px] text-subtle">
        {t('study.attempt.questionN', { n: index + 1 })} · {question.topic}
      </legend>
      <p className="text-[16px] leading-7 text-text">{question.question}</p>
      {question.type === 'choice' ? (
        <div className="mt-3 flex flex-col gap-2">
          {(question.options ?? []).map((option, optionIndex) => (
            <label
              key={optionIndex}
              className="flex cursor-pointer items-start gap-2 text-[15px] text-text"
            >
              <input
                type="radio"
                name={question.id}
                className="mt-1.5"
                checked={value?.selected === optionIndex}
                onChange={() => onChange({ selected: optionIndex })}
              />
              <span>{option}</span>
            </label>
          ))}
        </div>
      ) : (
        <textarea
          aria-label={t('study.attempt.yourAnswerFor', { n: index + 1 })}
          value={value?.text ?? ''}
          maxLength={2000}
          rows={4}
          onChange={(event) => onChange({ text: event.target.value })}
          placeholder={t('study.attempt.openPlaceholder')}
          className="mt-3 w-full rounded-lg border border-stroke bg-transparent px-3 py-2 text-[15px] leading-6 text-text"
        />
      )}
    </fieldset>
  );
}

function QuestionReview({
  index,
  question,
  answer,
  result,
  attempt,
}: {
  index: number;
  question: AttemptQuestion;
  answer: AnswerValue | undefined;
  result: AnswerResult | undefined;
  attempt: AttemptView;
}) {
  const { t } = useTranslation();
  const verdict = result?.verdict ?? 'unanswered';
  const refs = [...new Set([...question.sources, ...(result?.sources ?? [])])];
  return (
    <li className="rounded-xl border border-stroke p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[13px] text-subtle">
          {t('study.attempt.questionN', { n: index + 1 })} · {question.topic}
        </span>
        <Badge tone={VERDICT_TONE[verdict]}>{t(VERDICT_LABEL[verdict])}</Badge>
      </div>
      <p className="mt-2 text-[16px] leading-7 text-text">{question.question}</p>

      {question.type === 'choice' ? (
        <ul className="mt-3 flex flex-col gap-1.5 text-[15px]">
          {(question.options ?? []).map((option, optionIndex) => {
            const correct = optionIndex === question.correctIndex;
            const chosen = optionIndex === answer?.selected;
            return (
              <li
                key={optionIndex}
                className={`rounded-lg px-3 py-1.5 ${correct ? 'bg-success-soft text-text' : chosen ? 'bg-danger-soft text-text' : 'text-muted'}`}
              >
                {option}
                {correct ? ` — ${t('study.attempt.correctOption')}` : ''}
                {chosen && !correct ? ` — ${t('study.attempt.yourChoice')}` : ''}
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="mt-3 flex flex-col gap-3 text-[15px] leading-6">
          <div>
            <p className="text-[13px] font-medium text-subtle">{t('study.attempt.yourAnswer')}</p>
            <p className="whitespace-pre-wrap text-text">
              {answer?.text?.trim() || t('study.attempt.noAnswer')}
            </p>
          </div>
          {result?.feedback ? (
            <div className="rounded-lg bg-surface-2 px-3 py-2">
              <p className="text-[13px] font-medium text-subtle">{t('study.attempt.feedback')}</p>
              <p className="text-text">{result.feedback}</p>
              {result.missing && result.missing.length > 0 ? (
                <p className="mt-1 text-muted">
                  {t('study.attempt.missing')} {result.missing.join('; ')}
                </p>
              ) : null}
            </div>
          ) : null}
          {question.modelAnswer ? (
            <div>
              <p className="text-[13px] font-medium text-subtle">
                {t('study.attempt.modelAnswer')}
              </p>
              <p className="text-text">{question.modelAnswer}</p>
            </div>
          ) : null}
        </div>
      )}

      {question.explanation ? (
        <p className="mt-3 text-[14px] leading-6 text-muted">{question.explanation}</p>
      ) : null}
      {question.evidence ? (
        <blockquote className="mt-2 border-l-2 border-stroke pl-3 text-[14px] leading-6 text-muted">
          {t('study.attempt.evidence', { quote: question.evidence })}
        </blockquote>
      ) : null}
      <SourceChips refs={refs} sources={attempt.sources} />
    </li>
  );
}

/** Проверка открытых ответов: цена до запуска, подтверждение, ход проверки и её итог. */
function GradePanel({
  attempt,
  onChange,
}: {
  attempt: AttemptView;
  onChange: (next: AttemptView) => void;
}) {
  const { t, language } = useTranslation();
  const { solutionId: routeSolution = '' } = useParams();
  const [quote, setQuote] = useState<RunQuote | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const keyRef = useRef(newIdempotencyKey());
  const pending = (attempt.results ?? []).filter((item) => item.verdict === 'pending').length;
  const grade = attempt.grade;
  const active = grade ? isActiveRun(grade) : false;
  const canGrade = pending > 0 && !active;

  useEffect(() => {
    if (!canGrade) return;
    let alive = true;
    quoteGrade(routeSolution, attempt.id).then(
      (next) => alive && setQuote(next),
      (caught: unknown) => alive && setError(caught),
    );
    return () => {
      alive = false;
    };
  }, [canGrade, routeSolution, attempt.id, grade?.status]);

  const launch = async (accepted: RunQuote, confirm: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const next = await gradeAttempt(routeSolution, attempt.id, {
        idempotencyKey: keyRef.current,
        acceptedMaxCredits: accepted.maxCredits,
        ...(confirm ? { confirm: true } : {}),
      });
      keyRef.current = newIdempotencyKey();
      onChange(next);
    } catch (caught) {
      const fresh =
        caught instanceof DiscoveryApiError && caught.code === 'confirmation_required'
          ? (caught.details.quote as RunQuote | undefined)
          : undefined;
      if (fresh) {
        setQuote(fresh);
        setConfirming(true);
      } else {
        setError(caught);
      }
    } finally {
      setBusy(false);
    }
  };
  const charged = (credits: number) =>
    t('study.result.charged', {
      credits: credits.toLocaleString(language === 'en' ? 'en-US' : 'ru-RU'),
    });

  return (
    <section
      aria-label={t('study.grade.title')}
      className="mt-8 rounded-xl border border-stroke p-4"
    >
      {active ? (
        <p role="status" className="flex items-center gap-2 text-[15px] text-muted">
          <Spinner /> {t('study.grade.working')}
        </p>
      ) : null}
      {grade?.status === 'done' ? (
        <p className="text-[14px] text-muted">
          {t('study.grade.done', { charged: charged(grade.chargedCredits) })}
        </p>
      ) : null}
      {grade?.status === 'failed' ? (
        <div role="alert" className="text-[14px] leading-6 text-text">
          <p>{grade.error?.message ?? t('study.run.failed')}</p>
          <p className="text-muted">
            {grade.chargedCredits > 0 ? charged(grade.chargedCredits) : t('study.run.notCharged')}
          </p>
        </div>
      ) : null}
      {canGrade ? (
        <div className="mt-2 flex flex-col gap-3">
          <p className="text-[14px] leading-6 text-text">
            {t('study.grade.lead', { count: pending })}
          </p>
          <p className="text-[13px] text-muted">
            {quote
              ? t('study.create.price', {
                  typical: quote.typicalCredits,
                  max: quote.maxCredits,
                  model: quote.model,
                })
              : t('study.create.pricing')}
          </p>
          <div>
            <Button
              disabled={!quote || busy}
              loading={busy}
              onClick={() => {
                if (!quote) return;
                if (quote.confirmationRequired) setConfirming(true);
                else void launch(quote, false);
              }}
            >
              {quote
                ? t('study.grade.start', { max: quote.maxCredits })
                : t('study.grade.startDisabled')}
            </Button>
          </div>
        </div>
      ) : null}
      {error ? (
        <div className="mt-3">
          <ErrorNotice
            error={error}
            redirect={`/solutions/${routeSolution}/attempts/${attempt.id}`}
          />
        </div>
      ) : null}
      {confirming && quote ? (
        <Modal labelledBy="confirm-grade-title" size="sm" onClose={() => setConfirming(false)}>
          <div className="flex flex-col gap-4 p-6">
            <h2 id="confirm-grade-title" className="text-[18px] font-medium text-text">
              {t('study.create.confirmTitle')}
            </h2>
            <p className="text-[14px] leading-6 text-muted">
              {t('study.create.price', {
                typical: quote.typicalCredits,
                max: quote.maxCredits,
                model: quote.model,
              })}
            </p>
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <Button variant="outline" onClick={() => setConfirming(false)}>
                {t('analysis.new.cancel')}
              </Button>
              <Button
                onClick={() => {
                  setConfirming(false);
                  void launch(quote, true);
                }}
              >
                {t('study.create.confirmButton', { max: quote.maxCredits })}
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}
    </section>
  );
}
