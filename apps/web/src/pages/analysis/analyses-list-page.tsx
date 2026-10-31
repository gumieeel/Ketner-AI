import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { buttonClasses } from '@/components/ui/button-classes';
import { Modal } from '@/components/ui/modal';
import { Spinner } from '@/components/ui/spinner';
import { useAuth } from '@/features/auth/auth-store';
import {
  deleteAnalysis,
  listAnalyses,
  type AnalysisListItem,
  type AnalysisStatus,
} from '@/features/discovery/api';
import { useTranslation, type TranslationKey } from '@/i18n';
import { formatDateTime } from '@/lib/format-date';
import { siteFeatures } from '@/lib/features';
import { NotFoundPage } from '@/pages/not-found-page';
import { ErrorNotice } from './error-notice';

type Load =
  | { state: 'loading' }
  | { state: 'error'; error: unknown }
  | { state: 'ready'; items: AnalysisListItem[] };

/** «Мои анализы»: сохранённые сверху, затем остальные; открыть, удалить. */
export function AnalysesListPage() {
  const { t } = useTranslation();
  const authStatus = useAuth((state) => state.status);
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [removing, setRemoving] = useState<AnalysisListItem | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLoad({ state: 'ready', items: await listAnalyses() });
    } catch (error) {
      setLoad({ state: 'error', error });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, authStatus]);

  if (!siteFeatures().discovery) return <NotFoundPage />;

  const items = load.state === 'ready' ? load.items : [];
  const saved = items.filter((item) => item.saved);
  const recent = items.filter((item) => !item.saved);

  return (
    <section
      aria-labelledby="analyses-title"
      className="mx-auto flex w-full max-w-[44rem] flex-col px-4 pt-[clamp(2.5rem,8vh,5rem)] pb-20 sm:px-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1
          id="analyses-title"
          className="text-[clamp(1.75rem,1.6vw+1.25rem,2.375rem)] leading-tight font-[480] tracking-[-0.03em] text-text"
        >
          {t('analysis.list.title')}
        </h1>
        <Link to="/" className={buttonClasses({ variant: 'primary', size: 'md' })}>
          {t('analysis.page.newAnalysis')}
        </Link>
      </div>
      {authStatus !== 'authenticated' ? (
        <p className="mt-4 text-[14px] leading-6 text-muted">
          {t('analysis.list.guestNote')}{' '}
          <Link
            to={`/login?redirect=${encodeURIComponent('/analyses')}`}
            className="text-text underline underline-offset-4"
          >
            {t('analysis.error.login')}
          </Link>
        </p>
      ) : null}

      {load.state === 'loading' ? (
        <p className="mt-8 flex items-center gap-2 text-[14px] text-muted">
          <Spinner /> {t('analysis.list.loading')}
        </p>
      ) : null}
      {load.state === 'error' ? (
        <div className="mt-8">
          <ErrorNotice error={load.error} redirect="/analyses" />
        </div>
      ) : null}
      {load.state === 'ready' && items.length === 0 ? (
        <p className="mt-8 text-[15px] leading-6 text-muted">{t('analysis.list.empty')}</p>
      ) : null}

      {saved.length > 0 ? (
        <Group title={t('analysis.list.saved')} items={saved} onRemove={setRemoving} />
      ) : null}
      {recent.length > 0 ? (
        <Group title={t('analysis.list.recent')} items={recent} onRemove={setRemoving} />
      ) : null}

      {removing ? (
        <RemoveDialog
          item={removing}
          onClose={() => setRemoving(null)}
          onRemoved={async () => {
            setRemoving(null);
            await refresh();
          }}
        />
      ) : null}
    </section>
  );
}

const STATUS_KEY: Record<AnalysisStatus, TranslationKey> = {
  analyzing: 'analysis.list.status.running',
  discovering: 'analysis.list.status.running',
  needs_answers: 'analysis.list.status.needs_answers',
  ready: 'analysis.list.status.ready',
  failed: 'analysis.list.status.failed',
};

function Group({
  title,
  items,
  onRemove,
}: {
  title: string;
  items: AnalysisListItem[];
  onRemove: (item: AnalysisListItem) => void;
}) {
  const { t, language } = useTranslation();
  return (
    <section className="mt-10">
      <h2 className="text-[18px] font-medium text-text">{title}</h2>
      <ul className="mt-3 flex flex-col gap-3">
        {items.map((item) => (
          <li
            key={item.id}
            className="flex flex-col gap-3 rounded-xl border border-stroke bg-surface px-5 py-4 sm:flex-row sm:items-start sm:justify-between"
          >
            <div className="min-w-0">
              <Link
                to={`/analyses/${item.id}`}
                className="text-[16px] leading-6 font-medium text-text underline-offset-4 hover:underline"
              >
                {item.title}
              </Link>
              <p className="mt-1 line-clamp-2 text-[14px] leading-6 break-words text-muted">
                {item.excerpt}
              </p>
              <p className="mt-1 text-[13px] text-subtle">
                {t(STATUS_KEY[item.status])} · {formatDateTime(item.createdAt, language)}
              </p>
            </div>
            {item.status === 'analyzing' || item.status === 'discovering' ? null : (
              <Button
                variant="ghost"
                size="sm"
                className="shrink-0 self-start"
                aria-label={`${t('analysis.list.delete')}: ${item.title}`}
                onClick={() => onRemove(item)}
              >
                {t('analysis.list.delete')}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function RemoveDialog({
  item,
  onClose,
  onRemoved,
}: {
  item: AnalysisListItem;
  onClose: () => void;
  onRemoved: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  return (
    <Modal labelledBy="remove-analysis-title" size="sm" onClose={onClose}>
      <div className="flex flex-col gap-4 p-6">
        <h2 id="remove-analysis-title" className="text-[18px] font-medium text-text">
          {t('analysis.list.confirmTitle')}
        </h2>
        <p className="text-[14px] leading-6 text-muted">
          {t('analysis.list.confirmText', { title: item.title })}
        </p>
        {error ? <ErrorNotice error={error} redirect="/analyses" /> : null}
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={onClose}>
            {t('analysis.new.cancel')}
          </Button>
          <Button
            variant="danger"
            loading={busy}
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setError(null);
              deleteAnalysis(item.id)
                .then(onRemoved)
                .catch((caught: unknown) => {
                  setError(caught);
                  setBusy(false);
                });
            }}
          >
            {t('analysis.list.delete')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
