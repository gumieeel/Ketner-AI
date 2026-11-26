import { useEffect, useState, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { buttonClasses } from '@/components/ui/button-classes';
import { Spinner } from '@/components/ui/spinner';
import {
  activateSolution,
  fetchBot,
  fetchBotDiagram,
  fetchLaunchStatus,
  fetchSolution,
  isAssistantDetails,
  type BotDiagram,
  type BotOverview,
  type LaunchStatus,
  type SolutionDetails,
} from '@/features/builder/api';
import { TIERS } from '@/features/billing/tiers';
import { wizardConnectionsPath, wizardSetupPath, wizardStartPath } from '@/features/builder/wizard';
import { DiscoveryApiError } from '@/features/discovery/api';
import { googleSheetsApi, type GoogleSheetStatus } from '@/features/google/api';
import { useTranslation, type TranslationKey } from '@/i18n';
import { cn } from '@/lib/cn';
import { ErrorNotice } from '@/pages/analysis/error-notice';
import { ProcessDiagram } from '../process-diagram';
import { BuilderGate, Page } from '../shared';
import { WizardFrame } from './wizard-frame';

/**
 * Шаг 4 мастера — «Запуск» (docs/BUILDER_V1.md, разделы 3, 5 и 8): проверка перед запуском и
 * схема. Блокируют запуск тесты и тариф — их проверяет сервер (`GET …/launch` и тот же отказ при
 * `POST …/activate`). Неподключённая Таблица не блокирует: заявки сохраняются и дождутся записи.
 * Без тарифа — экран «Нужен тариф»: агент остаётся черновиком.
 */
export function WizardLaunchPage() {
  const { solutionId = '' } = useParams();
  return (
    <BuilderGate>
      <LaunchLoader key={solutionId} id={solutionId} />
    </BuilderGate>
  );
}

interface Loaded {
  details: SolutionDetails;
  overview: BotOverview;
  launch: LaunchStatus;
  diagram: BotDiagram | null;
  google: GoogleSheetStatus | null;
}

function LaunchLoader({ id }: { id: string }) {
  const { t } = useTranslation();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [other, setOther] = useState(false);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([
      fetchSolution(id),
      fetchBot(id).catch(() => null),
      fetchLaunchStatus(id),
      fetchBotDiagram(id).catch(() => null),
      googleSheetsApi.status().catch(() => null),
    ]).then(
      ([details, overview, launch, diagram, google]) => {
        if (!alive) return;
        if (!isAssistantDetails(details) || details.solution.type !== 'customer_bot' || !overview) {
          setOther(true);
          return;
        }
        setLoaded({ details, overview, launch, diagram, google });
      },
      (caught: unknown) => {
        if (!alive) return;
        if (caught instanceof DiscoveryApiError && caught.status === 404) setMissing(true);
        else setError(caught);
      },
    );
    return () => {
      alive = false;
    };
  }, [id]);

  if (other) return <Navigate to={`/solutions/${id}`} replace />;
  if (missing) {
    return (
      <Page title={t('builder.notFound')} back={{ to: '/solutions', label: t('builder.back') }}>
        <p className="t-lead mt-4">{t('builder.notFoundLead')}</p>
      </Page>
    );
  }
  if (!loaded) {
    return (
      <WizardFrame title={t('wizard.title.customer_bot')} current="launch">
        <div className="mt-8">
          {error ? (
            <ErrorNotice error={error} redirect={`/solutions/${id}`} />
          ) : (
            <p className="flex items-center gap-2 text-[14px] text-muted">
              <Spinner /> {t('analysis.page.loading')}
            </p>
          )}
        </div>
      </WizardFrame>
    );
  }
  return <LaunchStep {...loaded} />;
}

type CheckTone = 'ok' | 'warn' | 'block';

function CheckRow({
  id,
  tone,
  title,
  children,
}: {
  id: string;
  tone: CheckTone;
  title: string;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <li className="flex items-start gap-3" data-check={id} data-tone={tone}>
      <span
        aria-hidden="true"
        className={cn(
          'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-[13px] font-medium',
          tone === 'ok' && 'bg-success-soft text-success',
          tone === 'warn' && 'bg-warning-soft text-warning',
          tone === 'block' && 'bg-danger-soft text-danger',
        )}
      >
        {tone === 'ok' ? '✓' : '!'}
      </span>
      <div className="min-w-0 text-[14px] leading-6">
        <p className="font-medium text-text">
          {title}
          <span className="sr-only"> — {t(`wizard.launch.tone.${tone}` as TranslationKey)}</span>
        </p>
        {children ? <div className="text-muted">{children}</div> : null}
      </div>
    </li>
  );
}

function LaunchStep({ details, overview, launch, diagram, google }: Loaded) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const { solution } = details;
  const source = solution.source;
  const step1 = source ? wizardStartPath(source.analysisId, source.opportunityId) : undefined;
  const automations = overview.automations ?? [];
  const sheetOn = automations.some((item) => item.id === 'lead_to_sheet' && item.enabled);
  const manager = automations.find((item) => item.id === 'lead_to_manager');
  const approvals = automations.filter((item) => item.enabled && item.approval !== 'none');
  const readiness = launch.readiness;

  const launchNow = async () => {
    setBusy(true);
    setError(null);
    try {
      await activateSolution(solution.id);
      navigate(`/solutions/${solution.id}`);
    } catch (caught) {
      setError(caught);
      setBusy(false);
    }
  };

  return (
    <WizardFrame
      title={t('wizard.title.customer_bot')}
      subtitle={solution.name}
      current="launch"
      hrefs={{
        ...(step1 ? { analysis: step1 } : {}),
        setup: wizardSetupPath(solution.id),
        connections: wizardConnectionsPath(solution.id),
      }}
      back={{ to: '/solutions', label: t('builder.back') }}
    >
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
        <section
          aria-labelledby="launch-checks"
          className="rounded-2xl border border-stroke bg-surface p-5"
        >
          <h2 id="launch-checks" className="text-[18px] font-medium text-text">
            {t('wizard.launch.checks')}
          </h2>
          <ul className="mt-4 flex flex-col gap-4">
            <CheckRow
              id="tests"
              tone={readiness.ready ? 'ok' : 'block'}
              title={
                readiness.ready ? t('wizard.launch.tests.ok') : t('wizard.launch.tests.notReady')
              }
            >
              {readiness.ready ? null : (
                <>
                  {t(`builder.ready.${readiness.reason}` as TranslationKey, {
                    failed: String(readiness.failed ?? 0),
                  })}{' '}
                  <Link
                    to={`/solutions/${solution.id}`}
                    className="text-accent underline-offset-4 hover:underline"
                  >
                    {t('wizard.launch.tests.open')}
                  </Link>
                </>
              )}
            </CheckRow>

            {sheetOn ? (
              <CheckRow
                id="sheet"
                tone={google?.status === 'connected' ? 'ok' : 'warn'}
                title={
                  google?.status === 'connected'
                    ? t('wizard.launch.sheet.ok')
                    : t('wizard.launch.sheet.missing')
                }
              >
                {google?.status === 'connected' ? null : (
                  <>
                    {t('wizard.launch.sheet.missingNote')}{' '}
                    <Link
                      to={wizardConnectionsPath(solution.id)}
                      className="text-accent underline-offset-4 hover:underline"
                    >
                      {t('wizard.step.connections')}
                    </Link>
                  </>
                )}
              </CheckRow>
            ) : null}

            {manager && manager.enabled ? (
              <CheckRow
                id="notify"
                tone={
                  manager.options?.email ||
                  (manager.options?.telegram && overview.leadNotify?.telegramLinked)
                    ? 'ok'
                    : 'warn'
                }
                title={
                  manager.options?.email ||
                  (manager.options?.telegram && overview.leadNotify?.telegramLinked)
                    ? t('wizard.launch.notify.ok')
                    : t('wizard.launch.notify.none')
                }
              />
            ) : null}

            <CheckRow
              id="approvals"
              tone={approvals.length === 0 ? 'ok' : 'block'}
              title={
                approvals.length === 0
                  ? t('wizard.launch.approvals.none')
                  : t('wizard.launch.approvals.pending')
              }
            />

            {launch.tier.enforced ? (
              <CheckRow
                id="tier"
                tone={launch.blocked ? 'block' : 'ok'}
                title={
                  launch.blocked
                    ? launch.blocked.code === 'tier_required'
                      ? t('wizard.launch.tier.required')
                      : t('wizard.launch.tier.full')
                    : t('wizard.launch.tier.ok', {
                        tier: launch.tier.name ?? '',
                        active: String(launch.tier.active),
                        limit: String(launch.tier.limit ?? 0),
                      })
                }
              >
                {launch.blocked ? launch.blocked.message : null}
              </CheckRow>
            ) : null}
          </ul>
        </section>

        <aside
          aria-label={t('wizard.launch.action')}
          className="flex flex-col gap-3 self-start rounded-2xl border border-stroke bg-surface p-5"
        >
          {launch.alreadyRunning ? (
            <>
              <p className="text-[15px] font-medium text-text">{t('wizard.launch.running')}</p>
              <Link
                to={`/solutions/${solution.id}`}
                className={buttonClasses({ variant: 'primary', size: 'md' })}
              >
                {t('wizard.launch.openAgent')}
              </Link>
            </>
          ) : launch.blocked?.code === 'tier_required' ? (
            <NeedTier active={launch.tier.active} />
          ) : (
            <>
              <Button loading={busy} disabled={busy || !launch.canLaunch} onClick={launchNow}>
                {solution.status === 'active'
                  ? t('wizard.launch.newVersion', { version: String(solution.currentVersion) })
                  : t('wizard.launch.button')}
              </Button>
              <p className="text-[13px] leading-5 text-subtle">
                {launch.canLaunch ? t('wizard.launch.note') : t('wizard.launch.blockedNote')}
              </p>
              {launch.blocked?.code === 'solution_limit' ? (
                <div className="flex flex-wrap gap-3 text-[14px]">
                  <Link to="/pricing" className="text-accent underline-offset-4 hover:underline">
                    {t('wizard.launch.tier.pricing')}
                  </Link>
                  <Link to="/solutions" className="text-accent underline-offset-4 hover:underline">
                    {t('wizard.launch.tier.mySolutions')}
                  </Link>
                </div>
              ) : null}
            </>
          )}
          {error ? <ErrorNotice error={error} redirect={`/solutions/${solution.id}`} /> : null}
        </aside>
      </div>

      {diagram ? (
        <section aria-labelledby="launch-diagram" className="mt-8">
          <h2 id="launch-diagram" className="text-[18px] font-medium text-text">
            {t('wizard.launch.diagram')}
          </h2>
          <ProcessDiagram diagram={diagram} />
        </section>
      ) : null}

      <div className="mt-8 border-t border-stroke pt-6">
        <Link
          to={wizardConnectionsPath(solution.id)}
          className={buttonClasses({ variant: 'outline', size: 'md' })}
        >
          {t('wizard.back')}
        </Link>
      </div>
    </WizardFrame>
  );
}

/**
 * «Нужен тариф» (раздел 8): без тарифа агент не запускается и остаётся черновиком. Тарифы — из
 * каталога; отмечен самый младший, где есть место для ещё одного агента.
 */
function NeedTier({ active }: { active: number }) {
  const { t } = useTranslation();
  const fits = TIERS.find((tier) => tier.activeSolutions > active)?.id;
  return (
    <div className="flex flex-col gap-3" data-testid="need-tier">
      <p className="text-[15px] font-medium text-text">{t('wizard.launch.needTier.title')}</p>
      <p className="text-[14px] leading-6 text-muted">{t('wizard.launch.needTier.lead')}</p>
      <ul className="flex flex-col gap-2">
        {TIERS.map((tier) => (
          <li
            key={tier.id}
            data-tier={tier.id}
            className={cn(
              'rounded-xl border px-4 py-3 text-[14px] leading-6',
              tier.id === fits ? 'border-accent bg-accent-soft/40' : 'border-stroke',
            )}
          >
            <p className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-medium text-text">{tier.name}</span>
              <span className="text-muted">
                {t('wizard.launch.needTier.price', { price: String(tier.priceUsd) })}
              </span>
            </p>
            <p className="text-muted">
              {t('wizard.launch.needTier.includes', {
                solutions: String(tier.activeSolutions),
                requests: tier.monthlyRequests.toLocaleString('ru-RU'),
                services: String(tier.externalServices),
              })}
            </p>
            {tier.id === fits ? (
              <p className="text-[13px] text-accent">{t('wizard.launch.needTier.fits')}</p>
            ) : null}
          </li>
        ))}
      </ul>
      <Link to="/pricing" className={buttonClasses({ variant: 'primary', size: 'md' })}>
        {t('wizard.launch.tier.pricing')}
      </Link>
      <p className="text-[13px] leading-5 text-subtle">{t('wizard.launch.needTier.draft')}</p>
    </div>
  );
}
