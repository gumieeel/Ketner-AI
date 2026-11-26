import { useEffect, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { buttonClasses } from '@/components/ui/button-classes';
import { Spinner } from '@/components/ui/spinner';
import { useAuth } from '@/features/auth/auth-store';
import {
  fetchBot,
  fetchSolution,
  isAssistantDetails,
  type BotOverview,
  type SolutionDetails,
} from '@/features/builder/api';
import { wizardLaunchPath, wizardSetupPath, wizardStartPath } from '@/features/builder/wizard';
import { DiscoveryApiError } from '@/features/discovery/api';
import { useTranslation } from '@/i18n';
import { ErrorNotice } from '@/pages/analysis/error-notice';
import { GoogleSheetCard } from '../google-sheet-card';
import { BuilderGate, Page } from '../shared';
import { ConnectionCard, ConnectionGroup } from './connection-card';
import { WizardFrame } from './wizard-frame';

/**
 * Шаг 3 мастера — «Подключения» (docs/BUILDER_V1.md, разделы 6 и 8; сверка с макетами — раздел
 * 12, п. 7–8). Три группы, и только первая считается в тарифе:
 * - внешние сервисы — системы данных (Google Таблица; CRM и календарь — «скоро»);
 * - уведомления вам — почта аккаунта и Telegram бота Ketner;
 * - каналы — где клиенты пишут агенту (страница, кнопка на сайте; Telegram-бот клиента — позже).
 * Подключение Таблицы — та же карточка, что на странице бота; возврат от Google — сюда же.
 */
export function WizardConnectionsPage() {
  const { solutionId = '' } = useParams();
  return (
    <BuilderGate>
      <ConnectionsLoader key={solutionId} id={solutionId} />
    </BuilderGate>
  );
}

function ConnectionsLoader({ id }: { id: string }) {
  const { t } = useTranslation();
  const [details, setDetails] = useState<SolutionDetails | null>(null);
  const [overview, setOverview] = useState<BotOverview | null>(null);
  const [other, setOther] = useState(false);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([fetchSolution(id), fetchBot(id).catch(() => null)]).then(
      ([loaded, bot]) => {
        if (!alive) return;
        if (!isAssistantDetails(loaded) || loaded.solution.type !== 'customer_bot' || !bot) {
          setOther(true);
          return;
        }
        setDetails(loaded);
        setOverview(bot);
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
  if (!details || !overview) {
    return (
      <WizardFrame title={t('wizard.title.customer_bot')} current="connections">
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
  return <ConnectionsStep details={details} overview={overview} />;
}

function ConnectionsStep({
  details,
  overview,
}: {
  details: SolutionDetails;
  overview: BotOverview;
}) {
  const { t } = useTranslation();
  const email = useAuth((state) => state.user?.email ?? null);
  const { solution } = details;
  const source = solution.source;
  const step1 = source ? wizardStartPath(source.analysisId, source.opportunityId) : undefined;
  const step2 = wizardSetupPath(solution.id);

  const automations = overview.automations ?? [];
  const sheetAutomation = automations.find((item) => item.id === 'lead_to_sheet');
  const manager = automations.find((item) => item.id === 'lead_to_manager');
  // Каналы уведомлений: из каталога автоматизаций, у старого сервера — из `leadNotify`.
  const channels = manager
    ? manager.enabled && manager.options
      ? manager.options
      : { email: false, telegram: false }
    : (overview.settings.leadNotify ?? { email: true, telegram: false });
  const telegramLinked = overview.leadNotify?.telegramLinked ?? false;
  const sites = overview.install?.sites ?? [];
  const draft = solution.status === 'draft';

  return (
    <WizardFrame
      title={t('wizard.title.customer_bot')}
      subtitle={solution.name}
      current="connections"
      hrefs={{ ...(step1 ? { analysis: step1 } : {}), setup: step2 }}
      back={{ to: '/solutions', label: t('builder.back') }}
    >
      <div className="mt-6 flex flex-col gap-8">
        <ConnectionGroup
          id="services"
          title={t('wizard.connections.services.title')}
          lead={t('wizard.connections.services.lead')}
        >
          {sheetAutomation ? (
            <p className="text-[13px] leading-5 text-subtle" data-testid="sheet-needed">
              {sheetAutomation.enabled
                ? t('wizard.connections.sheet.needed')
                : t('wizard.connections.sheet.notNeeded')}
            </p>
          ) : null}
          {/* Та же карточка, что на странице бота: подключение, поломки, тариф, «дописать». */}
          <GoogleSheetCard onChange={() => undefined} onAvailable={() => undefined} />
          <ConnectionCard
            id="crm"
            title={t('wizard.connections.crm.title')}
            description={t('wizard.connections.crm.description')}
            state={{ tone: 'neutral', label: t('wizard.connections.soon') }}
          />
        </ConnectionGroup>

        <ConnectionGroup
          id="notify"
          title={t('wizard.connections.notify.title')}
          lead={t('wizard.connections.notify.lead')}
        >
          <ConnectionCard
            id="email"
            title={t('wizard.connections.email.title')}
            description={
              email
                ? t('wizard.connections.email.description', { email })
                : t('wizard.connections.email.noAddress')
            }
            state={
              !channels.email
                ? { tone: 'neutral', label: t('wizard.connections.off') }
                : email
                  ? { tone: 'success', label: t('wizard.connections.works') }
                  : { tone: 'warning', label: t('wizard.connections.email.noAddressState') }
            }
          />
          <ConnectionCard
            id="telegram"
            title={t('wizard.connections.telegram.title')}
            description={t('wizard.connections.telegram.description')}
            state={
              !channels.telegram
                ? { tone: 'neutral', label: t('wizard.connections.off') }
                : telegramLinked
                  ? { tone: 'success', label: t('wizard.connections.telegram.linked') }
                  : { tone: 'warning', label: t('wizard.connections.telegram.notLinked') }
            }
          >
            {channels.telegram && !telegramLinked ? (
              <Link to="/settings" className="text-accent underline-offset-4 hover:underline">
                {t('builder.bot.notify.link')}
              </Link>
            ) : null}
          </ConnectionCard>
          <p className="text-[13px] leading-5 text-subtle">
            {t('wizard.connections.notify.change')}{' '}
            <Link to={step2} className="underline underline-offset-4 hover:text-text">
              {t('wizard.step.setup')}
            </Link>
          </p>
        </ConnectionGroup>

        <ConnectionGroup
          id="channels"
          title={t('wizard.connections.channels.title')}
          lead={t('wizard.connections.channels.lead')}
        >
          <ConnectionCard
            id="page"
            title={t('wizard.connections.page.title')}
            description={t('wizard.connections.page.description')}
            state={
              draft
                ? { tone: 'neutral', label: t('wizard.connections.page.afterLaunch') }
                : { tone: 'success', label: t('wizard.connections.works') }
            }
          >
            {!draft ? (
              <a
                href={overview.publicUrl}
                target="_blank"
                rel="noopener"
                className="break-all text-accent underline-offset-4 hover:underline"
              >
                {overview.publicUrl}
              </a>
            ) : null}
          </ConnectionCard>
          <ConnectionCard
            id="widget"
            title={t('wizard.connections.widget.title')}
            description={t('wizard.connections.widget.description')}
            state={
              sites.length > 0
                ? {
                    tone: 'success',
                    label: t('wizard.connections.widget.seen', { count: String(sites.length) }),
                  }
                : { tone: 'neutral', label: t('wizard.connections.widget.notSeen') }
            }
          />
          <ConnectionCard
            id="telegram-channel"
            title={t('wizard.connections.telegramChannel.title')}
            description={t('wizard.connections.telegramChannel.description')}
            state={{ tone: 'neutral', label: t('wizard.connections.later') }}
          />
        </ConnectionGroup>
      </div>

      <div className="mt-8 flex flex-col gap-3 border-t border-stroke pt-6 sm:flex-row sm:items-center sm:justify-between">
        <Link to={step2} className={buttonClasses({ variant: 'outline', size: 'md' })}>
          {t('wizard.back')}
        </Link>
        <div className="flex flex-col items-start gap-1 sm:items-end">
          <Link
            to={wizardLaunchPath(solution.id)}
            className={buttonClasses({ variant: 'primary', size: 'md' })}
          >
            {t('wizard.next.toLaunch')}
          </Link>
        </div>
      </div>
    </WizardFrame>
  );
}
