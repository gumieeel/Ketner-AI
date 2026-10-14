import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { CheckIcon, ShieldIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError, miniAppApi, type AdminRefund } from '@/features/telegram/api';
import { haptic } from '@/features/telegram/webapp';
import { useTranslation } from '@/i18n';
import { formatAmount, formatDateTime, Notice, Panel, SectionTitle, useMiniApp } from './shared';

/** Заявки на возврат: одобрить (звёзды вернутся сами) или отказать с пояснением. */
export function AdminTab() {
  const { t } = useTranslation();
  const { token, refresh, notify, app } = useMiniApp();
  const [refunds, setRefunds] = useState<AdminRefund[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // t меняется при смене языка — список из-за этого заново не грузим.
  const tRef = useRef(t);
  tRef.current = t;

  const load = useCallback(async () => {
    setError(null);
    try {
      setRefunds((await miniAppApi.adminRefunds(token)).refunds);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : tRef.current('tg.errorGeneric'));
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const decided = async (approve: boolean) => {
    haptic.success(app);
    notify('success', approve ? t('tg.adminApproved') : t('tg.adminDeclined'));
    await Promise.all([load(), refresh()]);
  };

  return (
    <div className="flex flex-col gap-3">
      <SectionTitle aside={refunds ? String(refunds.length) : undefined}>{t('tg.adminWaiting')}</SectionTitle>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {refunds === null && !error ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          <Skeleton className="h-36 w-full" />
          <Skeleton className="h-36 w-full" />
        </div>
      ) : null}
      {refunds?.length === 0 ? (
        <Panel className="flex flex-col items-center gap-2 py-8 text-center">
          <span className="grid size-12 place-items-center rounded-full bg-accent-soft text-accent">
            <CheckIcon className="size-5" />
          </span>
          <p className="text-[15px] font-medium">{t('tg.adminEmpty')}</p>
        </Panel>
      ) : null}
      {refunds?.map((refund) => <RefundCard key={refund.id} refund={refund} onDecided={decided} />)}
    </div>
  );
}

function RefundCard({ refund, onDecided }: { refund: AdminRefund; onDecided: (approve: boolean) => Promise<void> }) {
  const { t, language } = useTranslation();
  const { token, app } = useMiniApp();
  const noteId = useId();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'approve' | 'decline' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const who = refund.customer
    ? [refund.customer.name, refund.customer.email, refund.customer.telegramUsername ? `@${refund.customer.telegramUsername}` : null]
        .filter(Boolean)
        .join(' · ')
    : t('tg.adminUnknown');

  const decide = async (approve: boolean) => {
    setBusy(approve ? 'approve' : 'decline');
    setError(null);
    try {
      await miniAppApi.adminDecide(token, refund.id, approve, note.trim());
      await onDecided(approve);
    } catch (caught) {
      haptic.error(app);
      setError(caught instanceof ApiError ? caught.message : t('tg.errorGeneric'));
      setBusy(null);
    }
  };

  return (
    <Panel className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-[15px] font-semibold">
            <ShieldIcon className="size-4 text-warning" />
            {refund.planTitle} · {formatAmount(refund, language)}
          </p>
          <p className="mt-0.5 truncate text-[13px] text-muted">{who}</p>
        </div>
        <span className="shrink-0 text-[12px] text-subtle">{formatDateTime(refund.paidAt, language)}</span>
      </div>
      <dl className="flex flex-col gap-1 rounded-lg bg-surface-2 px-3 py-2 text-[13px] leading-5">
        <div className="flex gap-2">
          <dt className="text-muted">{t('tg.fieldMethod')}:</dt>
          <dd>{refund.method === 'stars' ? 'Telegram Stars' : t('tg.methodCrypto')}</dd>
        </div>
        {refund.refund?.reason ? (
          <div className="flex gap-2">
            <dt className="text-muted">{t('tg.fieldReason')}:</dt>
            <dd>{refund.refund.reason}</dd>
          </div>
        ) : null}
        {refund.refund?.comment ? (
          <div className="flex gap-2">
            <dt className="text-muted">{t('tg.fieldComment')}:</dt>
            <dd className="min-w-0 break-words">{refund.refund.comment}</dd>
          </div>
        ) : null}
        <div className="flex gap-2">
          <dt className="text-muted">{t('tg.fieldUsed')}:</dt>
          <dd className={refund.usedRequests > 0 ? 'font-medium text-danger' : undefined}>
            {refund.usedRequests > 0 ? t('tg.adminUsedYes', { count: refund.usedRequests }) : t('tg.adminUsedNo')}
          </dd>
        </div>
        {refund.refund?.requestedAt ? (
          <div className="flex gap-2">
            <dt className="text-muted">{t('tg.fieldRequested')}:</dt>
            <dd>{formatDateTime(refund.refund.requestedAt, language)}</dd>
          </div>
        ) : null}
      </dl>
      {refund.method === 'crypto' ? <p className="text-[12px] leading-5 text-subtle">{t('tg.adminCryptoHint')}</p> : null}
      <div className="flex flex-col gap-1.5">
        <label htmlFor={noteId} className="text-[13px] font-medium">
          {t('tg.adminNote')}
        </label>
        <Input id={noteId} value={note} maxLength={300} onChange={(event) => setNote(event.target.value)} placeholder={t('tg.adminNotePlaceholder')} />
      </div>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <div className="flex gap-2">
        <Button className="flex-1" loading={busy === 'approve'} disabled={busy !== null} onClick={() => void decide(true)}>
          {t('tg.adminApprove')}
        </Button>
        <Button variant="outline" className="flex-1" loading={busy === 'decline'} disabled={busy !== null} onClick={() => void decide(false)}>
          {t('tg.adminDecline')}
        </Button>
      </div>
    </Panel>
  );
}
