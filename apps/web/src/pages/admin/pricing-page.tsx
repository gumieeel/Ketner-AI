import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { DiscoveryApiError } from '@/features/discovery/api';
import {
  adminPricing,
  type AdminRequestDetail,
  type AdminRequestRow,
  type CalibrationReport,
  type CatalogItem,
  type PricingConfig,
  type PricingVersion,
} from '@/features/pricing/admin-api';
import {
  REQUEST_STATUSES,
  formatKzt,
  formatKztRange,
  type RequestStatus,
} from '@/features/pricing/api';
import { useTranslation, type TranslationKey } from '@/i18n';
import { useDocumentTitle } from '@/lib/use-document-title';
import { cn } from '@/lib/cn';
import { StatusBadge } from '@/pages/requests/requests-page';

type Tab = 'requests' | 'config' | 'catalog' | 'estimates' | 'calibration';
const TABS: Tab[] = ['requests', 'config', 'catalog', 'estimates', 'calibration'];

const hoursOf = (centi: number) => (centi / 100).toFixed(1);

function errorText(error: unknown, fallback: string): string {
  if (error instanceof DiscoveryApiError) {
    if (error.status === 403) return 'admin_access_denied';
    return error.message || error.code;
  }
  return fallback;
}

/**
 * Админка смет: заявки (проверка, предложение, факт), настройки, каталог работ, сметы и точность.
 * Права проверяет сервер; страница только показывает его ответ.
 */
export function AdminPricingPage() {
  const { t } = useTranslation();
  useDocumentTitle(t('adminPricing.title'));
  const [tab, setTab] = useState<Tab>('requests');
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[24px] font-medium text-text">{t('adminPricing.title')}</h1>
        <Link to="/admin" className="text-[14px] text-muted hover:text-text">
          {t('adminPricing.backToAdmin')}
        </Link>
      </div>
      <div role="tablist" className="mt-5 flex flex-wrap gap-2 border-b border-stroke pb-3">
        {TABS.map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={tab === item}
            onClick={() => setTab(item)}
            className={cn(
              'min-h-11 rounded-lg px-3 text-[14px] md:min-h-9',
              tab === item ? 'bg-accent-soft text-accent' : 'text-muted hover:text-text',
            )}
          >
            {t(`adminPricing.tab.${item}` as TranslationKey)}
          </button>
        ))}
      </div>
      <div className="mt-6">
        {tab === 'requests' ? <RequestsTab /> : null}
        {tab === 'config' ? <ConfigTab /> : null}
        {tab === 'catalog' ? <CatalogTab /> : null}
        {tab === 'estimates' ? <EstimatesTab /> : null}
        {tab === 'calibration' ? <CalibrationTab /> : null}
      </div>
    </main>
  );
}

function useLoad<T>(load: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      setError(null);
      setData(await load());
    } catch (caught) {
      setError(errorText(caught, 'error'));
    }
  }, [load]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { data, error, reload };
}

function Problem({ code }: { code: string }) {
  const { t } = useTranslation();
  return (
    <p
      role="alert"
      className="rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-[14px] text-danger"
    >
      {code === 'admin_access_denied' ? t('adminPricing.denied') : code}
    </p>
  );
}

// ─── Заявки ──────────────────────────────────────────────────────────────────

function RequestsTab() {
  const { t, language } = useTranslation();
  const [status, setStatus] = useState<RequestStatus | ''>('');
  const load = useCallback(() => adminPricing.requests(status || undefined), [status]);
  const { data, error, reload } = useLoad(load);
  const [selected, setSelected] = useState<string | null>(null);

  if (error) return <Problem code={error} />;
  return (
    <div className="flex flex-col gap-4">
      <label className="flex items-center gap-2 text-[14px] text-muted">
        {t('adminPricing.filter')}
        <select
          className="h-10 rounded-lg border border-stroke bg-surface px-2 text-text"
          value={status}
          onChange={(event) => setStatus(event.target.value as RequestStatus | '')}
        >
          <option value="">{t('adminPricing.all')}</option>
          {REQUEST_STATUSES.map((item) => (
            <option key={item} value={item}>
              {t(`requests.status.${item}` as TranslationKey)}
            </option>
          ))}
        </select>
      </label>
      {!data ? (
        <Skeleton className="h-32 w-full" />
      ) : data.requests.length === 0 ? (
        <p className="text-[14px] text-muted">{t('adminPricing.noRequests')}</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-stroke">
          <table className="w-full min-w-[760px] text-left text-[13px]">
            <thead className="text-subtle">
              <tr>
                <th className="px-3 py-2">{t('adminPricing.col.request')}</th>
                <th className="px-3 py-2">{t('adminPricing.col.contact')}</th>
                <th className="px-3 py-2">{t('adminPricing.col.preliminary')}</th>
                <th className="px-3 py-2">{t('adminPricing.col.reviewed')}</th>
                <th className="px-3 py-2">{t('adminPricing.col.status')}</th>
              </tr>
            </thead>
            <tbody>
              {data.requests.map((row: AdminRequestRow) => (
                <tr
                  key={row.id}
                  className={cn(
                    'cursor-pointer border-t border-stroke hover:bg-surface-2',
                    selected === row.id && 'bg-surface-2',
                  )}
                  onClick={() => setSelected(row.id)}
                >
                  <td className="px-3 py-2 text-text">
                    {Object.values(row.opportunityTitles).join(' · ')}
                    {row.requiresManualReview ? (
                      <Badge tone="warning" className="ml-2">
                        {t('estimate.needsCheck')}
                      </Badge>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-muted">
                    {row.contact.name}, {row.contact.phone}
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {row.preliminaryPriceKzt
                      ? formatKztRange(row.preliminaryPriceKzt, language)
                      : '—'}
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {row.reviewed ? formatKztRange(row.reviewed.priceKzt, language) : '—'}
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={row.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {selected ? (
        <RequestDetail
          key={selected}
          id={selected}
          onChanged={async () => {
            await reload();
          }}
        />
      ) : null}
    </div>
  );
}

function RequestDetail({ id, onChanged }: { id: string; onChanged: () => Promise<void> }) {
  const { t, language } = useTranslation();
  const load = useCallback(() => adminPricing.request(id), [id]);
  const { data, error, reload } = useLoad<AdminRequestDetail>(load);
  const [actionError, setActionError] = useState<string | null>(null);
  const after = async (run: () => Promise<unknown>) => {
    setActionError(null);
    try {
      await run();
      await reload();
      await onChanged();
      return true;
    } catch (caught) {
      setActionError(errorText(caught, 'error'));
      return false;
    }
  };

  if (error) return <Problem code={error} />;
  if (!data) return <Skeleton className="h-64 w-full" />;
  const { request, audit } = data;
  const result = request.snapshot.result;

  return (
    <section className="flex flex-col gap-5 rounded-2xl border border-stroke bg-surface px-5 py-5">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-[18px] font-medium text-text">
          {Object.values(request.snapshot.opportunityTitles).join(' · ')}
        </h2>
        <StatusBadge status={request.status} />
      </div>
      <p className="text-[13px] text-muted">
        {request.contact.name} · {request.contact.phone} · {request.contact.email ?? '—'} ·{' '}
        {t('adminPricing.version', { version: request.snapshot.pricingVersion })}
      </p>
      {request.customerMessage ? (
        <p className="text-[14px] whitespace-pre-line text-text">{request.customerMessage}</p>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-[13px] tabular-nums">
          <thead className="text-subtle">
            <tr>
              <th className="py-1 pr-3">{t('adminPricing.col.work')}</th>
              <th className="py-1 pr-3">{t('adminPricing.col.complexity')}</th>
              <th className="py-1 pr-3">{t('adminPricing.col.hours')}</th>
              <th className="py-1 pr-3">{t('adminPricing.col.labor')}</th>
              <th className="py-1 pr-3">{t('adminPricing.col.direct')}</th>
            </tr>
          </thead>
          <tbody>
            {result.lines.map((line) => (
              <tr key={line.capabilityId} className="border-t border-stroke">
                <td className="py-1.5 pr-3 text-text">
                  {line.name[language]} {line.quantity > 1 ? `× ${line.quantity}` : ''}
                  {line.requiresManualReview ? ' ⚠' : ''}
                </td>
                <td className="py-1.5 pr-3 text-muted">
                  {line.requestedComplexity && line.requestedComplexity !== line.complexity
                    ? `${line.requestedComplexity} → `
                    : ''}
                  {line.complexity} (×{(line.multiplierMilli / 1000).toFixed(2)})
                </td>
                <td className="py-1.5 pr-3">
                  {hoursOf(line.hours.min)} / {hoursOf(line.hours.expected)} /{' '}
                  {hoursOf(line.hours.max)}
                </td>
                <td className="py-1.5 pr-3">{formatKztRange(line.laborKzt, language)}</td>
                <td className="py-1.5 pr-3">
                  {line.directCostKzt === null ? '?' : formatKzt(line.directCostKzt, language)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className="grid gap-x-6 gap-y-1 text-[13px] sm:grid-cols-2">
        <Fact label={t('adminPricing.testing')}>
          {hoursOf(result.testingHours.min)} / {hoursOf(result.testingHours.expected)} /{' '}
          {hoursOf(result.testingHours.max)} ч
        </Fact>
        <Fact label={t('adminPricing.totalHours')}>
          {hoursOf(result.hours.min)} / {hoursOf(result.hours.expected)} /{' '}
          {hoursOf(result.hours.max)} ч (+
          {result.uncertaintyBp / 100}%)
        </Fact>
        <Fact label={t('adminPricing.riskReserve')}>
          {formatKztRange(result.riskReserveKzt, language)}
        </Fact>
        <Fact label={t('adminPricing.raw')}>{formatKztRange(result.rawTotalKzt, language)}</Fact>
        <Fact label={t('adminPricing.final')}>
          {result.priceKzt
            ? formatKztRange(result.priceKzt, language)
            : t('estimate.reviewRequired')}
        </Fact>
        <Fact label={t('adminPricing.confidence')}>
          {result.confidence} ({result.confidenceReasons.join(', ') || '—'})
        </Fact>
      </dl>
      {result.excluded.length > 0 ? (
        <p className="text-[13px] text-warning">
          {t('estimate.excludedTitle')}:{' '}
          {result.excluded
            .map((item) => `${item.name ?? item.capabilityId} (${item.reason})`)
            .join(', ')}
        </p>
      ) : null}
      {result.unknowns.length > 0 ? (
        <p className="text-[13px] text-muted">
          {t('estimate.unknowns')}: {result.unknowns.join('; ')}
        </p>
      ) : null}

      {actionError ? <Problem code={actionError} /> : null}
      <ReviewForm
        request={request}
        onSubmit={(body) => after(() => adminPricing.review(id, body))}
      />
      <StatusForm
        request={request}
        onSubmit={(body) => after(() => adminPricing.updateRequest(id, body))}
      />
      {['in_progress', 'testing', 'completed'].includes(request.status) ? (
        <ActualsForm
          request={request}
          onSubmit={(body) => after(() => adminPricing.actuals(id, body))}
        />
      ) : null}

      {request.internalNotes.length > 0 ? (
        <div>
          <p className="text-[13px] font-medium text-subtle">{t('adminPricing.notes')}</p>
          <ul className="mt-1 flex flex-col gap-1 text-[13px] text-text">
            {request.internalNotes.map((note) => (
              <li key={note.id}>
                {note.createdAt.slice(0, 16).replace('T', ' ')} · {note.text}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div>
        <p className="text-[13px] font-medium text-subtle">{t('adminPricing.audit')}</p>
        <ul className="mt-1 flex flex-col gap-1 text-[12px] text-muted">
          {audit.map((entry) => (
            <li key={entry.id}>
              {entry.createdAt.slice(0, 16).replace('T', ' ')} · {entry.actorId} · {entry.action}
              {entry.reason ? ` · «${entry.reason}»` : ''}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function ReviewForm({
  request,
  onSubmit,
}: {
  request: AdminRequestDetail['request'];
  onSubmit: (body: {
    priceKzt: { min: number; expected: number; max: number };
    hours: null;
    workingDays: [number, number];
    customerNote: string;
    approve: boolean;
    reason: string;
  }) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const base = request.reviewed?.priceKzt ??
    request.snapshot.result.priceKzt ?? { min: 0, expected: 0, max: 0 };
  const days = request.reviewed?.workingDays ?? [
    request.snapshot.result.duration.workingDaysMin,
    request.snapshot.result.duration.workingDaysMax,
  ];
  const [min, setMin] = useState(String(base.min));
  const [expected, setExpected] = useState(String(base.expected));
  const [max, setMax] = useState(String(base.max));
  const [from, setFrom] = useState(String(days[0]));
  const [to, setTo] = useState(String(days[1]));
  const [note, setNote] = useState(request.reviewed?.customerNote ?? '');
  const [reason, setReason] = useState('');
  const [approve, setApprove] = useState(false);
  return (
    <form
      className="flex flex-col gap-3 rounded-xl border border-stroke px-4 py-4"
      onSubmit={(event) => {
        event.preventDefault();
        void onSubmit({
          priceKzt: { min: Number(min), expected: Number(expected), max: Number(max) },
          hours: null,
          workingDays: [Number(from), Number(to)],
          customerNote: note,
          approve,
          reason,
        }).then((ok) => ok && setReason(''));
      }}
    >
      <p className="text-[14px] font-medium text-text">{t('adminPricing.review')}</p>
      <div className="grid gap-3 sm:grid-cols-5">
        <Small label={t('adminPricing.min')} value={min} onChange={setMin} />
        <Small label={t('adminPricing.expected')} value={expected} onChange={setExpected} />
        <Small label={t('adminPricing.max')} value={max} onChange={setMax} />
        <Small label={t('adminPricing.daysFrom')} value={from} onChange={setFrom} />
        <Small label={t('adminPricing.daysTo')} value={to} onChange={setTo} />
      </div>
      <TextArea label={t('adminPricing.customerNote')} value={note} onChange={setNote} />
      <Small label={t('adminPricing.reason')} value={reason} onChange={setReason} wide />
      <label className="flex items-center gap-2 text-[14px] text-text">
        <input
          type="checkbox"
          checked={approve}
          onChange={(event) => setApprove(event.target.checked)}
        />
        {t('adminPricing.approve')}
      </label>
      <Button type="submit" size="sm" className="self-start" disabled={reason.trim().length < 3}>
        {t('adminPricing.saveReview')}
      </Button>
    </form>
  );
}

function StatusForm({
  request,
  onSubmit,
}: {
  request: AdminRequestDetail['request'];
  onSubmit: (body: {
    status?: RequestStatus;
    assignedAdminId?: 'me' | null;
    note?: string;
    reason: string;
  }) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<RequestStatus>(request.status);
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  return (
    <form
      className="flex flex-col gap-3 rounded-xl border border-stroke px-4 py-4"
      onSubmit={(event) => {
        event.preventDefault();
        void onSubmit({
          ...(status !== request.status ? { status } : {}),
          ...(note.trim() ? { note } : {}),
          reason,
        }).then((ok) => {
          if (ok) {
            setNote('');
            setReason('');
          }
        });
      }}
    >
      <p className="text-[14px] font-medium text-text">{t('adminPricing.manage')}</p>
      <label className="flex flex-wrap items-center gap-2 text-[14px] text-muted">
        {t('adminPricing.col.status')}
        <select
          className="h-10 rounded-lg border border-stroke bg-surface px-2 text-text"
          value={status}
          onChange={(event) => setStatus(event.target.value as RequestStatus)}
        >
          {REQUEST_STATUSES.map((item) => (
            <option key={item} value={item}>
              {t(`requests.status.${item}` as TranslationKey)}
            </option>
          ))}
        </select>
      </label>
      <TextArea label={t('adminPricing.internalNote')} value={note} onChange={setNote} />
      <Small label={t('adminPricing.reason')} value={reason} onChange={setReason} wide />
      <div className="flex flex-wrap gap-3">
        <Button type="submit" size="sm">
          {t('adminPricing.save')}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => void onSubmit({ assignedAdminId: 'me', reason: 'assign' })}
        >
          {request.assignedAdminId ? t('adminPricing.reassignMe') : t('adminPricing.assignMe')}
        </Button>
      </div>
    </form>
  );
}

function ActualsForm({
  request,
  onSubmit,
}: {
  request: AdminRequestDetail['request'];
  onSubmit: (body: {
    actualHours: number;
    actualDirectKzt: number;
    finalPriceKzt: number;
    deviationReasons: string;
    scopeChanges: string;
    difficulties: string;
  }) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const [hours, setHours] = useState(
    request.actuals ? String(request.actuals.actualHours / 100) : '',
  );
  const [direct, setDirect] = useState(String(request.actuals?.actualDirectKzt ?? 0));
  const [price, setPrice] = useState(
    String(request.actuals?.finalPriceKzt ?? request.reviewed?.priceKzt.expected ?? ''),
  );
  const [reasons, setReasons] = useState(request.actuals?.deviationReasons ?? '');
  const [scope, setScope] = useState('');
  const [difficulties, setDifficulties] = useState('');
  return (
    <form
      className="flex flex-col gap-3 rounded-xl border border-stroke px-4 py-4"
      onSubmit={(event) => {
        event.preventDefault();
        void onSubmit({
          actualHours: Number(hours),
          actualDirectKzt: Number(direct),
          finalPriceKzt: Number(price),
          deviationReasons: reasons,
          scopeChanges: scope,
          difficulties,
        });
      }}
    >
      <p className="text-[14px] font-medium text-text">{t('adminPricing.actuals')}</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Small label={t('adminPricing.actualHours')} value={hours} onChange={setHours} />
        <Small label={t('adminPricing.actualDirect')} value={direct} onChange={setDirect} />
        <Small label={t('adminPricing.finalPrice')} value={price} onChange={setPrice} />
      </div>
      <TextArea label={t('adminPricing.scopeChanges')} value={scope} onChange={setScope} />
      <TextArea
        label={t('adminPricing.difficulties')}
        value={difficulties}
        onChange={setDifficulties}
      />
      <TextArea label={t('adminPricing.deviationReasons')} value={reasons} onChange={setReasons} />
      <Button type="submit" size="sm" className="self-start">
        {t('adminPricing.saveActuals')}
      </Button>
    </form>
  );
}

// ─── Настройки ───────────────────────────────────────────────────────────────

type NumberKey =
  | 'billableHourlyRateKzt'
  | 'riskReservePercent'
  | 'testingPercent'
  | 'uncertaintyPercentPerUnknown'
  | 'uncertaintyMaxPercent'
  | 'minimumImplementationPriceKzt'
  | 'roundingIncrementKzt'
  | 'workingHoursPerDay'
  | 'calibrationMinSamples';

const NUMBER_FIELDS: NumberKey[] = [
  'billableHourlyRateKzt',
  'riskReservePercent',
  'testingPercent',
  'uncertaintyPercentPerUnknown',
  'uncertaintyMaxPercent',
  'minimumImplementationPriceKzt',
  'roundingIncrementKzt',
  'workingHoursPerDay',
  'calibrationMinSamples',
];

function ConfigTab() {
  const { t } = useTranslation();
  const { data, error, reload } = useLoad(adminPricing.config);
  if (error) return <Problem code={error} />;
  if (!data) return <Skeleton className="h-64 w-full" />;
  return <ConfigForm key={data.version.version} version={data.version} onSaved={reload} t={t} />;
}

function ConfigForm({
  version,
  onSaved,
  t,
}: {
  version: PricingVersion;
  onSaved: () => Promise<void>;
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
}) {
  const [config, setConfig] = useState<PricingConfig>(version.config);
  const [usage, setUsage] = useState(JSON.stringify(version.config.usage));
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const optional = (raw: string) => (raw.trim() === '' ? null : Number(raw));

  const save = async () => {
    setProblem(null);
    setSaved(false);
    let parsedUsage: PricingConfig['usage'];
    try {
      parsedUsage = JSON.parse(usage) as PricingConfig['usage'];
    } catch {
      setProblem(t('adminPricing.badJson'));
      return;
    }
    try {
      await adminPricing.saveConfig(version.version, { ...config, usage: parsedUsage }, reason);
      setSaved(true);
      await onSaved();
    } catch (caught) {
      setProblem(errorText(caught, 'error'));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[13px] text-muted">
        {t('adminPricing.version', { version: version.version })} · {version.note} ·{' '}
        {version.createdBy}
      </p>
      {version.version === 1 ? (
        <p className="rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-[14px] text-warning">
          {t('adminPricing.uncalibrated')}
        </p>
      ) : null}
      <label className="flex items-center gap-2 text-[14px] text-text">
        <input
          type="checkbox"
          checked={config.enabled}
          onChange={(event) => setConfig({ ...config, enabled: event.target.checked })}
        />
        {t('adminPricing.enabled')}
      </label>
      <div className="grid gap-3 sm:grid-cols-3">
        {NUMBER_FIELDS.map((key) => (
          <Small
            key={key}
            label={t(`adminPricing.field.${key}` as TranslationKey)}
            value={String(config[key])}
            onChange={(raw) => setConfig({ ...config, [key]: Number(raw) })}
          />
        ))}
        {(['simple', 'medium', 'complex'] as const).map((level) => (
          <Small
            key={level}
            label={t('adminPricing.multiplier', {
              level: t(`estimate.complexity.${level}` as TranslationKey),
            })}
            value={String(config.complexityMultipliers[level])}
            onChange={(raw) =>
              setConfig({
                ...config,
                complexityMultipliers: { ...config.complexityMultipliers, [level]: Number(raw) },
              })
            }
          />
        ))}
        <Small
          label={t('adminPricing.field.feedbackFrom')}
          value={String(config.customerFeedbackDays[0])}
          onChange={(raw) =>
            setConfig({
              ...config,
              customerFeedbackDays: [Number(raw), config.customerFeedbackDays[1]],
            })
          }
        />
        <Small
          label={t('adminPricing.field.feedbackTo')}
          value={String(config.customerFeedbackDays[1])}
          onChange={(raw) =>
            setConfig({
              ...config,
              customerFeedbackDays: [config.customerFeedbackDays[0], Number(raw)],
            })
          }
        />
        <Small
          label={t('adminPricing.field.supportMonthlyKzt')}
          value={config.supportMonthlyKzt === null ? '' : String(config.supportMonthlyKzt)}
          onChange={(raw) => setConfig({ ...config, supportMonthlyKzt: optional(raw) })}
        />
        <Small
          label={t('adminPricing.field.usdToKztRate')}
          value={config.usdToKztRate === null ? '' : String(config.usdToKztRate)}
          onChange={(raw) => setConfig({ ...config, usdToKztRate: optional(raw) })}
        />
      </div>
      <TextArea label={t('adminPricing.field.usage')} value={usage} onChange={setUsage} mono />
      <Small label={t('adminPricing.reason')} value={reason} onChange={setReason} wide />
      {problem ? <Problem code={problem} /> : null}
      {saved ? (
        <p className="text-[14px] text-success" role="status">
          {t('adminPricing.saved')}
        </p>
      ) : null}
      <Button
        className="self-start"
        onClick={() => void save()}
        disabled={reason.trim().length < 3}
      >
        {t('adminPricing.saveVersion')}
      </Button>
      <p className="text-[13px] text-muted">{t('adminPricing.snapshotNote')}</p>
    </div>
  );
}

// ─── Каталог ─────────────────────────────────────────────────────────────────

const STATUSES: CatalogItem['status'][] = ['available', 'custom', 'planned', 'disabled'];
const COMPLEXITY = ['simple', 'medium', 'complex'];

function CatalogTab() {
  const { t, language } = useTranslation();
  const { data, error, reload } = useLoad(adminPricing.config);
  const [editing, setEditing] = useState<CatalogItem | null>(null);
  if (error) return <Problem code={error} />;
  if (!data) return <Skeleton className="h-64 w-full" />;
  const version = data.version;
  const blank: CatalogItem = {
    id: '',
    name: { ru: '', en: '' },
    description: { ru: '', en: '' },
    category: 'integration',
    status: 'custom',
    hoursMin: 1,
    hoursExpected: 2,
    hoursMax: 4,
    complexityRange: ['simple', 'complex'],
    defaultComplexity: 'medium',
    maxQuantity: 1,
    directSetupCostKzt: 0,
    externalLeadDays: [0, 0],
    requiresManualReview: true,
    prerequisites: [],
    exclusions: [],
    includes: [],
  };
  return (
    <div className="flex flex-col gap-4">
      <Button size="sm" variant="outline" className="self-start" onClick={() => setEditing(blank)}>
        {t('adminPricing.newItem')}
      </Button>
      {editing ? (
        <CatalogEditor
          key={editing.id || 'new'}
          item={editing}
          isNew={!version.catalog.some((item) => item.id === editing.id)}
          baseVersion={version.version}
          onDone={async () => {
            setEditing(null);
            await reload();
          }}
          onCancel={() => setEditing(null)}
        />
      ) : null}
      <div className="overflow-x-auto rounded-xl border border-stroke">
        <table className="w-full min-w-[760px] text-left text-[13px] tabular-nums">
          <thead className="text-subtle">
            <tr>
              <th className="px-3 py-2">{t('adminPricing.col.work')}</th>
              <th className="px-3 py-2">{t('adminPricing.col.status')}</th>
              <th className="px-3 py-2">{t('adminPricing.col.hours')}</th>
              <th className="px-3 py-2">{t('adminPricing.col.complexity')}</th>
              <th className="px-3 py-2">{t('adminPricing.col.direct')}</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {version.catalog.map((item) => (
              <tr key={item.id} className="border-t border-stroke">
                <td className="px-3 py-2 text-text">
                  {item.name[language]}
                  <span className="block text-[12px] text-subtle">{item.id}</span>
                </td>
                <td className="px-3 py-2">
                  {t(`adminPricing.status.${item.status}` as TranslationKey)}
                  {item.requiresManualReview ? ' ⚠' : ''}
                </td>
                <td className="px-3 py-2">
                  {item.hoursMin} / {item.hoursExpected} / {item.hoursMax}
                </td>
                <td className="px-3 py-2 text-muted">{item.complexityRange.join('–')}</td>
                <td className="px-3 py-2">
                  {item.directSetupCostKzt === null
                    ? '?'
                    : formatKzt(item.directSetupCostKzt, language)}
                </td>
                <td className="px-3 py-2">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(item)}>
                    {t('adminPricing.edit')}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CatalogEditor({
  item,
  isNew,
  baseVersion,
  onDone,
  onCancel,
}: {
  item: CatalogItem;
  isNew: boolean;
  baseVersion: number;
  onDone: () => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<CatalogItem>(item);
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const set = <K extends keyof CatalogItem>(key: K, value: CatalogItem[K]) =>
    setDraft({ ...draft, [key]: value });
  const lines = (raw: string) =>
    raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

  const save = async () => {
    setProblem(null);
    try {
      await adminPricing.saveItem(baseVersion, draft, reason);
      await onDone();
    } catch (caught) {
      setProblem(errorText(caught, 'error'));
    }
  };

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-stroke bg-surface px-5 py-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <Small
          label="id"
          value={draft.id}
          onChange={(raw) => set('id', raw.trim())}
          disabled={!isNew}
        />
        <Small
          label={t('adminPricing.nameRu')}
          value={draft.name.ru}
          onChange={(raw) => set('name', { ...draft.name, ru: raw })}
        />
        <Small
          label={t('adminPricing.nameEn')}
          value={draft.name.en}
          onChange={(raw) => set('name', { ...draft.name, en: raw })}
        />
        <Select
          label={t('adminPricing.col.status')}
          value={draft.status}
          options={STATUSES}
          onChange={(raw) => set('status', raw as CatalogItem['status'])}
        />
        <Select
          label={t('adminPricing.category')}
          value={draft.category}
          options={['ai', 'channel', 'integration', 'process', 'data', 'interface', 'shared']}
          onChange={(raw) => set('category', raw)}
        />
        <Small
          label={t('adminPricing.maxQuantity')}
          value={String(draft.maxQuantity)}
          onChange={(raw) => set('maxQuantity', Number(raw))}
        />
        <Small
          label={t('adminPricing.hoursMin')}
          value={String(draft.hoursMin)}
          onChange={(raw) => set('hoursMin', Number(raw))}
        />
        <Small
          label={t('adminPricing.hoursExpected')}
          value={String(draft.hoursExpected)}
          onChange={(raw) => set('hoursExpected', Number(raw))}
        />
        <Small
          label={t('adminPricing.hoursMax')}
          value={String(draft.hoursMax)}
          onChange={(raw) => set('hoursMax', Number(raw))}
        />
        <Select
          label={t('adminPricing.complexityFrom')}
          value={draft.complexityRange[0]}
          options={COMPLEXITY}
          onChange={(raw) => set('complexityRange', [raw, draft.complexityRange[1]])}
        />
        <Select
          label={t('adminPricing.complexityTo')}
          value={draft.complexityRange[1]}
          options={COMPLEXITY}
          onChange={(raw) => set('complexityRange', [draft.complexityRange[0], raw])}
        />
        <Select
          label={t('adminPricing.defaultComplexity')}
          value={draft.defaultComplexity}
          options={COMPLEXITY}
          onChange={(raw) => set('defaultComplexity', raw)}
        />
        <Small
          label={t('adminPricing.col.direct')}
          value={draft.directSetupCostKzt === null ? '' : String(draft.directSetupCostKzt)}
          onChange={(raw) => set('directSetupCostKzt', raw.trim() === '' ? null : Number(raw))}
        />
        <Small
          label={t('adminPricing.leadFrom')}
          value={String(draft.externalLeadDays[0])}
          onChange={(raw) => set('externalLeadDays', [Number(raw), draft.externalLeadDays[1]])}
        />
        <Small
          label={t('adminPricing.leadTo')}
          value={String(draft.externalLeadDays[1])}
          onChange={(raw) => set('externalLeadDays', [draft.externalLeadDays[0], Number(raw)])}
        />
      </div>
      <TextArea
        label={t('adminPricing.descriptionRu')}
        value={draft.description.ru}
        onChange={(raw) => set('description', { ...draft.description, ru: raw })}
      />
      <TextArea
        label={t('adminPricing.includes')}
        value={draft.includes.join('\n')}
        onChange={(raw) => set('includes', lines(raw))}
      />
      <TextArea
        label={t('adminPricing.prerequisites')}
        value={draft.prerequisites.join('\n')}
        onChange={(raw) => set('prerequisites', lines(raw))}
      />
      <TextArea
        label={t('adminPricing.exclusions')}
        value={draft.exclusions.join('\n')}
        onChange={(raw) => set('exclusions', lines(raw))}
      />
      <label className="flex items-center gap-2 text-[14px] text-text">
        <input
          type="checkbox"
          checked={draft.requiresManualReview}
          onChange={(event) => set('requiresManualReview', event.target.checked)}
        />
        {t('adminPricing.manualReview')}
      </label>
      <Small label={t('adminPricing.reason')} value={reason} onChange={setReason} wide />
      {problem ? <Problem code={problem} /> : null}
      <div className="flex gap-3">
        <Button size="sm" onClick={() => void save()} disabled={reason.trim().length < 3}>
          {t('adminPricing.saveVersion')}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          {t('profile.cancel')}
        </Button>
      </div>
    </section>
  );
}

// ─── Сметы и калибровка ──────────────────────────────────────────────────────

function EstimatesTab() {
  const { t, language } = useTranslation();
  const { data, error } = useLoad(adminPricing.estimates);
  if (error) return <Problem code={error} />;
  if (!data) return <Skeleton className="h-64 w-full" />;
  if (data.estimates.length === 0)
    return <p className="text-[14px] text-muted">{t('adminPricing.noEstimates')}</p>;
  return (
    <div className="overflow-x-auto rounded-xl border border-stroke">
      <table className="w-full min-w-[760px] text-left text-[13px] tabular-nums">
        <thead className="text-subtle">
          <tr>
            <th className="px-3 py-2">{t('adminPricing.col.request')}</th>
            <th className="px-3 py-2">{t('adminPricing.col.hours')}</th>
            <th className="px-3 py-2">{t('adminPricing.col.preliminary')}</th>
            <th className="px-3 py-2">{t('adminPricing.confidence')}</th>
            <th className="px-3 py-2">v</th>
          </tr>
        </thead>
        <tbody>
          {data.estimates.map((row) => (
            <tr key={row.id} className="border-t border-stroke">
              <td className="px-3 py-2 text-text">
                {row.scope === 'combined' ? `${t('estimate.combinedTitle')}: ` : ''}
                {Object.values(row.opportunityTitles).join(' · ')}
                <span className="block text-[12px] text-subtle">
                  {row.createdAt.slice(0, 16).replace('T', ' ')}
                </span>
              </td>
              <td className="px-3 py-2">
                {hoursOf(row.hours.min)}–{hoursOf(row.hours.max)}
              </td>
              <td className="px-3 py-2">
                {row.priceKzt ? formatKztRange(row.priceKzt, language) : '—'}
              </td>
              <td className="px-3 py-2">
                {row.confidence}
                {row.requiresManualReview ? ' ⚠' : ''}
              </td>
              <td className="px-3 py-2">{row.pricingVersion}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CalibrationTab() {
  const { t } = useTranslation();
  const { data, error, reload } = useLoad(adminPricing.calibration);
  const configLoad = useLoad(adminPricing.config);
  const [problem, setProblem] = useState<string | null>(null);
  if (error) return <Problem code={error} />;
  if (!data) return <Skeleton className="h-64 w-full" />;
  const report: CalibrationReport = data.report;

  const apply = async (capabilityId: string, hours: number) => {
    const version = configLoad.data?.version;
    const item = version?.catalog.find((entry) => entry.id === capabilityId);
    if (!version || !item) return;
    setProblem(null);
    try {
      await adminPricing.saveItem(
        version.version,
        {
          ...item,
          hoursExpected: hours,
          hoursMin: Math.min(item.hoursMin, hours),
          hoursMax: Math.max(item.hoursMax, hours),
        },
        t('adminPricing.calibrationReason', { projects: report.projects }),
      );
      await configLoad.reload();
      await reload();
    } catch (caught) {
      setProblem(errorText(caught, 'error'));
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <p className="text-[14px] text-muted">{t('adminPricing.calibrationIntro')}</p>
      <dl className="grid gap-x-6 gap-y-1 text-[14px] sm:grid-cols-2">
        <Fact label={t('adminPricing.projects')}>{report.projects}</Fact>
        <Fact label={t('adminPricing.hoursError')}>
          {report.overall.meanAbsHoursErrorPct === null
            ? '—'
            : `${report.overall.meanAbsHoursErrorPct}%`}
        </Fact>
        <Fact label={t('adminPricing.hoursRatio')}>{report.overall.medianHoursRatio ?? '—'}</Fact>
        <Fact label={t('adminPricing.priceDeviation')}>
          {report.overall.meanPriceDeviationPct === null
            ? '—'
            : `${report.overall.meanPriceDeviationPct}%`}
        </Fact>
      </dl>
      {problem ? <Problem code={problem} /> : null}
      {report.recommendations.length > 0 ? (
        <div>
          <p className="text-[14px] font-medium text-text">{t('adminPricing.recommendations')}</p>
          <ul className="mt-2 flex flex-col gap-2">
            {report.recommendations.map((item) => (
              <li
                key={item.capabilityId}
                className="flex flex-wrap items-center gap-3 text-[14px] text-text"
              >
                {item.capabilityId}: {item.currentHoursExpected} → {item.suggestedHoursExpected} ч (
                {t('adminPricing.projectsCount', { count: item.projects })})
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void apply(item.capabilityId, item.suggestedHoursExpected)}
                >
                  {t('adminPricing.apply')}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-[14px] text-muted">{t('adminPricing.noRecommendations')}</p>
      )}
      {(['byCapability', 'byIndustry', 'bySolutionType', 'byIntegration'] as const).map((group) =>
        report[group].length > 0 ? (
          <div key={group}>
            <p className="text-[13px] font-medium text-subtle">
              {t(`adminPricing.group.${group}` as TranslationKey)}
            </p>
            <ul className="mt-1 text-[13px] text-text tabular-nums">
              {report[group].map((row) => (
                <li key={row.key}>
                  {row.key}: ×{row.medianHoursRatio} · ±{row.meanAbsHoursErrorPct}% · n=
                  {row.projects}
                </li>
              ))}
            </ul>
          </div>
        ) : null,
      )}
    </div>
  );
}

// ─── Поля ────────────────────────────────────────────────────────────────────

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="text-subtle">{label}:</dt>
      <dd className="text-text tabular-nums">{children}</dd>
    </div>
  );
}

function Small({
  label,
  value,
  onChange,
  wide = false,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  wide?: boolean;
  disabled?: boolean;
}) {
  return (
    <label className={cn('flex flex-col gap-1 text-[13px] text-muted', wide && 'sm:col-span-full')}>
      {label}
      <Input value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-[13px] text-muted">
      {label}
      <select
        className="h-11 rounded-xl border border-stroke bg-surface px-2 text-[15px] text-text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function TextArea({
  label,
  value,
  onChange,
  mono = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  mono?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1 text-[13px] text-muted">
      {label}
      <textarea
        value={value}
        rows={3}
        onChange={(event) => onChange(event.target.value)}
        className={cn(
          'w-full rounded-xl border border-stroke bg-surface px-3 py-2 text-[14px] text-text',
          mono && 'font-mono text-[12px]',
        )}
      />
    </label>
  );
}
