import { useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { buttonClasses } from '@/components/ui/button-classes';
import { Spinner } from '@/components/ui/spinner';
import { Tab, TabList, TabPanel, Tabs } from '@/components/ui/tabs';
import {
  fetchBot,
  fetchSolution,
  isAssistantDetails,
  LIMITS,
  saveBotAutomations,
  saveConfig,
  type AssistantConfig,
  type AssistantTone,
  type AutomationsPatch,
  type AutomationView,
  type BotOverview,
  type SolutionDetails,
} from '@/features/builder/api';
import { wizardConnectionsPath, wizardStartPath } from '@/features/builder/wizard';
import { DiscoveryApiError } from '@/features/discovery/api';
import { useTranslation, type TranslationKey } from '@/i18n';
import { cn } from '@/lib/cn';
import { ErrorNotice } from '@/pages/analysis/error-notice';
import { BotPreviewChat } from '../bot-preview-chat';
import { Field, inputClass, ListEditor, textareaClass } from '../config-fields';
import { BuilderGate, Page } from '../shared';
import { WizardFrame } from './wizard-frame';

/**
 * Шаг 2 мастера — «Настройка» бота для клиентов (docs/BUILDER_V1.md, разделы 3, 4 и 12):
 * слева поведение, знания и каталог автоматизаций, справа проба «как клиент» и статистика (до
 * запуска — пустая). Настройки сохраняются версией, как на странице решения; переключатели
 * автоматизаций — сразу (у запущенного бота это видно рядом с ними). Дальше — шаг 3, подключения.
 */
export function WizardSetupPage() {
  const { solutionId = '' } = useParams();
  return (
    <BuilderGate>
      <SetupLoader key={solutionId} id={solutionId} />
    </BuilderGate>
  );
}

const TONES: readonly AssistantTone[] = ['friendly', 'neutral', 'formal', 'concise'];

function SetupLoader({ id }: { id: string }) {
  const { t } = useTranslation();
  const [details, setDetails] = useState<SolutionDetails | null>(null);
  const [overview, setOverview] = useState<BotOverview | null>(null);
  const [other, setOther] = useState(false);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let alive = true;
    fetchSolution(id).then(
      async (loaded) => {
        if (!alive) return;
        if (!isAssistantDetails(loaded) || loaded.solution.type !== 'customer_bot') {
          setOther(true);
          return;
        }
        setDetails(loaded);
        try {
          const bot = await fetchBot(id);
          if (alive) setOverview(bot);
        } catch (caught) {
          if (alive) setError(caught);
        }
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

  // Мастер сейчас — только для бота для клиентов; остальные типы настраиваются на своей странице.
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
      <WizardFrame title={t('wizard.title.customer_bot')} current="setup">
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
  return (
    <SetupStep
      details={details}
      overview={overview}
      onDetails={setDetails}
      onOverview={setOverview}
    />
  );
}

function SetupStep({
  details,
  overview,
  onDetails,
  onOverview,
}: {
  details: SolutionDetails;
  overview: BotOverview;
  onDetails: (next: SolutionDetails) => void;
  onOverview: (next: BotOverview) => void;
}) {
  const { t } = useTranslation();
  const { solution } = details;
  const source = solution.source;
  const step1 = source ? wizardStartPath(source.analysisId, source.opportunityId) : undefined;

  return (
    <WizardFrame
      title={t('wizard.title.customer_bot')}
      subtitle={solution.name}
      current="setup"
      hrefs={step1 ? { analysis: step1 } : {}}
      back={{ to: '/solutions', label: t('builder.back') }}
    >
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
        <SettingsPanel
          key={solution.currentVersion}
          details={details}
          overview={overview}
          onDetails={onDetails}
          onOverview={onOverview}
        />
        <aside
          aria-label={t('wizard.panel.label')}
          className="self-start rounded-2xl border border-stroke bg-surface p-4 sm:p-5"
        >
          <Tabs defaultValue="preview">
            <TabList aria-label={t('wizard.panel.label')}>
              <Tab value="preview">{t('wizard.panel.preview')}</Tab>
              <Tab value="stats">{t('wizard.panel.stats')}</Tab>
            </TabList>
            <TabPanel value="preview">
              <p className="text-[13px] leading-5 text-subtle">{t('builder.bot.preview.lead')}</p>
              <BotPreviewChat id={solution.id} />
            </TabPanel>
            <TabPanel value="stats">
              <p className="text-[14px] leading-6 text-muted" data-testid="wizard-stats-empty">
                {t('wizard.panel.statsEmpty')}
              </p>
            </TabPanel>
          </Tabs>
        </aside>
      </div>

      <div className="mt-8 flex flex-col gap-3 border-t border-stroke pt-6 sm:flex-row sm:items-center sm:justify-between">
        {step1 ? (
          <Link to={step1} className={buttonClasses({ variant: 'outline', size: 'md' })}>
            {t('wizard.back')}
          </Link>
        ) : (
          <span />
        )}
        <div className="flex flex-col items-start gap-1 sm:items-end">
          <Link
            to={wizardConnectionsPath(solution.id)}
            className={buttonClasses({ variant: 'primary', size: 'md' })}
          >
            {t('wizard.next.toConnections')}
          </Link>
        </div>
      </div>
    </WizardFrame>
  );
}

function SettingsPanel({
  details,
  overview,
  onDetails,
  onOverview,
}: {
  details: SolutionDetails;
  overview: BotOverview;
  onDetails: (next: SolutionDetails) => void;
  onOverview: (next: BotOverview) => void;
}) {
  const { t } = useTranslation();
  const [config, setConfig] = useState<AssistantConfig>(details.config);
  const [tab, setTab] = useState('behavior');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const changed = JSON.stringify(config) !== JSON.stringify(details.config);
  const update = (patch: Partial<AssistantConfig>) =>
    setConfig((current) => ({ ...current, ...patch }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      onDetails(await saveConfig(details.solution.id, config));
    } catch (caught) {
      setError(caught);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      aria-label={t('wizard.setup.label')}
      className="rounded-2xl border border-stroke bg-surface p-4 sm:p-5"
    >
      <Tabs value={tab} onValueChange={setTab}>
        <TabList aria-label={t('wizard.setup.label')}>
          <Tab value="behavior">{t('wizard.setup.tab.behavior')}</Tab>
          <Tab value="knowledge">{t('wizard.setup.tab.knowledge')}</Tab>
          {overview.automations ? (
            <Tab value="automations">{t('wizard.setup.tab.automations')}</Tab>
          ) : null}
        </TabList>

        <form onSubmit={(event) => void submit(event)}>
          <TabPanel value="behavior" className="flex flex-col gap-5">
            <Field label={t('builder.config.name')} max={LIMITS.name} value={config.name}>
              {(props) => (
                <input
                  {...props}
                  required
                  value={config.name}
                  onChange={(event) => update({ name: event.target.value })}
                  className={inputClass}
                />
              )}
            </Field>
            <Field
              label={t('builder.config.purpose')}
              hint={t('builder.config.purposeHint')}
              max={LIMITS.purpose}
              value={config.purpose}
            >
              {(props) => (
                <textarea
                  {...props}
                  rows={2}
                  value={config.purpose}
                  onChange={(event) => update({ purpose: event.target.value })}
                  className={textareaClass}
                />
              )}
            </Field>
            <fieldset className="flex flex-col gap-2">
              <legend className="text-[14px] font-medium text-text">
                {t('wizard.setup.tone')}
              </legend>
              <div className="flex flex-wrap gap-2">
                {TONES.map((tone) => (
                  <label
                    key={tone}
                    className={cn(
                      'inline-flex min-h-10 cursor-pointer items-center rounded-full border px-4 text-[14px]',
                      config.tone === tone
                        ? 'border-accent bg-accent-soft text-text'
                        : 'border-stroke text-muted hover:text-text',
                    )}
                  >
                    <input
                      type="radio"
                      name="tone"
                      value={tone}
                      checked={config.tone === tone}
                      onChange={() => update({ tone })}
                      className="sr-only"
                    />
                    {t(`builder.tone.${tone}` as TranslationKey)}
                  </label>
                ))}
              </div>
            </fieldset>
            <Field
              label={t('builder.config.instructions')}
              hint={t('builder.config.instructionsHint')}
              max={LIMITS.instructions}
              value={config.instructions}
            >
              {(props) => (
                <textarea
                  {...props}
                  rows={6}
                  value={config.instructions}
                  onChange={(event) => update({ instructions: event.target.value })}
                  className={textareaClass}
                />
              )}
            </Field>
            <ListEditor
              title={t('builder.config.restrictions')}
              hint={t('builder.config.restrictionsHint')}
              items={config.restrictions}
              max={LIMITS.restrictions}
              addLabel={t('builder.config.addRestriction')}
              onChange={(restrictions) => update({ restrictions })}
              render={(value, index, set) => (
                <input
                  aria-label={`${t('builder.config.restriction')} ${index + 1}`}
                  value={value}
                  maxLength={LIMITS.restrictionChars}
                  onChange={(event) => set(event.target.value)}
                  className={inputClass}
                />
              )}
              empty=""
            />
          </TabPanel>

          <TabPanel value="knowledge" className="flex flex-col gap-5">
            <Field
              label={t('builder.config.knowledge')}
              hint={t('builder.config.knowledgeHint')}
              max={LIMITS.knowledge}
              value={config.knowledge}
            >
              {(props) => (
                <textarea
                  {...props}
                  rows={10}
                  value={config.knowledge}
                  onChange={(event) => update({ knowledge: event.target.value })}
                  className={textareaClass}
                />
              )}
            </Field>
            <ListEditor
              title={t('builder.config.examples')}
              hint={t('builder.config.examplesHint')}
              items={config.examples}
              max={LIMITS.examples}
              addLabel={t('builder.config.addExample')}
              onChange={(examples) => update({ examples })}
              empty={{ input: '', output: '' }}
              render={(value, index, set) => (
                <div className="grid flex-1 gap-2">
                  <textarea
                    aria-label={`${t('builder.config.exampleInput')} ${index + 1}`}
                    placeholder={t('builder.config.exampleInput')}
                    rows={2}
                    value={value.input}
                    maxLength={LIMITS.exampleChars}
                    onChange={(event) => set({ ...value, input: event.target.value })}
                    className={textareaClass}
                  />
                  <textarea
                    aria-label={`${t('builder.config.exampleOutput')} ${index + 1}`}
                    placeholder={t('builder.config.exampleOutput')}
                    rows={3}
                    value={value.output}
                    maxLength={LIMITS.exampleChars}
                    onChange={(event) => set({ ...value, output: event.target.value })}
                    className={textareaClass}
                  />
                </div>
              )}
            />
          </TabPanel>

          {tab === 'automations' ? null : (
            <SaveRow
              saving={saving}
              changed={changed}
              valid={Boolean(config.name.trim())}
              version={details.solution.currentVersion}
            />
          )}
        </form>

        {overview.automations ? (
          <TabPanel value="automations">
            <AutomationsList
              solutionId={details.solution.id}
              live={details.solution.status !== 'draft'}
              overview={overview}
              automations={overview.automations}
              onOverview={onOverview}
            />
          </TabPanel>
        ) : null}
      </Tabs>
      {error ? (
        <div className="mt-3">
          <ErrorNotice error={error} redirect={`/solutions/${details.solution.id}/setup`} />
        </div>
      ) : null}
    </section>
  );
}

/** Кнопка сохранения настроек — общая для «Поведения» и «Знаний»: правки не теряются при смене вкладки. */
function SaveRow({
  saving,
  changed,
  valid,
  version,
}: {
  saving: boolean;
  changed: boolean;
  valid: boolean;
  version: number;
}) {
  const { t } = useTranslation();
  return (
    <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-center">
      <Button
        type="submit"
        loading={saving}
        disabled={saving || !changed || !valid}
        className="self-start"
      >
        {t('builder.config.save')}
      </Button>
      <p className="text-[13px] text-subtle" aria-live="polite">
        {changed ? t('builder.config.unsaved') : t('builder.config.saved', { version })}
      </p>
    </div>
  );
}

const RISK_TONE: Record<AutomationView['risk'], BadgeTone> = {
  low: 'neutral',
  medium: 'warning',
  high: 'danger',
  critical: 'danger',
};

/**
 * Каталог автоматизаций (раздел 4.1): переключатели сохраняются сразу. Недоступный шаблон виден с
 * причиной и не включается; внешний сервис подключается на шаге «Подключения».
 */
function AutomationsList({
  solutionId,
  live,
  overview,
  automations,
  onOverview,
}: {
  solutionId: string;
  /** Бот уже запущен (или на паузе — заявки он принимает): переключатели действуют сразу. */
  live: boolean;
  overview: BotOverview;
  automations: AutomationView[];
  onOverview: (next: BotOverview) => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const telegramLinked = overview.leadNotify?.telegramLinked ?? false;

  const save = async (patch: AutomationsPatch) => {
    setBusy(true);
    setError(null);
    try {
      onOverview(await saveBotAutomations(solutionId, patch));
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[13px] leading-5 text-subtle">{t('wizard.automations.lead')}</p>
      {live ? (
        <p
          className="rounded-xl border border-warning/40 bg-warning-soft/40 px-4 py-2 text-[14px] leading-6 text-text"
          data-testid="automations-live"
        >
          {t('wizard.automations.live')}
        </p>
      ) : null}
      <ul className="flex flex-col gap-3">
        {automations.map((item) => {
          const external = item.connections.some(
            (connection) => connection.kind === 'external_service',
          );
          return (
            <li
              key={item.id}
              data-automation={item.id}
              className={cn(
                'rounded-xl border px-4 py-3',
                item.enabled ? 'border-stroke-strong' : 'border-stroke',
              )}
            >
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-1 size-4 accent-[var(--accent)]"
                  checked={item.enabled}
                  disabled={busy || !item.available}
                  onChange={(event) => void save({ [item.id]: { enabled: event.target.checked } })}
                />
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-2 text-[15px] font-medium text-text">
                    {t(`wizard.automation.${item.id}.title` as TranslationKey)}
                    <Badge tone={RISK_TONE[item.risk]}>
                      {t(`builder.bot.diagram.risk.${item.risk}` as TranslationKey)}
                    </Badge>
                    {!item.available ? (
                      <Badge tone="neutral">{t('wizard.automation.soon')}</Badge>
                    ) : null}
                  </span>
                  <span className="text-[14px] leading-6 text-muted">
                    {t(`wizard.automation.${item.id}.description` as TranslationKey)}
                  </span>
                  {!item.available ? (
                    <span className="text-[13px] text-subtle">
                      {t(`wizard.automation.${item.id}.unavailable` as TranslationKey)}
                    </span>
                  ) : external ? (
                    <span className="text-[13px] text-subtle">
                      {t('wizard.automation.needsService')}
                    </span>
                  ) : null}
                </span>
              </label>
              {item.id === 'lead_to_manager' && item.enabled && item.options ? (
                <div className="mt-2 ml-7 flex flex-col gap-1">
                  {(['email', 'telegram'] as const).map((channel) => (
                    <label
                      key={channel}
                      className="flex min-h-8 items-center gap-3 text-[14px] text-text"
                    >
                      <input
                        type="checkbox"
                        className="size-4 accent-[var(--accent)]"
                        checked={item.options![channel]}
                        disabled={busy}
                        onChange={(event) =>
                          void save({
                            lead_to_manager: { options: { [channel]: event.target.checked } },
                          })
                        }
                      />
                      {t(
                        channel === 'email'
                          ? 'builder.bot.notify.email'
                          : 'builder.bot.notify.telegram',
                      )}
                    </label>
                  ))}
                  {item.options.telegram && !telegramLinked ? (
                    <p className="text-[13px] leading-5 text-subtle">
                      {t('builder.bot.notify.telegramNotLinked')}{' '}
                      <Link
                        to="/settings"
                        className="text-accent underline-offset-4 hover:underline"
                      >
                        {t('builder.bot.notify.link')}
                      </Link>
                    </p>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      {error ? <ErrorNotice error={error} redirect={`/solutions/${solutionId}/setup`} /> : null}
    </div>
  );
}
