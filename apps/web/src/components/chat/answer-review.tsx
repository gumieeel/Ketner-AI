import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertIcon, ChevronDownIcon, CloseIcon, ShieldIcon } from '@/components/icons';
import { CopyButton } from '@/components/ui/copy-button';
import { Spinner } from '@/components/ui/spinner';
import type { Message } from '@/features/chat/types';
import { useReview } from '@/features/review/review-store';
import type { AnswerReview, AnswerVerdict, ReviewSeverity } from '@/features/review/types';
import { useTranslation, type TranslationKey } from '@/i18n';
import { cn } from '@/lib/cn';

const Markdown = lazy(() => import('@/features/chat/markdown/markdown'));

const VERDICT_KEYS: Record<AnswerVerdict, TranslationKey> = {
  ok: 'review.verdict.ok',
  minor: 'review.verdict.minor',
  major: 'review.verdict.major',
  wrong: 'review.verdict.wrong',
  unknown: 'review.verdict.unknown',
};

const VERDICT_TONE: Record<AnswerVerdict, string> = {
  ok: 'border-success/30 bg-success-soft text-success',
  minor: 'border-warning/30 bg-warning-soft text-warning',
  major: 'border-danger/30 bg-danger-soft text-danger',
  wrong: 'border-danger/40 bg-danger-soft text-danger',
  unknown: 'border-stroke bg-surface-2 text-muted',
};

const SEVERITY_DOT: Record<ReviewSeverity, string> = {
  high: 'bg-danger',
  medium: 'bg-warning',
  low: 'bg-subtle',
};

const SEVERITY_KEYS: Record<ReviewSeverity, TranslationKey> = {
  high: 'review.severity.high',
  medium: 'review.severity.medium',
  low: 'review.severity.low',
};

/** Итог проверки: свежий из этой сессии или сохранённый у сообщения. */
export function useAnswerReview(message: Message): AnswerReview | undefined {
  const fresh = useReview((state) => state.results[message.id]);
  return fresh ?? message.review;
}

/** Кнопка «Проверить» в строке действий ответа. */
export function ReviewAnswerButton({
  message,
  disabled,
}: {
  message: Message;
  disabled?: boolean;
}) {
  const { t, language } = useTranslation();
  const reviewAnswer = useReview((state) => state.reviewAnswer);
  const running = useReview((state) => state.live[message.id]?.status === 'running');
  const review = useAnswerReview(message);

  return (
    <button
      type="button"
      disabled={disabled || running}
      onClick={() => void reviewAnswer(message.conversationId, message.id, language)}
      title={t('review.buttonHint')}
      aria-label={review ? t('review.again') : t('review.button')}
      className={cn(
        'inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-md px-2 text-[13px] font-medium transition-colors max-md:h-11',
        'text-muted hover:bg-surface-2 hover:text-text disabled:cursor-not-allowed disabled:opacity-50',
      )}
    >
      {running ? <Spinner className="size-3.5 text-accent" /> : <ShieldIcon className="size-3.5" />}
      {t('review.button')}
    </button>
  );
}

function IssueList({ review }: { review: AnswerReview }) {
  const { t } = useTranslation();
  if (review.issues.length === 0) return null;
  return (
    <ol className="mt-3 flex flex-col gap-2.5">
      {review.issues.map((issue, index) => (
        <li key={index} className="flex gap-2.5 text-[14px] leading-6">
          <span
            className={cn('mt-2 size-2 shrink-0 rounded-full', SEVERITY_DOT[issue.severity])}
            title={t(SEVERITY_KEYS[issue.severity])}
            aria-label={t(SEVERITY_KEYS[issue.severity])}
          />
          <div className="min-w-0 flex-1">
            {issue.quote ? (
              <blockquote className="mb-1 border-l-2 border-stroke pl-2.5 text-[13px] italic leading-5 text-muted">
                «{issue.quote}»
              </blockquote>
            ) : null}
            <p className="text-text">{issue.problem}</p>
            {issue.fix ? (
              <p className="mt-0.5 text-[13px] leading-5 text-muted">
                <span className="font-medium text-text/80">{t('review.fix')}</span> {issue.fix}
              </p>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

/**
 * Результат проверки под ответом: кто проверил, итог, замечания с цитатами из ответа и, при
 * серьёзных ошибках, исправленный ответ.
 */
export function AnswerReviewPanel({ message }: { message: Message }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const liveStatus = useReview((state) => state.live[message.id]?.status);
  const freshId = useReview((state) => state.results[message.id]?.id);
  // Проверку запустили только что: панель под ответом могла оказаться ниже края экрана.
  useEffect(() => {
    if (liveStatus || freshId) {
      ref.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    }
  }, [liveStatus, freshId]);
  return (
    <div ref={ref}>
      <AnswerReviewBody message={message} />
    </div>
  );
}

function AnswerReviewBody({ message }: { message: Message }) {
  const { t } = useTranslation();
  const live = useReview((state) => state.live[message.id]);
  const dismissError = useReview((state) => state.dismissError);
  const review = useAnswerReview(message);
  const [collapsed, setCollapsed] = useState(false);
  const [showCorrected, setShowCorrected] = useState(false);

  if (live?.status === 'running') {
    return (
      <div
        role="status"
        className="mt-3 flex items-center gap-2 rounded-xl border border-stroke bg-surface px-3.5 py-3 text-[13px] text-muted"
      >
        <Spinner className="size-4 text-accent" />
        {live.reviewer
          ? t('review.running', {
              model: live.reviewer.modelName,
              developer: live.reviewer.developer,
            })
          : t('review.starting')}
      </div>
    );
  }

  if (live?.status === 'error') {
    const upgrade = live.errorCode === 'review_limit';
    const signIn = live.errorCode === 'unauthorized';
    return (
      <div
        role="alert"
        className="mt-3 flex items-start gap-2 rounded-xl border border-danger/30 bg-danger-soft px-3.5 py-3 text-[13px] leading-5 text-danger"
      >
        <AlertIcon className="mt-0.5 size-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-text/85">{live.error || t('review.failed')}</p>
          {upgrade ? (
            <Link
              to="/pricing"
              className="mt-1 inline-block font-medium text-accent hover:underline"
            >
              {t('review.morePlans')}
            </Link>
          ) : signIn ? (
            <Link to="/login" className="mt-1 inline-block font-medium text-accent hover:underline">
              {t('review.signIn')}
            </Link>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => dismissError(message.id)}
          aria-label={t('review.dismiss')}
          className="rounded p-0.5 text-muted hover:text-text"
        >
          <CloseIcon className="size-3.5" />
        </button>
      </div>
    );
  }

  if (!review) return null;

  return (
    <section
      aria-label={t('review.title')}
      data-testid="answer-review"
      className="mt-3 rounded-xl border border-stroke bg-surface"
    >
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3.5 py-2.5">
        <ShieldIcon className="size-4 shrink-0 text-accent" />
        <span
          className={cn(
            'rounded-xs border px-2 py-0.5 text-[12px] font-semibold',
            VERDICT_TONE[review.verdict],
          )}
        >
          {t(VERDICT_KEYS[review.verdict])}
        </span>
        <span className="order-last basis-full text-[12px] text-subtle sm:order-none sm:min-w-0 sm:flex-1 sm:basis-0 sm:truncate">
          {t('review.by', {
            model: review.reviewer.modelName,
            developer: review.reviewer.developer,
          })}
        </span>
        <button
          type="button"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((value) => !value)}
          className="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[12px] text-muted hover:bg-surface-2 hover:text-text"
        >
          {collapsed ? t('review.expand') : t('review.collapse')}
          <ChevronDownIcon
            className={cn('size-3.5 transition-transform', !collapsed && 'rotate-180')}
          />
        </button>
      </header>

      {collapsed ? null : (
        <div className="border-t border-stroke px-3.5 py-3">
          {review.summary ? (
            <p className="text-[14px] leading-6 text-text">{review.summary}</p>
          ) : null}
          {review.verdict === 'ok' && review.issues.length === 0 ? (
            <p className="mt-1 text-[13px] text-muted">{t('review.noIssues')}</p>
          ) : null}
          <IssueList review={review} />

          {review.corrected ? (
            <div className="mt-3">
              <button
                type="button"
                aria-expanded={showCorrected}
                onClick={() => setShowCorrected((value) => !value)}
                className="text-[13px] font-medium text-accent hover:underline"
              >
                {showCorrected ? t('review.hideCorrected') : t('review.showCorrected')}
              </button>
              {showCorrected ? (
                <div className="mt-2 rounded-lg border border-stroke bg-canvas px-3 py-2.5 text-[14px] leading-6">
                  <Suspense fallback={<p className="whitespace-pre-wrap">{review.corrected}</p>}>
                    <Markdown content={review.corrected} />
                  </Suspense>
                  <div className="-ml-2 mt-1 text-muted">
                    <CopyButton
                      value={review.corrected}
                      label={t('review.copyCorrected')}
                      size="sm"
                    />
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
          <p className="mt-3 text-[11px] leading-4 text-subtle">{t('review.disclaimer')}</p>
        </div>
      )}
    </section>
  );
}
