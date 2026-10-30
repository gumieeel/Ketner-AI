import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { buttonClasses } from '@/components/ui/button-classes';
import { Modal } from '@/components/ui/modal';
import { useAuth } from '@/features/auth/auth-store';
import {
  createAnalysis,
  DiscoveryApiError,
  fetchOffer,
  newIdempotencyKey,
  type AnalysisMode,
  type Offer,
  type PaidOffer,
} from '@/features/discovery/api';
import { clearDraft, readDraft } from '@/features/discovery/draft';
import { creditsText, priceText, resetTimeText } from '@/features/discovery/format';
import { useTranslation, type TranslationKey } from '@/i18n';
import { siteFeatures } from '@/lib/features';
import { storage } from '@/lib/storage';
import { NotFoundPage } from '@/pages/not-found-page';
import { ErrorNotice } from './error-notice';

const START_KEY = 'discovery.start';

/**
 * Ключ идемпотентности запуска живёт, пока не изменились описание и режим: повторное нажатие,
 * перезагрузка или обрыв сети возвращают уже созданный анализ, а не запускают второй.
 */
function startKey(text: string, mode: AnalysisMode): string {
  try {
    const saved = JSON.parse(storage.get(START_KEY) ?? 'null') as {
      key?: string;
      text?: string;
      mode?: string;
    } | null;
    if (saved?.key && saved.text === text && saved.mode === mode) return saved.key;
  } catch {
    /* повреждённая запись — новый ключ */
  }
  const key = newIdempotencyKey();
  storage.set(START_KEY, JSON.stringify({ key, text, mode }));
  return key;
}

/** Начало анализа: описание с главной, что доступно сейчас и сколько стоит. */
export function AnalysisNewPage() {
  const translator = useTranslation();
  const { t, language } = translator;
  const navigate = useNavigate();
  const authStatus = useAuth((state) => state.status);
  const [draft] = useState(readDraft);
  const [offer, setOffer] = useState<Offer | null>(null);
  const [offerFailed, setOfferFailed] = useState(false);
  const [starting, setStarting] = useState<AnalysisMode | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [confirmDeep, setConfirmDeep] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchOffer(language).then(
      (value) => alive && setOffer(value),
      () => alive && setOfferFailed(true),
    );
    return () => {
      alive = false;
    };
  }, [language, authStatus]);

  if (!siteFeatures().discovery) return <NotFoundPage />;

  if (!draft) {
    return (
      <Shell title={t('analysis.new.emptyTitle')} lead={t('analysis.new.emptyLead')}>
        <div className="mt-8">
          <Link to="/" className={buttonClasses({ variant: 'primary', size: 'md' })}>
            {t('analysis.new.describe')}
          </Link>
        </div>
      </Shell>
    );
  }

  const start = async (mode: AnalysisMode, confirm = false) => {
    setStarting(mode);
    setError(null);
    try {
      const analysis = await createAnalysis(
        { text: draft.text, language, ...(mode === 'free' ? {} : { mode }), confirm },
        startKey(draft.text, mode),
      );
      clearDraft();
      storage.remove(START_KEY);
      navigate(`/analyses/${analysis.id}`, { replace: true });
    } catch (caught) {
      setStarting(null);
      if (caught instanceof DiscoveryApiError && caught.code === 'confirmation_required') {
        setConfirmDeep(true);
        return;
      }
      if (caught instanceof DiscoveryApiError && caught.code === 'free_unavailable') {
        // Пока человек читал страницу, бесплатный анализ стал недоступен — показываем почему.
        fetchOffer(language).then(setOffer, () => undefined);
      }
      // Отказ — новая попытка с новым ключом (сервер не создал анализ).
      storage.remove(START_KEY);
      setError(caught);
    }
  };

  const loginHref = `/login?redirect=${encodeURIComponent('/analyses/new')}`;
  const free = offer?.free;

  return (
    <Shell title={t('analysis.new.title')} lead={t('analysis.new.lead')}>
      <figure className="mt-8 rounded-xl border border-stroke bg-surface px-5 py-4">
        <figcaption className="flex items-center justify-between gap-3 text-[13px] text-subtle">
          {t('analysis.new.yourText')}
          <Link to="/" className="text-muted underline underline-offset-4 hover:text-text">
            {t('analysis.new.edit')}
          </Link>
        </figcaption>
        <blockquote className="mt-2 max-h-60 overflow-y-auto text-[16px] leading-[1.6] break-words whitespace-pre-wrap text-text">
          {draft.text}
        </blockquote>
      </figure>

      <div className="mt-8 flex flex-col gap-4" aria-live="polite">
        {!offer && !offerFailed ? (
          <p className="text-[14px] text-muted">{t('analysis.new.loadingOffer')}</p>
        ) : null}
        {offerFailed && !offer ? <ErrorNotice error={null} redirect="/analyses/new" /> : null}

        {free?.available ? (
          <section className="rounded-xl border border-accent/30 bg-accent-soft/40 px-5 py-4">
            <h2 className="text-[16px] font-medium text-text">{t('analysis.new.freeTitle')}</h2>
            <p className="mt-1 text-[14px] leading-6 text-muted">
              {t('analysis.new.freeNote', { model: free.model })}
            </p>
            <Button
              className="mt-4 max-sm:w-full"
              disabled={starting !== null}
              onClick={() => void start('free')}
            >
              {starting === 'free' ? t('analysis.new.starting') : t('analysis.new.start')}
            </Button>
          </section>
        ) : null}

        {free && !free.available ? (
          <div className="rounded-xl border border-warning/25 bg-warning-soft px-4 py-3 text-[14px] leading-6 text-text">
            <p>{t(`analysis.new.free.${free.reason}` as TranslationKey)}</p>
            <p className="text-muted">
              {t('analysis.new.resetsAt', { time: resetTimeText(language, free.resetsAt) })}
            </p>
          </div>
        ) : null}

        {error ? <ErrorNotice error={error} redirect="/analyses/new" /> : null}

        {offer ? (
          <PaidOptions
            offer={offer}
            collapsed={offer.free.available}
            starting={starting}
            loginHref={loginHref}
            onStart={(mode) => {
              if (mode === 'deep' && offer.deep.confirmationRequired) setConfirmDeep(true);
              else void start(mode);
            }}
          />
        ) : null}
      </div>

      {confirmDeep && offer ? (
        <Modal labelledBy="confirm-deep-title" size="sm" onClose={() => setConfirmDeep(false)}>
          <div className="flex flex-col gap-4 p-6">
            <h2 id="confirm-deep-title" className="text-[18px] font-medium text-text">
              {t('analysis.new.confirmTitle')}
            </h2>
            <p className="text-[14px] leading-6 text-muted">
              {t('analysis.new.confirmText', {
                model: offer.deep.model,
                typical: `≈ ${creditsText(translator, offer.deep.typicalCredits)}`,
                max: creditsText(translator, offer.deep.maxCredits),
              })}
            </p>
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <Button variant="outline" onClick={() => setConfirmDeep(false)}>
                {t('analysis.new.cancel')}
              </Button>
              <Button
                onClick={() => {
                  setConfirmDeep(false);
                  void start('deep', true);
                }}
              >
                {t('analysis.new.confirm')}
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}
    </Shell>
  );
}

function PaidOptions({
  offer,
  collapsed,
  starting,
  loginHref,
  onStart,
}: {
  offer: Offer;
  collapsed: boolean;
  starting: AnalysisMode | null;
  loginHref: string;
  onStart: (mode: 'paid' | 'deep') => void;
}) {
  const translator = useTranslation();
  const { t } = translator;
  const option = (mode: 'paid' | 'deep', item: PaidOffer) => (
    <div
      key={mode}
      className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="min-w-0">
        <h3 className="text-[15px] font-medium text-text">
          {t(mode === 'paid' ? 'analysis.new.paidTitle' : 'analysis.new.deepTitle')}
        </h3>
        <p className="text-[14px] leading-6 text-muted">
          {t(mode === 'paid' ? 'analysis.new.paidNote' : 'analysis.new.deepNote', {
            model: item.model,
          })}{' '}
          <span className="text-text">
            {priceText(translator, item.typicalCredits, item.maxCredits)}
          </span>
        </p>
      </div>
      {item.loginRequired ? (
        <Link
          to={loginHref}
          className={buttonClasses({ variant: 'outline', size: 'md', className: 'shrink-0' })}
        >
          {t('analysis.new.loginToRun')}
        </Link>
      ) : (
        <Button
          variant={collapsed ? 'outline' : 'primary'}
          className="shrink-0"
          disabled={starting !== null}
          onClick={() => onStart(mode)}
        >
          {starting === mode
            ? t('analysis.new.starting')
            : t(mode === 'paid' ? 'analysis.new.runPaid' : 'analysis.new.runDeep')}
        </Button>
      )}
    </div>
  );
  const items = (
    <>
      <div className="divide-y divide-stroke">
        {option('paid', offer.paid)}
        {option('deep', offer.deep)}
      </div>
      <p className="pt-1 text-[13px] leading-5 text-subtle">{t('analysis.new.priceHint')}</p>
    </>
  );
  if (!collapsed) return <section className="px-1">{items}</section>;
  return (
    <details className="group rounded-xl border border-stroke px-5 py-3">
      <summary className="cursor-pointer list-none text-[14px] font-medium text-muted marker:hidden hover:text-text">
        {t('analysis.new.otherOptions')}
      </summary>
      <div className="mt-1">{items}</div>
    </details>
  );
}

function Shell({ title, lead, children }: { title: string; lead: string; children: ReactNode }) {
  return (
    <section
      aria-labelledby="analysis-new-title"
      className="mx-auto flex w-full max-w-[40rem] flex-col px-4 pt-[clamp(3rem,10vh,6rem)] pb-20 sm:px-6"
    >
      <h1
        id="analysis-new-title"
        className="text-[clamp(1.75rem,1.6vw+1.25rem,2.375rem)] leading-tight font-[480] tracking-[-0.03em] text-text"
      >
        {title}
      </h1>
      <p className="t-lead mt-4">{lead}</p>
      {children}
    </section>
  );
}
