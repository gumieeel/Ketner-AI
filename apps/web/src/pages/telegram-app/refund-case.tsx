import { useId, useState } from 'react';
import { CheckIcon, CloseIcon, SendIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { ApiError, miniAppApi, type MiniAppPayment } from '@/features/telegram/api';
import { haptic } from '@/features/telegram/webapp';
import { useTranslation } from '@/i18n';
import { cn } from '@/lib/cn';
import { formatDateTime, Notice, useMiniApp } from './shared';

const MESSAGE_MAX = 1000;

type StepState = 'done' | 'current' | 'failed' | 'todo';

interface Step {
  key: string;
  title: string;
  detail?: string;
  state: StepState;
}

/**
 * Заявка на возврат в чеке: ход рассмотрения по шагам, переписка с поддержкой и поле,
 * чтобы написать поддержке. Ответы поддержки приходят ещё и в бот оплаты.
 */
export function RefundCase({ payment }: { payment: MiniAppPayment }) {
  const { t, language } = useTranslation();
  const { app, token, setState } = useMiniApp();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  const refund = payment.refund!;
  const messages = refund.messages ?? [];
  const at = (iso?: string) => (iso ? formatDateTime(iso, language) : undefined);

  const steps: Step[] = [
    {
      key: 'sent',
      title: refund.auto ? t('tg.caseStepAuto') : t('tg.caseStepSent'),
      detail: at(refund.requestedAt),
      state: 'done',
    },
  ];
  if (!refund.auto) {
    steps.push({
      key: 'review',
      title: t('tg.caseStepReview'),
      detail: payment.status === 'refund_requested' ? t('tg.caseStepReviewHint') : undefined,
      state: payment.status === 'refund_requested' ? 'current' : 'done',
    });
  }
  steps.push(
    payment.status === 'refund_declined'
      ? {
          key: 'result',
          title: t('tg.caseStepDeclined'),
          detail: [at(refund.decidedAt), refund.note].filter(Boolean).join(' · '),
          state: 'failed',
        }
      : {
          key: 'result',
          title:
            payment.method === 'stars' ? t('tg.caseStepRefundedStars') : t('tg.caseStepRefunded'),
          detail:
            payment.status === 'refunded' ? at(refund.decidedAt ?? refund.requestedAt) : undefined,
          state: payment.status === 'refunded' ? 'done' : 'todo',
        },
  );

  const send = async () => {
    const clean = text.trim();
    if (!clean) return;
    setBusy(true);
    setError(null);
    try {
      setState(await miniAppApi.refundMessage(token, payment.id, clean));
      setText('');
      haptic.success(app);
    } catch (caught) {
      haptic.error(app);
      setError(caught instanceof ApiError ? caught.message : t('tg.errorGeneric'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <ol aria-label={t('tg.caseProgress')} className="flex flex-col">
        {steps.map((step, index) => (
          <li key={step.key} className="relative flex gap-3 pb-4 last:pb-0">
            {index < steps.length - 1 ? (
              <span
                aria-hidden
                className={cn(
                  'absolute top-6 bottom-0 left-[11px] w-px',
                  step.state === 'done' ? 'bg-accent/60' : 'bg-stroke',
                )}
              />
            ) : null}
            <span
              aria-hidden
              className={cn(
                'relative z-10 grid size-6 shrink-0 place-items-center rounded-full border',
                step.state === 'done' && 'border-accent bg-accent text-accent-text',
                step.state === 'current' && 'border-warning bg-surface',
                step.state === 'failed' && 'border-danger bg-danger-soft text-danger-text',
                step.state === 'todo' && 'border-stroke bg-surface',
              )}
            >
              {step.state === 'done' ? <CheckIcon className="size-3.5" /> : null}
              {step.state === 'failed' ? <CloseIcon className="size-3.5" /> : null}
              {step.state === 'current' ? (
                <span className="size-2 animate-pulse rounded-full bg-warning motion-reduce:animate-none" />
              ) : null}
            </span>
            <div className="min-w-0 pt-0.5">
              <p
                className={cn(
                  'text-[14px] leading-5 font-medium',
                  step.state === 'todo' ? 'text-subtle' : 'text-text',
                )}
              >
                {step.title}
                <span className="sr-only">
                  {' · '}
                  {t(
                    step.state === 'done'
                      ? 'tg.caseStateDone'
                      : step.state === 'current'
                        ? 'tg.caseStateCurrent'
                        : step.state === 'failed'
                          ? 'tg.caseStateFailed'
                          : 'tg.caseStateTodo',
                  )}
                </span>
              </p>
              {step.detail ? (
                <p className="mt-0.5 text-[13px] leading-5 text-muted">{step.detail}</p>
              ) : null}
            </div>
          </li>
        ))}
      </ol>

      {refund.comment ? (
        <p className="rounded-lg bg-surface-2 px-3 py-2.5 text-[13px] leading-5 text-text">
          <span className="text-muted">{t('tg.fieldComment')}: </span>«{refund.comment}»
        </p>
      ) : null}

      <section aria-labelledby={`${inputId}-thread`} className="flex flex-col gap-2">
        <h4 id={`${inputId}-thread`} className="text-[14px] font-semibold">
          {t('tg.caseThread')}
        </h4>
        {messages.length === 0 ? (
          <p className="text-[13px] leading-5 text-muted">{t('tg.caseThreadEmpty')}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {messages.map((message, index) => {
              const mine = message.from === 'user';
              return (
                <li
                  key={`${message.at}-${index}`}
                  className={cn('flex flex-col gap-0.5', mine ? 'items-end' : 'items-start')}
                >
                  <span className="px-1 text-[11px] text-subtle">
                    {mine ? t('tg.caseYou') : t('tg.caseSupport')} ·{' '}
                    {formatDateTime(message.at, language)}
                  </span>
                  <p
                    className={cn(
                      'max-w-[85%] rounded-2xl px-3 py-2 text-[14px] leading-5 break-words whitespace-pre-wrap',
                      mine
                        ? 'rounded-br-md bg-accent-soft text-text'
                        : 'rounded-bl-md border border-stroke bg-surface-2 text-text',
                    )}
                  >
                    {message.text}
                  </p>
                </li>
              );
            })}
          </ul>
        )}

        <label htmlFor={inputId} className="sr-only">
          {t('tg.caseMessageLabel')}
        </label>
        <div className="flex items-end gap-2">
          <textarea
            id={inputId}
            rows={2}
            maxLength={MESSAGE_MAX}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={t('tg.caseMessagePlaceholder')}
            className="min-h-11 w-full resize-none rounded-md border border-stroke bg-surface px-3.5 py-2.5 text-base text-text placeholder:text-subtle hover:border-stroke-strong focus:border-accent focus:ring-2 focus:ring-accent-soft focus:outline-none md:text-[15px]"
          />
          <Button
            aria-label={t('tg.caseSend')}
            className="size-11 shrink-0 p-0"
            loading={busy}
            disabled={!text.trim()}
            onClick={() => void send()}
          >
            <SendIcon className="size-4" />
          </Button>
        </div>
        <p className="px-1 text-[12px] leading-4 text-subtle">{t('tg.caseMessageHint')}</p>
        {error ? <Notice tone="danger">{error}</Notice> : null}
      </section>
    </div>
  );
}
