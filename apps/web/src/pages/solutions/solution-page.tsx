import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { buttonClasses } from '@/components/ui/button-classes';
import { Modal } from '@/components/ui/modal';
import { Spinner } from '@/components/ui/spinner';
import {
  activateSolution,
  deleteCase,
  deleteSolution,
  fetchSolution,
  LIMITS,
  pauseSolution,
  restoreVersion,
  saveCase,
  saveConfig,
  setVerdict,
  startTestRun,
  isAssistantDetails,
  type AnySolutionDetails,
  type AssistantConfig,
  type AssistantTone,
  type SolutionDetails,
  type TestCase,
  type TestResult,
  type Verdict,
} from '@/features/builder/api';
import { DiscoveryApiError } from '@/features/discovery/api';
import { creditsText, priceText } from '@/features/discovery/format';
import { POLL_MS } from '@/features/discovery/use-analysis';
import { useTranslation, type TranslationKey } from '@/i18n';
import { cn } from '@/lib/cn';
import { formatDateTime } from '@/lib/format-date';
import { ErrorNotice } from '@/pages/analysis/error-notice';
import { BotPanel } from './bot-panel';
import { StudyAssistantPage } from './study/study-page';
import { solutionInterface } from '@/features/solutions/registry';
import { BuilderGate, Page, StatusBadge, UnsupportedSolution } from './shared';

const TONES: readonly AssistantTone[] = ['friendly', 'neutral', 'formal', 'concise'];

/** Страница решения: интерфейс выбирается по шаблону (features/solutions/registry.ts). */
export function SolutionPage() {
  const { solutionId = '' } = useParams();
  return (
    <BuilderGate>
      <SolutionLoader key={solutionId} id={solutionId} />
    </BuilderGate>
  );
}

function SolutionLoader({ id }: { id: string }) {
  const { t } = useTranslation();
  const [details, setDetails] = useState<AnySolutionDetails | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let alive = true;
    fetchSolution(id).then(
      (loaded) => alive && setDetails(loaded),
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

  if (missing) {
    return (
      <Page title={t('builder.notFound')} back={{ to: '/solutions', label: t('builder.back') }}>
        <p className="t-lead mt-4">{t('builder.notFoundLead')}</p>
      </Page>
    );
  }
  if (!details) {
    return (
      <Page title={t('builder.title')} back={{ to: '/solutions', label: t('builder.back') }}>
        {error ? (
          <div className="mt-8">
            <ErrorNotice error={error} redirect={`/solutions/${id}`} />
          </div>
        ) : (
          <p className="mt-8 flex items-center gap-2 text-[14px] text-muted">
            <Spinner /> {t('analysis.page.loading')}
          </p>
        )}
      </Page>
    );
  }
  const ui = solutionInterface(details.solution);
  if (ui === 'assistant' && isAssistantDetails(details)) {
    return <SolutionEditor id={id} initial={details} />;
  }
  if (ui === 'study' && !isAssistantDetails(details)) {
    return <StudyAssistantPage details={details} />;
  }
  return <UnsupportedSolution />;
}

/** Помощник: настройки версиями, тест-кейсы, проверка, включение. */
function SolutionEditor({ id, initial }: { id: string; initial: SolutionDetails }) {
  const { t, language } = useTranslation();
  const [details, setDetails] = useState<SolutionDetails>(initial);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await fetchSolution(id);
      if (isAssistantDetails(next)) setDetails(next);
    } catch (caught) {
      if (caught instanceof DiscoveryApiError && caught.status === 404) setMissing(true);
      else setError(caught);
    }
  }, [id]);

  const running = details?.run?.status === 'running';
  useEffect(() => {
    if (!running) return;
    const timer = window.setTimeout(() => void refresh(), POLL_MS);
    return () => window.clearTimeout(timer);
  }, [running, details, refresh]);

  /** Действие, которое возвращает свежие данные помощника. */
  const act = async (action: () => Promise<SolutionDetails | void>) => {
    setError(null);
    try {
      const next = await action();
      if (next) setDetails(next);
      else await refresh();
    } catch (caught) {
      setError(caught);
    }
  };

  if (missing) {
    return (
      <Page title={t('builder.notFound')} back={{ to: '/solutions', label: t('builder.back') }}>
        <p className="t-lead mt-4">{t('builder.notFoundLead')}</p>
      </Page>
    );
  }

  const { solution } = details;
  const isBot = solution.type === 'customer_bot';
  return (
    <Page
      title={solution.name}
      back={{ to: '/solutions', label: t('builder.back') }}
      actions={
        isBot ? (
          solution.status !== 'draft' && solution.bot ? (
            <a
              href={`/b/${solution.bot.slug}`}
              target="_blank"
              rel="noopener"
              className={buttonClasses({ variant: 'primary', size: 'md' })}
            >
              {t('builder.bot.openPage')}
            </a>
          ) : null
        ) : solution.status === 'active' ? (
          <Link
            to={`/solutions/${id}/chat`}
            className={buttonClasses({ variant: 'primary', size: 'md' })}
          >
            {t('builder.openChat')}
          </Link>
        ) : null
      }
    >
      <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px] text-subtle">
        <StatusBadge status={solution.status} />
        <span>{t(`builder.type.${solution.type}` as TranslationKey)}</span>
        <span aria-hidden="true">·</span>
        <span>{t('builder.versionLine', { version: solution.currentVersion })}</span>
        {solution.activeVersion !== null && solution.activeVersion !== solution.currentVersion ? (
          <span>· {t('builder.activeVersionLine', { version: solution.activeVersion })}</span>
        ) : null}
        {solution.source ? (
          <span>
            ·{' '}
            <Link
              to={`/analyses/${solution.source.analysisId}`}
              className="underline underline-offset-4 hover:text-text"
            >
              {t('builder.fromAnalysis')}
            </Link>
          </span>
        ) : null}
      </div>
      {!isBot ? (
        <p className="mt-3 text-[14px] leading-6 text-muted">{t('builder.autoModelNote')}</p>
      ) : null}

      {error ? (
        <div className="mt-6">
          <ErrorNotice error={error} redirect={`/solutions/${id}`} />
        </div>
      ) : null}

      <ReadinessPanel details={details} onAct={act} />
      {isBot ? <BotPanel details={details} /> : null}
      <ConfigSection key={solution.currentVersion} details={details} onAct={act} />
      <CasesSection details={details} onAct={act} />
      <RunSection details={details} onAct={act} />
      <VersionsSection details={details} onAct={act} language={language} />
      <DangerZone details={details} />
    </Page>
  );
}

type Act = (action: () => Promise<SolutionDetails | void>) => Promise<void>;

function Section({ title, children, id }: { title: string; children: ReactNode; id?: string }) {
  return (
    <section id={id} className="mt-10 border-t border-stroke pt-8">
      <h2 className="text-[20px] font-medium tracking-[-0.01em] text-text">{title}</h2>
      {children}
    </section>
  );
}

function ReadinessPanel({ details, onAct }: { details: SolutionDetails; onAct: Act }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const { solution, readiness } = details;
  const id = solution.id;
  const run = async (action: () => Promise<SolutionDetails | void>) => {
    setBusy(true);
    await onAct(action);
    setBusy(false);
  };

  const message = readiness.ready
    ? solution.status === 'active' && solution.activeVersion === solution.currentVersion
      ? t('builder.ready.activeCurrent')
      : t('builder.ready.ok')
    : t(`builder.ready.${readiness.reason}` as TranslationKey, { failed: readiness.failed ?? 0 });

  return (
    <div
      className={cn(
        'mt-6 flex flex-col gap-3 rounded-xl border px-5 py-4 sm:flex-row sm:items-center sm:justify-between',
        readiness.ready ? 'border-success/30 bg-success-soft/40' : 'border-stroke',
      )}
      aria-live="polite"
    >
      <p className="text-[14px] leading-6 text-text">{message}</p>
      <div className="flex shrink-0 flex-wrap gap-2">
        {solution.status === 'active' ? (
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => void run(() => pauseSolution(id))}
          >
            {t('builder.pause')}
          </Button>
        ) : null}
        {readiness.ready &&
        !(solution.status === 'active' && solution.activeVersion === solution.currentVersion) ? (
          <Button
            size="sm"
            loading={busy}
            disabled={busy}
            onClick={() => void run(() => activateSolution(id))}
          >
            {solution.status === 'active'
              ? t('builder.activateNew', { version: solution.currentVersion })
              : solution.type === 'customer_bot'
                ? t('builder.bot.activate')
                : t('builder.activate')}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

// ─── Настройки ───────────────────────────────────────────────────────────────

function ConfigSection({ details, onAct }: { details: SolutionDetails; onAct: Act }) {
  const { t } = useTranslation();
  const [config, setConfig] = useState<AssistantConfig>(details.config);
  const [saving, setSaving] = useState(false);
  const changed = JSON.stringify(config) !== JSON.stringify(details.config);
  const update = (patch: Partial<AssistantConfig>) =>
    setConfig((current) => ({ ...current, ...patch }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    await onAct(() => saveConfig(details.solution.id, config));
    setSaving(false);
  };

  return (
    <Section title={t('builder.config.title')}>
      <form onSubmit={(event) => void submit(event)} className="mt-4 flex flex-col gap-5">
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
        <Field label={t('builder.config.tone')} value="">
          {(props) => (
            <select
              {...props}
              value={config.tone}
              onChange={(event) => update({ tone: event.target.value as AssistantTone })}
              className={cn(inputClass, 'sm:max-w-xs')}
            >
              {TONES.map((tone) => (
                <option key={tone} value={tone}>
                  {t(`builder.tone.${tone}` as TranslationKey)}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field
          label={t('builder.config.knowledge')}
          hint={t('builder.config.knowledgeHint')}
          max={LIMITS.knowledge}
          value={config.knowledge}
        >
          {(props) => (
            <textarea
              {...props}
              rows={6}
              value={config.knowledge}
              onChange={(event) => update({ knowledge: event.target.value })}
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

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Button
            type="submit"
            loading={saving}
            disabled={saving || !changed || !config.name.trim()}
            className="self-start"
          >
            {t('builder.config.save')}
          </Button>
          <p className="text-[13px] text-subtle" aria-live="polite">
            {changed
              ? t('builder.config.unsaved')
              : t('builder.config.saved', { version: details.solution.currentVersion })}
          </p>
        </div>
      </form>
    </Section>
  );
}

const inputClass =
  'h-11 w-full rounded-xl border border-stroke bg-surface px-4 text-[16px] text-text placeholder:text-subtle focus:border-stroke-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40';
const textareaClass =
  'block w-full resize-y rounded-xl border border-stroke bg-surface px-4 py-3 text-[16px] leading-6 text-text placeholder:text-subtle focus:border-stroke-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40';

function Field({
  label,
  hint,
  max,
  value,
  children,
}: {
  label: string;
  hint?: string;
  max?: number;
  value: string;
  children: (props: { id: string; maxLength?: number; 'aria-describedby'?: string }) => ReactNode;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-[14px] font-medium text-text">
          {label}
        </label>
        {max ? (
          <span className="text-[12px] text-subtle tabular-nums">
            {value.length} / {max}
          </span>
        ) : null}
      </div>
      {hint ? (
        <p id={hintId} className="text-[13px] leading-5 text-subtle">
          {hint}
        </p>
      ) : null}
      {children({
        id,
        ...(max ? { maxLength: max } : {}),
        ...(hint ? { 'aria-describedby': hintId } : {}),
      })}
    </div>
  );
}

function ListEditor<T>({
  title,
  hint,
  items,
  max,
  addLabel,
  onChange,
  render,
  empty,
}: {
  title: string;
  hint: string;
  items: T[];
  max: number;
  addLabel: string;
  onChange: (items: T[]) => void;
  render: (value: T, index: number, set: (value: T) => void) => ReactNode;
  empty: T;
}) {
  const { t } = useTranslation();
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-[14px] font-medium text-text">{title}</legend>
      <p className="text-[13px] leading-5 text-subtle">{hint}</p>
      {items.map((value, index) => (
        <div key={index} className="flex items-start gap-2">
          {render(value, index, (next) =>
            onChange(items.map((item, at) => (at === index ? next : item))),
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`${t('builder.remove')} ${index + 1}`}
            onClick={() => onChange(items.filter((_, at) => at !== index))}
          >
            {t('builder.remove')}
          </Button>
        </div>
      ))}
      {items.length < max ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() => onChange([...items, structuredClone(empty)])}
        >
          {addLabel}
        </Button>
      ) : null}
    </fieldset>
  );
}

// ─── Тест-кейсы ──────────────────────────────────────────────────────────────

function CasesSection({ details, onAct }: { details: SolutionDetails; onAct: Act }) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const id = details.solution.id;
  return (
    <Section title={t('builder.cases.title')}>
      <p className="mt-2 text-[14px] leading-6 text-muted">{t('builder.cases.lead')}</p>
      <ol className="mt-4 flex flex-col gap-3">
        {details.cases.map((item, index) =>
          editing === item.id ? (
            <li key={item.id}>
              <CaseForm
                initial={item}
                onCancel={() => setEditing(null)}
                onSave={async (value) => {
                  await onAct(() => saveCase(id, value, item.id));
                  setEditing(null);
                }}
              />
            </li>
          ) : (
            <li key={item.id} className="rounded-xl border border-stroke bg-surface px-5 py-4">
              <p className="text-[15px] leading-6 text-text">
                <span className="text-subtle">{index + 1}. </span>
                {item.input}
              </p>
              <ul className="mt-2 list-disc pl-5 text-[14px] leading-6 text-muted">
                {item.criteria.map((criterion) => (
                  <li key={criterion}>{criterion}</li>
                ))}
              </ul>
              <div className="mt-2 flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditing(item.id)}
                  aria-label={`${t('builder.edit')} ${index + 1}`}
                >
                  {t('builder.edit')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void onAct(() => deleteCase(id, item.id))}
                  aria-label={`${t('builder.remove')} ${index + 1}`}
                >
                  {t('builder.remove')}
                </Button>
              </div>
            </li>
          ),
        )}
      </ol>
      {editing === 'new' ? (
        <div className="mt-3">
          <CaseForm
            onCancel={() => setEditing(null)}
            onSave={async (value) => {
              await onAct(() => saveCase(id, value));
              setEditing(null);
            }}
          />
        </div>
      ) : details.cases.length < LIMITS.cases ? (
        <Button variant="outline" size="sm" className="mt-3" onClick={() => setEditing('new')}>
          {t('builder.cases.add')}
        </Button>
      ) : null}
    </Section>
  );
}

function CaseForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: TestCase;
  onSave: (value: { input: string; criteria: string[] }) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [input, setInput] = useState(initial?.input ?? '');
  const [criteria, setCriteria] = useState(initial?.criteria.join('\n') ?? '');
  const [saving, setSaving] = useState(false);
  const list = criteria
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, LIMITS.criteria);
  return (
    <form
      className="flex flex-col gap-3 rounded-xl border border-stroke-strong px-5 py-4"
      onSubmit={(event) => {
        event.preventDefault();
        setSaving(true);
        void onSave({ input: input.trim(), criteria: list }).finally(() => setSaving(false));
      }}
    >
      <Field label={t('builder.cases.input')} max={LIMITS.caseInput} value={input}>
        {(props) => (
          <textarea
            {...props}
            rows={2}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            className={textareaClass}
          />
        )}
      </Field>
      <Field label={t('builder.cases.criteria')} hint={t('builder.cases.criteriaHint')} value="">
        {(props) => (
          <textarea
            {...props}
            rows={3}
            value={criteria}
            onChange={(event) => setCriteria(event.target.value)}
            className={textareaClass}
          />
        )}
      </Field>
      <div className="flex gap-2">
        <Button
          type="submit"
          size="sm"
          loading={saving}
          disabled={saving || !input.trim() || list.length === 0}
        >
          {t('builder.cases.save')}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          {t('analysis.new.cancel')}
        </Button>
      </div>
    </form>
  );
}

// ─── Проверка ────────────────────────────────────────────────────────────────

function RunSection({ details, onAct }: { details: SolutionDetails; onAct: Act }) {
  const translator = useTranslation();
  const { t } = translator;
  const [busy, setBusy] = useState(false);
  const { run, testQuote, solution } = details;
  const id = solution.id;
  const resultsRef = useRef<HTMLDivElement | null>(null);

  return (
    <Section title={t('builder.run.title')}>
      <p className="mt-2 text-[14px] leading-6 text-muted">{t('builder.run.lead')}</p>
      {testQuote ? (
        <div className="mt-4 flex flex-col gap-2">
          <Button
            className="self-start"
            loading={busy || run?.status === 'running'}
            disabled={busy || run?.status === 'running'}
            onClick={async () => {
              setBusy(true);
              await onAct(() => startTestRun(id));
              setBusy(false);
              resultsRef.current?.focus();
            }}
          >
            {run?.status === 'running' ? t('builder.run.running') : t('builder.run.start')}
          </Button>
          <p className="text-[13px] text-subtle">
            {t('builder.run.price', {
              cases: testQuote.cases,
              price: priceText(translator, testQuote.typicalCredits, testQuote.maxCredits),
              judge: testQuote.judgeModel,
            })}
          </p>
        </div>
      ) : (
        <p className="mt-4 text-[14px] text-subtle">{t('builder.run.noCases')}</p>
      )}

      {run ? (
        <div ref={resultsRef} tabIndex={-1} className="mt-6 outline-none">
          <p className="text-[13px] text-subtle">
            {t('builder.run.meta', {
              version: run.versionNumber,
              amount: creditsText(translator, run.chargedCredits),
            })}
            {run.versionNumber !== solution.currentVersion ? ` · ${t('builder.run.outdated')}` : ''}
          </p>
          <ol className="mt-3 flex flex-col gap-3">
            {run.results.map((result, index) => (
              <ResultCard
                key={result.caseId}
                index={index}
                result={result}
                onVerdict={(verdict) =>
                  void onAct(() => setVerdict(id, run.id, result.caseId, verdict))
                }
                disabled={run.status === 'running'}
              />
            ))}
          </ol>
        </div>
      ) : null}
    </Section>
  );
}

function ResultCard({
  index,
  result,
  onVerdict,
  disabled,
}: {
  index: number;
  result: TestResult;
  onVerdict: (verdict: Verdict | null) => void;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const verdict = result.manual ?? result.judge?.verdict ?? null;
  return (
    <li className="rounded-xl border border-stroke bg-surface px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="min-w-0 text-[15px] leading-6 font-medium text-text">
          <span className="text-subtle">{index + 1}. </span>
          {result.input}
        </p>
        {result.status === 'pending' || result.status === 'running' ? (
          <Badge tone="neutral">{t(`builder.run.case.${result.status}` as TranslationKey)}</Badge>
        ) : verdict ? (
          <Badge tone={verdict === 'pass' ? 'success' : 'danger'}>
            {t(verdict === 'pass' ? 'builder.run.pass' : 'builder.run.fail')}
            {result.manual ? ` · ${t('builder.run.manual')}` : ''}
          </Badge>
        ) : (
          <Badge tone="danger">{t('builder.run.error')}</Badge>
        )}
      </div>
      {result.answer ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-[14px] text-muted hover:text-text">
            {t('builder.run.answer')}
            {result.model ? ` · ${result.model.name}` : ''}
          </summary>
          <p className="mt-2 text-[14px] leading-6 break-words whitespace-pre-wrap text-text">
            {result.answer}
          </p>
        </details>
      ) : null}
      {result.judge ? (
        <ul className="mt-2 flex flex-col gap-1 text-[14px] leading-6">
          {result.judge.criteria.map((item) => (
            <li key={item.criterion} className="flex gap-2">
              <span aria-hidden="true" className={item.met ? 'text-success' : 'text-danger'}>
                {item.met ? '✓' : '✗'}
              </span>
              <span>
                <span className="sr-only">
                  {item.met ? t('builder.run.met') : t('builder.run.notMet')}:{' '}
                </span>
                <span className="text-text">{item.criterion}</span>
                {item.note ? <span className="text-subtle"> — {item.note}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {result.error ? <p className="mt-2 text-[14px] text-danger">{result.error.message}</p> : null}
      {result.status === 'done' || result.status === 'failed' ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            variant={result.manual === 'pass' ? 'secondary' : 'ghost'}
            size="sm"
            disabled={disabled}
            aria-pressed={result.manual === 'pass'}
            onClick={() => onVerdict(result.manual === 'pass' ? null : 'pass')}
          >
            {t('builder.run.markPass')}
          </Button>
          <Button
            variant={result.manual === 'fail' ? 'secondary' : 'ghost'}
            size="sm"
            disabled={disabled}
            aria-pressed={result.manual === 'fail'}
            onClick={() => onVerdict(result.manual === 'fail' ? null : 'fail')}
          >
            {t('builder.run.markFail')}
          </Button>
        </div>
      ) : null}
    </li>
  );
}

// ─── Версии и удаление ───────────────────────────────────────────────────────

function VersionsSection({
  details,
  onAct,
  language,
}: {
  details: SolutionDetails;
  onAct: Act;
  language: 'ru' | 'en';
}) {
  const { t } = useTranslation();
  const { solution } = details;
  return (
    <Section title={t('builder.versions.title')}>
      <ul className="mt-4 flex flex-col gap-2">
        {details.versions.map((version) => (
          <li
            key={version.number}
            className="flex flex-wrap items-center justify-between gap-2 text-[14px]"
          >
            <span className="text-text">
              {t('builder.versions.item', { version: version.number })}
              <span className="text-subtle"> · {formatDateTime(version.createdAt, language)}</span>
              {version.number === solution.currentVersion ? (
                <span className="text-subtle"> · {t('builder.versions.current')}</span>
              ) : null}
              {version.number === solution.activeVersion ? (
                <span className="text-success"> · {t('builder.versions.active')}</span>
              ) : null}
            </span>
            {version.number !== solution.currentVersion ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void onAct(() => restoreVersion(solution.id, version.number))}
              >
                {t('builder.versions.restore')}
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </Section>
  );
}

function DangerZone({ details }: { details: SolutionDetails }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const bot = details.solution.type === 'customer_bot';
  return (
    <Section title={t('builder.delete.title')}>
      <Button variant="outline" size="sm" className="mt-4" onClick={() => setOpen(true)}>
        {bot ? t('builder.bot.delete.button') : t('builder.delete.button')}
      </Button>
      {open ? (
        <Modal labelledBy="delete-solution-title" size="sm" onClose={() => setOpen(false)}>
          <div className="flex flex-col gap-4 p-6">
            <h2 id="delete-solution-title" className="text-[18px] font-medium text-text">
              {bot ? t('builder.bot.delete.confirmTitle') : t('builder.delete.confirmTitle')}
            </h2>
            <p className="text-[14px] leading-6 text-muted">
              {t(bot ? 'builder.bot.delete.confirmText' : 'builder.delete.confirmText', {
                name: details.solution.name,
              })}
            </p>
            {error ? <ErrorNotice error={error} redirect="/solutions" /> : null}
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <Button variant="outline" onClick={() => setOpen(false)}>
                {t('analysis.new.cancel')}
              </Button>
              <Button
                variant="danger"
                loading={busy}
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  deleteSolution(details.solution.id)
                    .then(() => navigate('/solutions', { replace: true }))
                    .catch((caught: unknown) => {
                      setError(caught);
                      setBusy(false);
                    });
                }}
              >
                {bot ? t('builder.bot.delete.button') : t('builder.delete.button')}
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}
    </Section>
  );
}
