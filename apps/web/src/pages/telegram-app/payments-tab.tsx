import { useId, useState } from 'react';
import {
  ChevronRightIcon,
  CryptoIcon,
  FileTextIcon,
  RefreshIcon,
  StarIcon,
} from '@/components/icons';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/ui/copy-button';
import {
  ApiError,
  miniAppApi,
  type MiniAppPayment,
  type PaymentStatus,
} from '@/features/telegram/api';
import { haptic } from '@/features/telegram/webapp';
import { useTranslation, type TranslationKey } from '@/i18n';
import { cn } from '@/lib/cn';
import { RefundCase } from './refund-case';
import { hasRefundCase, refundCaseSummary } from './refund-case-utils';
import {
  Field,
  formatAmount,
  formatDate,
  formatDateTime,
  Notice,
  Panel,
  SectionTitle,
  Sheet,
  useMiniApp,
} from './shared';

const STATUS: Record<PaymentStatus, { tone: BadgeTone; key: TranslationKey }> = {
  paid: { tone: 'success', key: 'tg.statusPaid' },
  refund_requested: { tone: 'warning', key: 'tg.statusRequested' },
  refunded: { tone: 'neutral', key: 'tg.statusRefunded' },
  refund_declined: { tone: 'danger', key: 'tg.statusDeclined' },
};

const REASONS: TranslationKey[] = [
  'tg.reasonNotFit',
  'tg.reasonWrongPlan',
  'tg.reasonNoUse',
  'tg.reasonExpensive',
  'tg.reasonOther',
];

export function PaymentsTab() {
  const { t, language } = useTranslation();
  const { state, goTo } = useMiniApp();
  const [openId, setOpenId] = useState<string | null>(null);
  const { payments, refundPolicy } = state;
  const open = payments.find((payment) => payment.id === openId) ?? null;
  const cases = payments.filter(hasRefundCase);

  return (
    <div className="flex flex-col gap-4">
      {payments.length === 0 ? (
        <Panel className="flex flex-col items-center gap-3 py-8 text-center">
          <span className="grid size-12 place-items-center rounded-full bg-surface-2 text-muted">
            <FileTextIcon className="size-5" />
          </span>
          <p className="text-[15px] font-medium">{t('tg.paymentsEmpty')}</p>
          <p className="text-[13px] leading-5 text-muted">{t('tg.paymentsEmptyText')}</p>
          <Button className="mt-1" onClick={() => goTo('plans')}>
            {t('tg.choosePlan')}
          </Button>
        </Panel>
      ) : (
        <>
          {cases.length > 0 ? (
            <section aria-labelledby="tg-cases-title" className="flex flex-col gap-2">
              <SectionTitle id="tg-cases-title" aside={String(cases.length)}>
                {t('tg.casesTitle')}
              </SectionTitle>
              <ul className="flex flex-col gap-2">
                {cases.map((payment) => {
                  const fresh =
                    payment.status === 'refund_requested' &&
                    payment.refund?.messages?.at(-1)?.from === 'admin';
                  return (
                    <li key={payment.id}>
                      <button
                        type="button"
                        onClick={() => setOpenId(payment.id)}
                        className={cn(
                          'flex min-h-16 w-full items-center gap-3 rounded-xl border bg-surface px-4 py-3 text-left hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                          payment.status === 'refund_requested'
                            ? 'border-warning/50'
                            : 'border-stroke',
                        )}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="text-[15px] font-medium">
                              {payment.planTitle} · {formatAmount(payment, language)}
                            </span>
                            <Badge tone={STATUS[payment.status].tone}>
                              {t(STATUS[payment.status].key)}
                            </Badge>
                          </span>
                          <span
                            className={cn(
                              'mt-1 block text-[13px] leading-5',
                              fresh ? 'font-medium text-accent' : 'text-muted',
                            )}
                          >
                            {refundCaseSummary(payment, t)}
                          </span>
                        </span>
                        <ChevronRightIcon className="size-4 shrink-0 text-subtle" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}
          <section aria-labelledby="tg-payments-title" className="flex flex-col gap-2">
            <SectionTitle id="tg-payments-title">{t('tg.paymentsTitle')}</SectionTitle>
            <ul className="overflow-hidden rounded-xl border border-stroke bg-surface">
              {payments.map((payment, index) => (
                <li key={payment.id} className={cn(index > 0 && 'border-t border-stroke')}>
                  <button
                    type="button"
                    onClick={() => setOpenId(payment.id)}
                    className="flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none"
                  >
                    <span className="grid size-9 shrink-0 place-items-center rounded-full bg-surface-2 text-muted">
                      {payment.method === 'stars' ? (
                        <StarIcon className="size-4 fill-warning text-warning" />
                      ) : (
                        <CryptoIcon className="size-4" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 text-[15px] font-medium">
                        {payment.planTitle}
                        {payment.recurring ? (
                          <>
                            <RefreshIcon className="size-3.5 text-muted" />
                            <span className="sr-only">{t('tg.autoRenew')}</span>
                          </>
                        ) : null}
                      </span>
                      <span className="mt-0.5 block text-[12px] text-subtle">
                        {formatDateTime(payment.paidAt, language)}
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      <span className="text-[14px] font-medium tabular-nums">
                        {formatAmount(payment, language)}
                      </span>
                      {payment.status !== 'paid' ? (
                        <Badge tone={STATUS[payment.status].tone}>
                          {t(STATUS[payment.status].key)}
                        </Badge>
                      ) : null}
                    </span>
                    <ChevronRightIcon className="size-4 shrink-0 text-subtle" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      <RefundPolicy hours={refundPolicy.hours} />

      {open ? <PaymentSheet payment={open} onClose={() => setOpenId(null)} /> : null}
    </div>
  );
}

export function RefundPolicy({ hours }: { hours: number }) {
  const { t } = useTranslation();
  return (
    <Panel aria-labelledby="tg-policy-title">
      <h2 id="tg-policy-title" className="text-[15px] font-semibold">
        {t('tg.policyTitle')}
      </h2>
      <ul className="mt-2 flex flex-col gap-2 text-[13px] leading-5 text-muted">
        <li>{t('tg.policy1', { hours })}</li>
        <li>{t('tg.policy2')}</li>
        <li>{t('tg.policy3')}</li>
        <li>{t('tg.policy4')}</li>
      </ul>
    </Panel>
  );
}

function PaymentSheet({ payment, onClose }: { payment: MiniAppPayment; onClose: () => void }) {
  const { t, language } = useTranslation();
  const { app, token, state, setState, notify } = useMiniApp();
  const [form, setForm] = useState(false);
  const [reason, setReason] = useState<TranslationKey | null>(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const commentId = useId();
  const reasonLabelId = useId();
  const option = payment.refundOption;
  const amount = formatAmount(payment, language);

  const submit = async () => {
    if (!reason) {
      setError(t('tg.reasonRequired'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await miniAppApi.refund(token, payment.id, t(reason), comment.trim());
      const { outcome, ...next } = result;
      setState(next);
      haptic.success(app);
      notify(
        'success',
        outcome === 'refunded' ? t('tg.refundDone', { amount }) : t('tg.refundRequested'),
      );
      onClose();
    } catch (caught) {
      haptic.error(app);
      setError(caught instanceof ApiError ? caught.message : t('tg.errorGeneric'));
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      setState(await miniAppApi.deletePayment(token, payment.id));
      haptic.success(app);
      notify('success', t('tg.receiptDeleted'));
      onClose();
    } catch (caught) {
      haptic.error(app);
      setError(caught instanceof ApiError ? caught.message : t('tg.errorGeneric'));
      setBusy(false);
    }
  };

  const noneText: Record<string, string> = {
    refunded: t('tg.refundNoneRefunded', { date: formatDate(payment.refund?.decidedAt, language) }),
    pending: t('tg.refundNonePending', { date: formatDate(payment.refund?.requestedAt, language) }),
    declined: payment.refund?.note
      ? t('tg.refundNoneDeclinedNote', { note: payment.refund.note })
      : t('tg.refundNoneDeclined'),
    expired: t('tg.refundNoneExpired', { hours: state.refundPolicy.hours }),
    used: t('tg.refundNoneUsed', { hours: state.refundPolicy.hours }),
  };
  const deadline = formatDateTime(
    new Date(Date.parse(payment.paidAt) + state.refundPolicy.hours * 3600_000).toISOString(),
    language,
  );

  return (
    <Sheet
      title={t('tg.receiptTitle', { plan: payment.planTitle })}
      onClose={onClose}
      closeLabel={t('tg.close')}
      app={app}
    >
      <div className="flex flex-col items-center gap-1 pb-3 text-center">
        <p className="text-[28px] font-semibold tabular-nums tracking-tight">{amount}</p>
        <Badge tone={STATUS[payment.status].tone}>{t(STATUS[payment.status].key)}</Badge>
      </div>
      <dl className="divide-y divide-stroke rounded-lg border border-stroke px-3">
        <Field label={t('tg.fieldPlan')}>
          {payment.planTitle}
          {payment.recurring ? (
            <span className="ml-1 text-muted">· {t('tg.autoRenew')}</span>
          ) : null}
        </Field>
        <Field label={t('tg.fieldMethod')}>
          {payment.method === 'stars' ? 'Telegram Stars' : t('tg.methodCrypto')}
        </Field>
        <Field label={t('tg.fieldDate')}>{formatDateTime(payment.paidAt, language)}</Field>
        {payment.periodEnd ? (
          <Field label={t('tg.fieldPeriod')}>{formatDate(payment.periodEnd, language, true)}</Field>
        ) : null}
        {payment.bonusDays > 0 ? (
          <Field label={t('tg.fieldBonus')}>
            {t('tg.bonusValue', { days: payment.bonusDays })}
          </Field>
        ) : null}
        <Field label={t('tg.fieldId')}>
          <span className="inline-flex max-w-full items-center gap-1">
            <span className="truncate font-mono text-[12px]">{payment.chargeId ?? payment.id}</span>
            <CopyButton value={payment.chargeId ?? payment.id} label={t('tg.copyId')} size="sm" />
          </span>
        </Field>
        {payment.refund?.reason ? (
          <Field label={t('tg.fieldReason')}>{payment.refund.reason}</Field>
        ) : null}
      </dl>

      <section aria-labelledby={`${commentId}-refund`} className="mt-4 flex flex-col gap-3">
        <h3 id={`${commentId}-refund`} className="text-[15px] font-semibold">
          {hasRefundCase(payment) ? t('tg.caseTitle') : t('tg.refundTitle')}
        </h3>
        {hasRefundCase(payment) ? (
          <RefundCase payment={payment} />
        ) : option.kind === 'none' ? (
          <Notice tone={option.reason === 'declined' ? 'warning' : 'info'}>
            {noneText[option.reason]}
          </Notice>
        ) : !form ? (
          <>
            <p className="text-[14px] leading-6 text-muted">
              {option.kind === 'auto' ? t('tg.refundAutoText') : t('tg.refundCryptoText')}
              {payment.recurring ? ` ${t('tg.refundAutoRenewOff')}` : ''}
            </p>
            <Notice tone="warning">{t('tg.refundDeadline', { date: deadline })}</Notice>
            <Button variant="outline" className="w-full" onClick={() => setForm(true)}>
              {option.kind === 'auto' ? t('tg.refundStart') : t('tg.refundRequestStart')}
            </Button>
          </>
        ) : (
          <div className="flex flex-col gap-3">
            <p id={reasonLabelId} className="text-[13px] font-medium">
              {t('tg.reasonLabel')}
            </p>
            <div role="radiogroup" aria-labelledby={reasonLabelId} className="flex flex-wrap gap-2">
              {REASONS.map((key) => (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={reason === key}
                  onClick={() => {
                    haptic.select(app);
                    setReason(key);
                    setError(null);
                  }}
                  className={cn(
                    'min-h-9 rounded-full border px-3.5 text-[13px] transition-colors duration-150',
                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                    reason === key
                      ? 'border-accent bg-accent-soft text-text'
                      : 'border-stroke text-muted hover:text-text',
                  )}
                >
                  {t(key)}
                </button>
              ))}
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor={commentId} className="text-[13px] font-medium">
                {t('tg.commentLabel')}
              </label>
              <textarea
                id={commentId}
                rows={3}
                maxLength={300}
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                placeholder={t('tg.commentPlaceholder')}
                className="w-full resize-none rounded-md border border-stroke bg-surface px-3.5 py-2.5 text-base text-text placeholder:text-subtle hover:border-stroke-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft md:text-[15px]"
              />
            </div>
            {option.kind === 'auto' ? <Notice tone="warning">{t('tg.refundWarn')}</Notice> : null}
            {error ? <Notice tone="danger">{error}</Notice> : null}
            <Button
              variant={option.kind === 'auto' ? 'danger' : 'primary'}
              className="w-full"
              loading={busy}
              onClick={() => void submit()}
            >
              {option.kind === 'auto' ? t('tg.refundConfirm', { amount }) : t('tg.refundSend')}
            </Button>
            <Button
              variant="ghost"
              className="w-full"
              disabled={busy}
              onClick={() => setForm(false)}
            >
              {t('tg.cancel')}
            </Button>
          </div>
        )}
      </section>

      {state.user.isAdmin ? (
        <section className="mt-6 flex flex-col gap-2 border-t border-stroke pt-4">
          {confirmDelete ? (
            <>
              <Notice tone="warning">{t('tg.receiptDeleteConfirm')}</Notice>
              {error && !form ? <Notice tone="danger">{error}</Notice> : null}
              <Button
                variant="danger"
                className="w-full"
                loading={busy}
                onClick={() => void remove()}
              >
                {t('tg.receiptDeleteYes')}
              </Button>
              <Button
                variant="ghost"
                className="w-full"
                disabled={busy}
                onClick={() => setConfirmDelete(false)}
              >
                {t('tg.cancel')}
              </Button>
            </>
          ) : (
            <Button
              variant="ghost"
              className="w-full text-danger-text"
              disabled={busy}
              onClick={() => {
                haptic.tap(app);
                setConfirmDelete(true);
              }}
            >
              {t('tg.receiptDelete')}
            </Button>
          )}
        </section>
      ) : null}
    </Sheet>
  );
}
