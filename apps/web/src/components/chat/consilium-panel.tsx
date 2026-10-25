import { Suspense, lazy } from 'react';
import { Link } from 'react-router-dom';
import { AlertIcon, CheckIcon, ShieldIcon, SparkleIcon } from '@/components/icons';
import { buttonClasses } from '@/components/ui/button-classes';
import { CopyButton } from '@/components/ui/copy-button';
import { Spinner } from '@/components/ui/spinner';
import { useChat } from '@/features/chat/chat-store';
import type { CompareRunView } from '@/features/chat/compare-store';
import type { JudgeAgreement } from '@/features/review/types';
import { useTranslation, type TranslationKey } from '@/i18n';
import { cn } from '@/lib/cn';
import { parseThinking } from './thinking-block';

const Markdown = lazy(() => import('@/features/chat/markdown/markdown'));

const AGREEMENT_KEYS: Record<JudgeAgreement, TranslationKey> = {
  full: 'consilium.agreement.full',
  partial: 'consilium.agreement.partial',
  low: 'consilium.agreement.low',
  unknown: 'consilium.agreement.unknown',
};

const AGREEMENT_TONE: Record<JudgeAgreement, string> = {
  full: 'border-success/30 bg-success-soft text-success',
  partial: 'border-warning/30 bg-warning-soft text-warning',
  low: 'border-danger/30 bg-danger-soft text-danger',
  unknown: 'border-stroke bg-surface-2 text-muted',
};

/**
 * Консилиум под колонками сравнения: модель другой компании читает ответы, пишет один итог и
 * показывает, в чём модели сходятся и где расходятся.
 */
export function ConsiliumPanel({ run }: { run: CompareRunView }) {
  const { t } = useTranslation();
  const runJudge = useChat((state) => state.runJudge);
  const saveJudge = useChat((state) => state.saveJudge);
  const judge = run.judge;
  const answered = run.slots.filter(
    (slot) => slot.status === 'done' && slot.content.trim() !== '',
  ).length;

  if (run.status !== 'done' || answered < 2) return null;

  if (!judge || (judge.status === 'error' && !judge.content)) {
    return (
      <div className="flex flex-col gap-2 rounded-xl border border-dashed border-accent/40 bg-accent-soft/40 px-4 py-3 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-[14px] font-semibold text-text">
            <SparkleIcon className="size-4 text-accent" />
            {t('consilium.title')}
          </p>
          <p className="mt-0.5 text-[13px] leading-5 text-muted">{t('consilium.hint')}</p>
          {judge?.status === 'error' ? (
            <p role="alert" className="mt-1 text-[13px] text-danger">
              {judge.error}{' '}
              {judge.errorCode === 'review_limit' ? (
                <Link to="/pricing" className="font-medium text-accent hover:underline">
                  {t('review.morePlans')}
                </Link>
              ) : null}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => void runJudge()}
          className={buttonClasses({ variant: 'primary', size: 'sm' })}
        >
          <ShieldIcon className="size-4" />
          {t('consilium.run')}
        </button>
      </div>
    );
  }

  const content = parseThinking(judge.content).content;
  const result = judge.result;
  const streaming = judge.status === 'streaming';

  return (
    <section
      aria-label={t('consilium.title')}
      data-testid="consilium"
      className="rounded-xl border border-accent/40 bg-surface shadow-glow"
    >
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-stroke px-4 py-2.5">
        <SparkleIcon className="size-4 text-accent" />
        <span className="text-[14px] font-semibold text-text">{t('consilium.title')}</span>
        {result ? (
          <span
            className={cn(
              'rounded-xs border px-2 py-0.5 text-[12px] font-semibold',
              AGREEMENT_TONE[result.agreement],
            )}
          >
            {t(AGREEMENT_KEYS[result.agreement])}
          </span>
        ) : null}
        <span className="basis-full text-[12px] text-subtle sm:min-w-0 sm:flex-1 sm:basis-0 sm:truncate sm:text-right">
          {judge.reviewer
            ? t('consilium.by', {
                model: judge.reviewer.modelName,
                developer: judge.reviewer.developer,
              })
            : t('review.starting')}
        </span>
      </header>

      {result && (result.disputes.length > 0 || result.consensus.length > 0) ? (
        <div className="grid gap-3 border-b border-stroke px-4 py-3 md:grid-cols-2">
          {result.disputes.length > 0 ? (
            <div className="min-w-0">
              <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-warning">
                <AlertIcon className="size-3.5" />
                {t('consilium.disputes', { count: result.disputes.length })}
              </h3>
              <ul className="mt-1.5 flex flex-col gap-2">
                {result.disputes.map((dispute, index) => (
                  <li
                    key={index}
                    className="rounded-lg border border-warning/30 bg-warning-soft/40 px-3 py-2"
                  >
                    <p className="text-[13px] font-medium text-text">{dispute.topic}</p>
                    {dispute.positions.length > 0 ? (
                      <ul className="mt-1 flex flex-col gap-0.5 text-[13px] leading-5 text-muted">
                        {dispute.positions.map((position, positionIndex) => (
                          <li key={positionIndex}>
                            <span className="font-medium text-text/85">{position.model}:</span>{' '}
                            {position.claim}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {dispute.resolution ? (
                      <p className="mt-1 text-[13px] leading-5 text-text/85">
                        <span className="font-medium">{t('consilium.resolution')}</span>{' '}
                        {dispute.resolution}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {result.consensus.length > 0 ? (
            <div className="min-w-0">
              <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-success">
                <CheckIcon className="size-3.5" />
                {t('consilium.consensus')}
              </h3>
              <ul className="mt-1.5 flex list-disc flex-col gap-1 pl-5 text-[13px] leading-5 text-muted">
                {result.consensus.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="px-4 py-3 text-[15px] leading-7 text-text">
        {content ? (
          <Suspense fallback={<p className="whitespace-pre-wrap">{content}</p>}>
            <Markdown content={content} />
          </Suspense>
        ) : (
          <p className="flex items-center gap-2 text-[13px] text-muted">
            <Spinner className="size-4 text-accent" />
            {judge.reviewer
              ? t('consilium.reading', { model: judge.reviewer.modelName })
              : t('review.starting')}
          </p>
        )}
        {streaming && content ? (
          <span className="caret ml-1 text-accent" aria-hidden="true" />
        ) : null}
        {judge.status === 'error' ? (
          <p role="alert" className="mt-2 text-[13px] text-danger">
            {judge.error}
          </p>
        ) : null}
      </div>

      {result ? (
        <footer className="flex flex-wrap items-center gap-2 border-t border-stroke px-4 py-2.5">
          {judge.saved ? (
            <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-accent">
              <CheckIcon className="size-4" />
              {t('consilium.saved')}
            </span>
          ) : (
            <button
              type="button"
              disabled={judge.saving}
              onClick={() => void saveJudge()}
              className={buttonClasses({ variant: 'primary', size: 'sm' })}
            >
              {t('consilium.save')}
            </button>
          )}
          <div className="text-muted">
            <CopyButton value={result.content} label={t('chat.copy')} size="sm" />
          </div>
          <button
            type="button"
            onClick={() => void runJudge()}
            className="ml-auto text-[12px] text-muted hover:text-text"
          >
            {t('consilium.again')}
          </button>
          {judge.saveError ? (
            <p role="alert" className="w-full text-[13px] text-danger">
              {judge.saveError}
            </p>
          ) : null}
        </footer>
      ) : null}
    </section>
  );
}
