import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowRightIcon } from '@/components/icons';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { buttonClasses } from '@/components/ui/button-classes';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/features/auth/auth-store';
import { DiscoveryApiError } from '@/features/discovery/api';
import {
  fetchMyRequest,
  formatKztRange,
  listMyRequests,
  requestAction,
  type RequestStatus,
  type RequestView,
} from '@/features/pricing/api';
import { useTranslation, type TranslationKey } from '@/i18n';
import { useDocumentTitle } from '@/lib/use-document-title';
import { formatShortDate as formatDate } from '@/lib/format-date';
import { Disclaimer, EstimateDetails, EstimateSummary } from '@/pages/analysis/estimate';
import { ErrorNotice } from '@/pages/analysis/error-notice';

const STATUS_TONE: Partial<Record<RequestStatus, BadgeTone>> = {
  proposal_sent: 'brand',
  approved: 'success',
  in_progress: 'info',
  testing: 'info',
  completed: 'success',
  rejected: 'danger',
  cancelled: 'neutral',
  clarification_needed: 'warning',
};

export function StatusBadge({ status }: { status: RequestStatus }) {
  const { t } = useTranslation();
  return (
    <Badge tone={STATUS_TONE[status] ?? 'outline'}>
      {t(`requests.status.${status}` as TranslationKey)}
    </Badge>
  );
}

function LoginFirst({ redirect }: { redirect: string }) {
  const { t } = useTranslation();
  return (
    <div className="rounded-2xl border border-stroke bg-surface px-5 py-6">
      <p className="text-[15px] text-text">{t('requests.loginRequired')}</p>
      <Link
        to={`/login?redirect=${encodeURIComponent(redirect)}`}
        className={buttonClasses({ variant: 'primary', size: 'md', className: 'mt-4' })}
      >
        {t('estimate.loginAction')}
      </Link>
    </div>
  );
}

/** «Мои заявки»: заявки на внедрение со статусами. */
export function RequestsPage() {
  const { t, language } = useTranslation();
  useDocumentTitle(t('requests.title'));
  const user = useAuth((state) => state.user);
  const [items, setItems] = useState<RequestView[] | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    listMyRequests()
      .then((list) => alive && setItems(list))
      .catch((caught) => alive && setError(caught));
    return () => {
      alive = false;
    };
  }, [user]);

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6">
      <h1 className="text-[28px] font-medium tracking-[-0.02em] text-text">
        {t('requests.title')}
      </h1>
      <p className="mt-2 text-[15px] leading-6 text-muted">{t('requests.subtitle')}</p>
      <div className="mt-6">
        {!user ? (
          <LoginFirst redirect="/requests" />
        ) : error ? (
          <ErrorNotice error={error} redirect="/requests" />
        ) : items === null ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-2xl border border-stroke bg-surface px-5 py-6">
            <p className="text-[15px] text-text">{t('requests.empty')}</p>
            <Link
              to="/"
              className={buttonClasses({ variant: 'primary', size: 'md', className: 'mt-4' })}
            >
              {t('requests.startAnalysis')}
            </Link>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {items.map((item) => (
              <li key={item.id}>
                <Link
                  to={`/requests/${item.id}`}
                  className="flex flex-col gap-2 rounded-2xl border border-stroke bg-surface px-5 py-4 hover:border-stroke-strong sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[15px] font-medium text-text">
                      {Object.values(item.opportunityTitles).join(' · ')}
                    </p>
                    <p className="mt-1 text-[13px] text-muted">
                      {formatDate(item.createdAt, language)}
                      {(item.proposal?.priceKzt ?? item.preliminary.priceKzt)
                        ? ` · ${formatKztRange((item.proposal?.priceKzt ?? item.preliminary.priceKzt)!, language)}`
                        : ''}
                    </p>
                  </div>
                  <span className="flex items-center gap-2">
                    <StatusBadge status={item.status} />
                    <ArrowRightIcon aria-hidden="true" className="size-4 text-muted" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}

/** Заявка: статус, предварительная смета (снимок), коммерческое предложение, действия. */
export function RequestPage() {
  const { t, language } = useTranslation();
  useDocumentTitle(t('requests.detailTitle'));
  const { requestId = '' } = useParams();
  const user = useAuth((state) => state.user);
  const [request, setRequest] = useState<RequestView | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    try {
      setRequest(await fetchMyRequest(requestId));
    } catch (caught) {
      if (caught instanceof DiscoveryApiError && caught.status === 404) setNotFound(true);
      else setError(caught);
    }
  }, [requestId]);

  useEffect(() => {
    if (user) void load();
  }, [user, load]);

  const act = async (action: 'cancel' | 'accept') => {
    setBusy(true);
    setError(null);
    try {
      setRequest(await requestAction(requestId, action));
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };

  const redirect = `/requests/${requestId}`;
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
      <Link to="/requests" className="text-[14px] text-muted hover:text-text">
        ← {t('requests.back')}
      </Link>
      {!user ? (
        <div className="mt-6">
          <LoginFirst redirect={redirect} />
        </div>
      ) : notFound ? (
        <p className="mt-6 text-[15px] text-text">{t('requests.notFound')}</p>
      ) : !request ? (
        error ? (
          <div className="mt-6">
            <ErrorNotice error={error} redirect={redirect} />
          </div>
        ) : (
          <Skeleton className="mt-6 h-40 w-full" />
        )
      ) : (
        <div className="mt-4 flex flex-col gap-5">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-[24px] font-medium tracking-[-0.01em] text-text">
              {Object.values(request.opportunityTitles).join(' · ')}
            </h1>
            <StatusBadge status={request.status} />
          </div>
          <p className="text-[14px] leading-6 text-muted">
            {t(`requests.statusHint.${request.status}` as TranslationKey)}
          </p>

          {request.proposal ? (
            <section className="rounded-2xl border border-accent/60 bg-surface px-5 py-5">
              <h2 className="text-[17px] font-medium text-text">{t('requests.proposal')}</h2>
              <p className="mt-2 text-[22px] font-medium text-text tabular-nums">
                {formatKztRange(request.proposal.priceKzt, language)}
              </p>
              <p className="mt-1 text-[14px] text-muted">
                {t('estimate.days', {
                  from: request.proposal.workingDays[0],
                  to: request.proposal.workingDays[1],
                })}
              </p>
              {request.proposal.customerNote ? (
                <p className="mt-3 text-[14px] leading-6 whitespace-pre-line text-text">
                  {request.proposal.customerNote}
                </p>
              ) : null}
            </section>
          ) : null}

          <section className="rounded-2xl border border-stroke bg-surface px-5 py-5">
            <h2 className="text-[17px] font-medium text-text">{t('requests.preliminary')}</h2>
            <p className="mt-1 text-[13px] text-subtle">
              {t('requests.snapshotNote', {
                date: formatDate(request.preliminary.calculatedAt, language),
              })}
            </p>
            <EstimateSummary estimate={request.preliminary} />
            <EstimateDetails estimate={request.preliminary} />
          </section>

          {request.customerMessage ? (
            <section className="rounded-2xl border border-stroke bg-surface px-5 py-4">
              <h2 className="text-[14px] font-medium text-subtle">{t('requests.yourMessage')}</h2>
              <p className="mt-1 text-[15px] leading-6 whitespace-pre-line text-text">
                {request.customerMessage}
              </p>
            </section>
          ) : null}

          {error ? <ErrorNotice error={error} redirect={redirect} /> : null}
          <div className="flex flex-wrap gap-3">
            {request.canAccept ? (
              <Button onClick={() => void act('accept')} disabled={busy}>
                {t('requests.accept')}
              </Button>
            ) : null}
            {request.canCancel ? (
              <Button variant="outline" onClick={() => void act('cancel')} disabled={busy}>
                {t('requests.cancel')}
              </Button>
            ) : null}
            {request.analysisId ? (
              <Link
                to={`/analyses/${request.analysisId}`}
                className={buttonClasses({ variant: 'ghost', size: 'md' })}
              >
                {t('requests.openAnalysis')}
              </Link>
            ) : null}
          </div>
          {!request.proposal ? <Disclaimer /> : null}
        </div>
      )}
    </main>
  );
}
