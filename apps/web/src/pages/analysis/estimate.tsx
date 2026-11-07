import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ChevronDownIcon, ClockIcon, FileTextIcon, InfoIcon } from '@/components/icons';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { buttonClasses } from '@/components/ui/button-classes';
import { Field, Input } from '@/components/ui/input';
import { Modal, ModalHeader } from '@/components/ui/modal';
import { useAuth } from '@/features/auth/auth-store';
import { newIdempotencyKey } from '@/features/discovery/api';
import {
  createImplementationRequest,
  formatKzt,
  formatKztRange,
  formatUsdCents,
  type Confidence,
  type EstimateView,
  type RequestView,
} from '@/features/pricing/api';
import { useTranslation, type TranslationKey } from '@/i18n';
import { cn } from '@/lib/cn';
import { ErrorNotice } from './error-notice';

const CONFIDENCE_TONE: Record<Confidence, BadgeTone> = {
  high: 'success',
  medium: 'info',
  low: 'warning',
};

/**
 * Предварительная стоимость внедрения в карточке возможности: диапазон, срок, уверенность.
 * Все числа посчитаны сервером по каталогу работ и настройкам; здесь ничего не считается.
 */
export function EstimateSummary({ estimate }: { estimate: EstimateView }) {
  const { t, language } = useTranslation();
  return (
    <div className="mt-3 rounded-xl border border-stroke bg-surface-2/60 px-4 py-3">
      <p className="text-[13px] text-subtle">{t('estimate.preliminary')}</p>
      {estimate.priceKzt ? (
        <p className="mt-0.5 text-[20px] font-medium tracking-[-0.01em] text-text tabular-nums">
          {formatKztRange(estimate.priceKzt, language)}
        </p>
      ) : (
        <p className="mt-0.5 text-[15px] font-medium text-text">
          {estimate.pricingDisabled ? t('estimate.disabled') : t('estimate.reviewRequired')}
        </p>
      )}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px] text-muted">
        {estimate.workingDays ? (
          <span className="inline-flex items-center gap-1.5">
            <ClockIcon aria-hidden="true" className="size-4" />
            {t('estimate.days', { from: estimate.workingDays.min, to: estimate.workingDays.max })}
          </span>
        ) : null}
        <Badge tone={CONFIDENCE_TONE[estimate.confidence]}>
          {t(`estimate.confidence.${estimate.confidence}` as TranslationKey)}
        </Badge>
        {estimate.technicalVerificationRequired ? (
          <Badge tone="outline">{t('estimate.reviewRequired')}</Badge>
        ) : null}
      </div>
    </div>
  );
}

/** «Из чего складывается»: работы, отдельно оплачиваемое, допущения, неизвестные, оговорка. */
export function EstimateDetails({ estimate }: { estimate: EstimateView }) {
  const { t, language } = useTranslation();
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="mt-3">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex min-h-11 items-center gap-1 text-[14px] font-medium text-accent hover:underline md:min-h-0"
      >
        {open ? t('estimate.hideBreakdown') : t('estimate.showBreakdown')}
        <ChevronDownIcon
          aria-hidden="true"
          className={cn('size-4 transition-transform', open && 'rotate-180')}
        />
      </button>
      <div id={id} hidden={!open} className="mt-3 flex flex-col gap-4 text-[14px] leading-6">
        {estimate.work.length > 0 ? (
          <Section title={t('estimate.included')}>
            <ul className="flex flex-col gap-2">
              {estimate.work.map((item) => (
                <li key={item.capabilityId}>
                  <span className="text-text">
                    {item.name[language]}
                    {item.quantity > 1 ? ` × ${item.quantity}` : ''}
                  </span>
                  <span className="text-subtle">
                    {' · '}
                    {t(`estimate.complexity.${item.complexity}` as TranslationKey)}
                    {item.shared ? ` · ${t('estimate.shared')}` : ''}
                    {item.requiresManualReview ? ` · ${t('estimate.needsCheck')}` : ''}
                  </span>
                  {item.includes.length > 0 ? (
                    <span className="block text-muted">{item.includes.join('; ')}</span>
                  ) : null}
                </li>
              ))}
              {estimate.projectWork.map((name) => (
                <li key={name.en} className="text-text">
                  {name[language]}
                </li>
              ))}
            </ul>
          </Section>
        ) : null}
        {estimate.excluded.length > 0 ? (
          <Section title={t('estimate.excludedTitle')}>
            <ul className="flex flex-col gap-1">
              {estimate.excluded.map((item) => (
                <li key={item.capabilityId} className="text-muted">
                  {item.name ?? item.capabilityId}
                  {' — '}
                  {t(`estimate.excluded.${item.reason}` as TranslationKey)}
                </li>
              ))}
            </ul>
          </Section>
        ) : null}
        <Section title={t('estimate.separately')}>
          <MonthlyCosts estimate={estimate} />
        </Section>
        {estimate.assumptions.length > 0 ? (
          <Section title={t('estimate.assumptions')}>
            <Bullets items={estimate.assumptions} />
          </Section>
        ) : null}
        {estimate.unknowns.length > 0 ? (
          <Section title={t('estimate.unknowns')}>
            <Bullets items={estimate.unknowns} />
          </Section>
        ) : null}
        {estimate.exclusions.length > 0 ? (
          <Section title={t('estimate.exclusions')}>
            <Bullets items={estimate.exclusions} />
          </Section>
        ) : null}
        {estimate.externalApproval ? (
          <p className="text-muted">{t('estimate.externalApproval')}</p>
        ) : null}
        <p className="text-muted">
          {t('estimate.whyRange')}
          {estimate.minimumApplied ? ` ${t('estimate.minimumApplied')}` : ''}
        </p>
        <Disclaimer />
      </div>
    </div>
  );
}

function MonthlyCosts({ estimate }: { estimate: EstimateView }) {
  const { t, language } = useTranslation();
  const usage = estimate.monthly.usage;
  return (
    <ul className="flex flex-col gap-1.5">
      {estimate.monthly.recurring.map((item) => (
        <li key={item.kind}>
          <span className="text-text">
            {t(`estimate.recurring.${item.kind}` as TranslationKey)}:{' '}
          </span>
          <span className="tabular-nums text-text">
            {item.amount.kzt !== null
              ? t('estimate.perMonth', { amount: formatKzt(item.amount.kzt, language) })
              : item.amount.usdCents !== null
                ? t('estimate.perMonth', { amount: formatUsdCents(item.amount.usdCents) })
                : '—'}
          </span>
          {item.monthlyCredits ? (
            <span className="text-muted">
              {' '}
              {t('estimate.includesCredits', {
                credits: item.monthlyCredits.toLocaleString('ru-RU'),
              })}
            </span>
          ) : null}
        </li>
      ))}
      <li>
        <span className="text-text">{t('estimate.aiUsage')}: </span>
        <span className="text-muted">
          {usage.status === 'forecast' && usage.aiKzt
            ? t('estimate.forecastRange', { range: formatKztRange(usage.aiKzt, language) })
            : usage.status === 'forecast' && usage.aiUsdCents
              ? t('estimate.forecastRange', {
                  range: `${formatUsdCents(usage.aiUsdCents.min)}–${formatUsdCents(usage.aiUsdCents.max)}`,
                })
              : t(`estimate.usage.${usage.status}` as TranslationKey)}
        </span>
      </li>
      {usage.externalProviderFees.length > 0 || estimate.unknownDirectCosts.length > 0 ? (
        <li className="text-muted">
          {t('estimate.providerFees', {
            names: [
              ...new Set([...usage.externalProviderFees, ...estimate.unknownDirectCosts]),
            ].join(', '),
          })}
        </li>
      ) : null}
    </ul>
  );
}

export function Disclaimer() {
  const { t } = useTranslation();
  return (
    <p className="flex items-start gap-2 rounded-xl bg-surface-2 px-3 py-2.5 text-[13px] leading-5 text-muted">
      <InfoIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      {t('estimate.disclaimer')}
    </p>
  );
}

/** «Если внедрять вместе»: общая смета нескольких возможностей. */
export function CombinedEstimate({
  estimate,
  analysisId,
}: {
  estimate: EstimateView;
  analysisId: string;
}) {
  const { t, language } = useTranslation();
  return (
    <section
      aria-labelledby="combined-title"
      className="rounded-2xl border border-stroke bg-surface px-5 py-5"
    >
      <h3 id="combined-title" className="text-[17px] font-medium text-text">
        {t('estimate.combinedTitle')}
      </h3>
      <p className="mt-1 text-[14px] leading-6 text-muted">
        {Object.values(estimate.opportunityTitles).join(' · ')}
      </p>
      <EstimateSummary estimate={estimate} />
      {estimate.sharedSavingsKzt ? (
        <p className="mt-2 text-[14px] leading-6 text-text">
          {t('estimate.savings', { amount: formatKzt(estimate.sharedSavingsKzt, language) })}
        </p>
      ) : null}
      <p className="mt-1 text-[13px] text-subtle">{t('estimate.notBundled')}</p>
      <div className="mt-3">
        <RequestQuoteButton analysisId={analysisId} estimate={estimate} />
      </div>
      <EstimateDetails estimate={estimate} />
    </section>
  );
}

/** «Запросить точную смету»: заявка со снимком сметы. Гостю — вход с возвратом на анализ. */
export function RequestQuoteButton({
  analysisId,
  estimate,
  secondary = false,
}: {
  analysisId: string;
  estimate: EstimateView;
  secondary?: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant={secondary ? 'outline' : 'primary'}
        size="sm"
        onClick={() => setOpen(true)}
        className="self-start"
      >
        <FileTextIcon aria-hidden="true" className="size-4" />
        {t('estimate.requestQuote')}
      </Button>
      {open ? (
        <RequestQuoteModal
          analysisId={analysisId}
          estimate={estimate}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

function RequestQuoteModal({
  analysisId,
  estimate,
  onClose,
}: {
  analysisId: string;
  estimate: EstimateView;
  onClose: () => void;
}) {
  const { t, language } = useTranslation();
  const location = useLocation();
  const user = useAuth((state) => state.user);
  const titleId = useId();
  const nameId = useId();
  const phoneId = useId();
  const messageId = useId();
  const [name, setName] = useState(user?.name ?? '');
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('');
  const [touched, setTouched] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [created, setCreated] = useState<RequestView | null>(null);
  const [key] = useState(() => newIdempotencyKey());

  const phoneValid = /^\+?[0-9 ()-]{6,24}$/.test(phone.trim());
  const nameValid = name.trim().length > 0;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (!phoneValid || !nameValid || sending) return;
    setSending(true);
    setError(null);
    try {
      const request = await createImplementationRequest(
        analysisId,
        {
          scopeKey: estimate.scopeKey,
          message: message.trim(),
          contact: { name: name.trim(), phone: phone.trim() },
        },
        key,
      );
      setCreated(request);
    } catch (caught) {
      setError(caught);
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal labelledBy={titleId} onClose={onClose} size="md">
      <ModalHeader
        titleId={titleId}
        title={t('estimate.requestQuote')}
        description={Object.values(estimate.opportunityTitles).join(' · ')}
        onClose={onClose}
      />
      <div className="overflow-y-auto px-5 py-5">
        {!user ? (
          <div className="flex flex-col gap-4">
            <p className="text-[15px] leading-6 text-text">{t('estimate.loginToRequest')}</p>
            <Link
              to={`/login?redirect=${encodeURIComponent(location.pathname)}`}
              className={buttonClasses({ variant: 'primary', size: 'md', className: 'self-start' })}
            >
              {t('estimate.loginAction')}
            </Link>
          </div>
        ) : created ? (
          <div className="flex flex-col gap-3" role="status">
            <p className="text-[15px] font-medium text-text">{t('estimate.requestCreated')}</p>
            <p className="text-[14px] leading-6 text-muted">
              {t('estimate.requestStatus', {
                status: t(`requests.status.${created.status}` as TranslationKey),
              })}
            </p>
            {created.preliminary.priceKzt ? (
              <p className="text-[14px] text-muted">
                {t('estimate.snapshotSaved', {
                  range: formatKztRange(created.preliminary.priceKzt, language),
                })}
              </p>
            ) : null}
            <Link
              to={`/requests/${created.id}`}
              className={buttonClasses({ variant: 'primary', size: 'md', className: 'self-start' })}
            >
              {t('estimate.openRequest')}
            </Link>
          </div>
        ) : (
          <form onSubmit={submit} noValidate className="flex flex-col gap-4">
            <p className="text-[14px] leading-6 text-muted">{t('estimate.requestIntro')}</p>
            <Field
              label={t('estimate.contactName')}
              id={nameId}
              error={touched && !nameValid ? t('estimate.nameRequired') : undefined}
            >
              {(props) => (
                <Input
                  {...props}
                  value={name}
                  autoComplete="name"
                  onChange={(event) => setName(event.target.value)}
                  maxLength={100}
                />
              )}
            </Field>
            <Field
              label={t('estimate.contactPhone')}
              id={phoneId}
              error={touched && !phoneValid ? t('estimate.phoneInvalid') : undefined}
            >
              {(props) => (
                <Input
                  {...props}
                  value={phone}
                  type="tel"
                  autoComplete="tel"
                  placeholder="+7 700 000 00 00"
                  onChange={(event) => setPhone(event.target.value)}
                  maxLength={24}
                />
              )}
            </Field>
            <div className="flex flex-col gap-1.5">
              <label htmlFor={messageId} className="text-[13px] font-medium text-text">
                {t('estimate.message')}
              </label>
              <textarea
                id={messageId}
                value={message}
                maxLength={2000}
                rows={4}
                onChange={(event) => setMessage(event.target.value)}
                className="w-full rounded-xl border border-stroke bg-surface px-4 py-3 text-[15px] text-text placeholder:text-subtle focus:border-accent focus:ring-2 focus:ring-accent-soft focus:outline-none"
                placeholder={t('estimate.messagePlaceholder')}
              />
            </div>
            {error ? <ErrorNotice error={error} redirect={location.pathname} /> : null}
            <Disclaimer />
            <Button type="submit" disabled={sending} className="self-start">
              {sending ? t('estimate.sending') : t('estimate.send')}
            </Button>
          </form>
        )}
      </div>
    </Modal>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-[13px] font-medium text-subtle">{title}</p>
      {children}
    </div>
  );
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="flex list-disc flex-col gap-1 pl-5 text-text marker:text-subtle">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}
