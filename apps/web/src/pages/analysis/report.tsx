import { useEffect, useId, useState, type ReactNode } from 'react';
import { AutomationPlan } from '@/components/pricing/automation-plan';
import { DiscoveryApiError } from '@/features/discovery/api';
import { Link, useNavigate } from 'react-router-dom';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { buttonClasses } from '@/components/ui/button-classes';
import {
  createPlan,
  setAnalysisSaved,
  type PlansSummary,
  type AnalysisView,
  type FeasibilityItem,
  type FeasibilityStatus,
  type OpportunityView,
  type AreaCoverage,
} from '@/features/discovery/api';
import { creditsText, priceText } from '@/features/discovery/format';
import { useTranslation, type TranslationKey } from '@/i18n';
import { cn } from '@/lib/cn';
import { useAuth } from '@/features/auth/auth-store';
import {
  createFromOpportunity,
  fetchDraftQuote,
  listSolutions,
  type SolutionView,
} from '@/features/builder/api';
import { BusinessProfile } from './business-profile';
import { ErrorNotice } from './error-notice';

const FEASIBILITY_TONE: Record<FeasibilityStatus, BadgeTone> = {
  ready: 'success',
  needs_setup: 'info',
  needs_integration: 'warning',
  not_supported: 'neutral',
};

/** Кнопки действий в карточке: длинная надпись переносится, а не вылезает за карточку на телефоне. */
const ACTION_WRAP = 'self-start max-w-full whitespace-normal h-auto min-h-9 py-2 text-center';

/** Сколько первых шагов показать в «С чего начать». */
const START_STEPS = 3;

/**
 * Отчёт анализа: вывод, с чего начать, возможности со статусом реализуемости и всеми полями.
 * Статус и польза посчитаны сервером по каталогу возможностей и числам пользователя; здесь
 * они только показываются.
 */
export function Report({
  analysis,
  plans,
  onChanged,
}: {
  analysis: AnalysisView;
  plans: PlansSummary | null;
  onChanged: () => Promise<void>;
}) {
  const translator = useTranslation();
  const { t } = translator;
  const builder = useBuilderSummary();
  const sorted = [...analysis.opportunities].sort((a, b) => a.priority - b.priority);
  // Анализ по плану (этап A): главная рекомендация — первая возможность с готовым рецептом.
  const planned = analysis.coverage !== null;
  const main = planned ? (sorted.find((item) => item.recipe !== null) ?? null) : null;
  const opportunities = main ? sorted.filter((item) => item.id !== main.id) : sorted;
  const startWith = sorted
    .filter((item) => item.feasibilityStatus !== 'not_supported' && item.firstStep)
    .slice(0, START_STEPS);
  const actionFor = (item: OpportunityView, featured: boolean) =>
    item.feasibilityStatus === 'not_supported' ? null : (
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start">
        {/* Готовая автоматизация — первым действием; у возможности без рецепта — только план. */}
        {item.recipe === 'personal_assistant' ||
        item.recipe === 'customer_bot' ||
        item.recipe === 'study_assistant' ? (
          <SolutionAction
            analysis={analysis}
            opportunity={item}
            builder={builder}
            primary={featured}
            start
          />
        ) : null}
        {plans ? (
          <PlanAction
            analysis={analysis}
            opportunity={item}
            plans={plans}
            secondary={item.recipe !== null}
          />
        ) : null}
        {!planned ? (
          <SolutionAction analysis={analysis} opportunity={item} builder={builder} />
        ) : null}
      </div>
    );
  const situation = analysis.context?.summary ?? analysis.inputText;

  return (
    <section aria-labelledby="result-title" className="mt-10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 id="result-title" className="text-[24px] font-[480] tracking-[-0.02em] text-text">
          {t('analysis.ready.title')}
        </h2>
        <SaveControl analysis={analysis} onChanged={onChanged} />
      </div>
      {analysis.summary ? (
        <p className="mt-3 text-[16px] leading-[1.65] text-text">{analysis.summary}</p>
      ) : null}
      <p className="mt-2 text-[13px] text-subtle">
        {analysis.cost.sponsored && analysis.cost.chargedCredits === 0
          ? t('analysis.ready.free')
          : t('analysis.ready.charged', {
              amount: creditsText(translator, analysis.cost.chargedCredits),
            })}
      </p>
      <SourceNote analysis={analysis} />

      <BusinessProfile analysis={analysis} />

      {main ? (
        <section aria-labelledby="main-title" className="mt-8">
          <h3 id="main-title" className="text-[18px] font-medium text-text">
            {t('analysis.main.title')}
          </h3>
          <ul className="mt-3">
            <OpportunityCard
              item={main}
              featured
              situation={situation}
              action={actionFor(main, true)}
            />
          </ul>
        </section>
      ) : null}

      {analysis.coverage ? <AnalysisMap coverage={analysis.coverage} /> : null}

      {startWith.length > 0 ? (
        <section aria-labelledby="start-title" className="mt-8">
          <h3 id="start-title" className="text-[18px] font-medium text-text">
            {t('analysis.report.startTitle')}
          </h3>
          <ol className="mt-3 flex flex-col gap-2">
            {startWith.map((item, index) => (
              <li
                key={item.id}
                className="flex gap-3 rounded-xl border border-stroke px-4 py-3 text-[15px] leading-6"
              >
                <span aria-hidden="true" className="font-medium text-accent">
                  {index + 1}
                </span>
                <span className="min-w-0">
                  <span className="text-text">{item.firstStep}</span>
                  <span className="block text-[13px] text-subtle">{item.title}</span>
                </span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <h3 className="mt-10 text-[18px] font-medium text-text">
        {main ? t('analysis.main.others') : t('analysis.report.opportunitiesTitle')}
      </h3>
      {opportunities.length === 0 ? (
        <p className="mt-3 text-[15px] leading-6 text-muted">{t('analysis.ready.empty')}</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-3">
          {opportunities.map((item) => (
            <OpportunityCard
              key={item.id}
              item={item}
              situation={situation}
              action={actionFor(item, false)}
            />
          ))}
        </ul>
      )}
      <p className="mt-4 text-[13px] leading-5 text-subtle">{t('analysis.report.statusNote')}</p>
    </section>
  );
}

function SaveControl({
  analysis,
  onChanged,
}: {
  analysis: AnalysisView;
  onChanged: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const href = `/login?redirect=${encodeURIComponent(`/analyses/${analysis.id}`)}`;

  if (analysis.guest) {
    return (
      <Link to={href} className={buttonClasses({ variant: 'outline', size: 'sm' })}>
        {t('analysis.report.loginToSave')}
      </Link>
    );
  }
  return (
    <div className="flex flex-col items-end gap-2">
      <Button
        variant={analysis.saved ? 'secondary' : 'outline'}
        size="sm"
        loading={busy}
        disabled={busy}
        aria-pressed={analysis.saved}
        onClick={() => {
          setBusy(true);
          setError(null);
          setAnalysisSaved(analysis.id, !analysis.saved)
            .then(onChanged)
            .catch((caught: unknown) => setError(caught))
            .finally(() => setBusy(false));
        }}
      >
        {analysis.saved ? t('analysis.report.saved') : t('analysis.report.save')}
      </Button>
      {error instanceof DiscoveryApiError && error.code === 'subscription_required' ? (
        // Этап E: автоматизация — по подписке с пробным месяцем; после оплаты — назад в отчёт.
        <div className="mt-1 flex flex-col gap-2">
          <p className="text-[14px] text-text">{t('automation.required')}</p>
          <AutomationPlan compact returnPath={`/analyses/${analysis.id}`} />
        </div>
      ) : error ? (
        <ErrorNotice error={error} redirect={`/analyses/${analysis.id}`} />
      ) : null}
    </div>
  );
}

function OpportunityCard({
  item,
  action,
  situation,
  featured = false,
}: {
  item: OpportunityView;
  action: ReactNode;
  situation: string;
  featured?: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  const headingId = useId();

  return (
    <li
      className={cn(
        'rounded-xl border bg-surface px-5 py-4',
        featured ? 'border-accent/50 shadow-sm' : 'border-stroke',
      )}
    >
      {item.area || item.recipe ? (
        <p className="mb-1 text-[13px] text-subtle">
          {item.area ? t(`analysis.map.area.${item.area}` as TranslationKey) : null}
          {item.area && item.recipe ? ' · ' : null}
          {item.recipe ? t(`analysis.recipe.${item.recipe}` as TranslationKey) : null}
        </p>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h4
          id={headingId}
          className={cn(
            'min-w-0 leading-6 font-medium text-text',
            featured ? 'text-[18px]' : 'text-[16px]',
          )}
        >
          {item.title}
        </h4>
        <Badge tone={FEASIBILITY_TONE[item.feasibilityStatus]}>
          {t(`analysis.feasibility.${item.feasibilityStatus}` as TranslationKey)}
        </Badge>
      </div>
      <p className="mt-2 text-[15px] leading-6 text-muted">{item.solution}</p>
      <p className="mt-2 text-[14px] leading-6">
        <span className="text-subtle">{t('analysis.ready.benefit')}: </span>
        <span className="text-text">
          {item.impact.kind === 'estimate'
            ? `${t('analysis.ready.hours', {
                from: item.impact.hoursPerWeek[0],
                to: item.impact.hoursPerWeek[1],
              })}. `
            : ''}
          {item.impact.benefit}
        </span>
        <span className="text-subtle">
          {' · '}
          {t(`analysis.report.effort.${item.effort}` as TranslationKey)}
        </span>
      </p>
      {item.feasibilityStatus === 'not_supported' ? (
        <p className="mt-2 text-[14px] leading-6 text-muted">
          {t('analysis.report.notSupported', {
            what: item.feasibility.blockers.map((blocker) => blocker.label).join(', '),
          })}
        </p>
      ) : null}

      {action}
      <div className="mt-3 flex flex-wrap gap-x-5">
        <Link
          to="/chat"
          state={{
            prompt: t('analysis.chat.opportunityPrompt', {
              title: item.title,
              problem: item.problem,
              solution: item.solution,
              situation: situation.slice(0, 600),
            }),
          }}
          className="inline-flex min-h-11 items-center text-[14px] text-muted underline underline-offset-4 hover:text-text md:min-h-0"
        >
          {t('analysis.chat.discuss')}
        </Link>

        <button
          type="button"
          aria-expanded={open}
          aria-controls={detailsId}
          onClick={() => setOpen((value) => !value)}
          className="inline-flex min-h-11 items-center text-[14px] font-medium text-muted underline underline-offset-4 hover:text-text md:min-h-0"
        >
          {open ? t('analysis.report.less') : t('analysis.report.more')}
        </button>
      </div>

      <div id={detailsId} hidden={!open} className="mt-3 border-t border-stroke pt-4">
        <dl className="flex flex-col gap-4 text-[14px] leading-6">
          <Field label={t('analysis.report.problem')}>{item.problem}</Field>
          <Field label={t('analysis.report.needs')}>
            <ul className="flex flex-col gap-2">
              {[...item.feasibility.blockers, ...item.feasibility.available].map((need) => (
                <NeedRow key={`${need.capability}-${need.label}`} need={need} />
              ))}
            </ul>
          </Field>
          {item.dataNeeded.length > 0 ? (
            <Field label={t('analysis.report.data')}>
              <List items={item.dataNeeded} />
            </Field>
          ) : null}
          {item.integrationsNeeded.length > 0 ? (
            <Field label={t('analysis.report.integrations')}>
              <List items={item.integrationsNeeded} />
            </Field>
          ) : null}
          <Field label={t('analysis.report.effortTitle')}>
            {t(`analysis.report.effort.${item.effort}` as TranslationKey)}
            {item.effortReason ? `. ${item.effortReason}` : ''}
          </Field>
          <Field label={t('analysis.report.impactTitle')}>
            <ImpactDetails item={item} />
          </Field>
          {item.risks.length > 0 ? (
            <Field label={t('analysis.report.risks')}>
              <List items={item.risks} />
            </Field>
          ) : null}
          {item.limitations.length > 0 ? (
            <Field label={t('analysis.report.limitations')}>
              <List items={item.limitations} />
            </Field>
          ) : null}
          {item.successCriteria.length > 0 ? (
            <Field label={t('analysis.report.success')}>
              <List items={item.successCriteria} />
            </Field>
          ) : null}
          {item.firstStep ? (
            <Field label={t('analysis.ready.firstStep')}>{item.firstStep}</Field>
          ) : null}
        </dl>
      </div>
    </li>
  );
}

/**
 * План внедрения возможности: открыть составленный, бесплатный краткий (один на бесплатный
 * анализ) или полный за кредиты с ценой до запуска. Нажатие на кнопку с ценой — согласие.
 */
function PlanAction({
  analysis,
  opportunity,
  plans,
  secondary = false,
}: {
  analysis: AnalysisView;
  opportunity: OpportunityView;
  plans: PlansSummary;
  /** Рядом есть «Приступить к автоматизации»: план — второстепенное действие. */
  secondary?: boolean;
}) {
  const translator = useTranslation();
  const { t } = translator;
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const existing = plans.items.find((plan) => plan.opportunityId === opportunity.id);
  const base = `/analyses/${analysis.id}`;

  if (existing) {
    return (
      <div className="mt-3">
        <Link
          to={`${base}/plans/${existing.id}`}
          className={buttonClasses({ variant: 'secondary', size: 'sm' })}
        >
          {existing.status === 'generating'
            ? t('analysis.plan.openGenerating')
            : t('analysis.plan.open')}
        </Link>
      </div>
    );
  }

  const { free, paid } = plans.offer;
  const start = (confirm: boolean) => {
    setBusy(true);
    setError(null);
    createPlan(analysis.id, opportunity.id, confirm)
      .then((plan) => navigate(`${base}/plans/${plan.id}`))
      .catch((caught: unknown) => {
        setError(caught);
        setBusy(false);
      });
  };

  return (
    <div className="mt-3 flex flex-col gap-2">
      {free.available ? (
        <>
          <Button
            size="sm"
            variant={secondary ? 'outline' : 'primary'}
            className={ACTION_WRAP}
            loading={busy}
            disabled={busy}
            onClick={() => start(false)}
          >
            {t('analysis.plan.makeFree')}
          </Button>
          <p className="text-[13px] text-subtle">{t('analysis.plan.freeNote')}</p>
        </>
      ) : paid.loginRequired ? (
        <Link
          to={`/login?redirect=${encodeURIComponent(base)}`}
          className={buttonClasses({ variant: 'outline', size: 'sm', className: ACTION_WRAP })}
        >
          {t('analysis.plan.loginToMake')}
        </Link>
      ) : (
        <>
          <Button
            variant="outline"
            size="sm"
            className={ACTION_WRAP}
            loading={busy}
            disabled={busy}
            onClick={() => start(true)}
          >
            {t('analysis.plan.makePaid')}
          </Button>
          <p className="text-[13px] text-subtle">
            {t('analysis.plan.paidNote', {
              price: priceText(translator, paid.typicalCredits, paid.maxCredits),
            })}
          </p>
        </>
      )}
      {error ? <ErrorNotice error={error} redirect={base} /> : null}
    </div>
  );
}

interface BuilderSummary {
  authenticated: boolean;
  solutions: SolutionView[];
  quote: { model: string; typicalCredits: number; maxCredits: number } | null;
}

/** Помощники пользователя и цена черновика: Builder — только после входа. */
function useBuilderSummary(): BuilderSummary {
  const status = useAuth((state) => state.status);
  const [data, setData] = useState<Omit<BuilderSummary, 'authenticated'>>({
    solutions: [],
    quote: null,
  });
  useEffect(() => {
    if (status !== 'authenticated') return;
    let alive = true;
    Promise.all([listSolutions(), fetchDraftQuote()]).then(
      ([solutions, quote]) => alive && setData({ solutions, quote }),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [status]);
  return { authenticated: status === 'authenticated', ...data };
}

/** «Создать помощника»: черновик пишет модель за кредиты, цена — у кнопки; гостю — вход. */
function SolutionAction({
  analysis,
  opportunity,
  builder,
  primary = false,
  start = false,
}: {
  analysis: AnalysisView;
  opportunity: OpportunityView;
  builder: BuilderSummary;
  /** Главная рекомендация: основная кнопка страницы. */
  primary?: boolean;
  /** Возможность с готовым рецептом: «Приступить к автоматизации». */
  start?: boolean;
}) {
  const translator = useTranslation();
  const { t } = translator;
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const existing = builder.solutions.find((item) => item.source?.opportunityId === opportunity.id);
  // Учебный помощник — готовый инструмент: создаётся сразу и бесплатно, черновик моделью не нужен.
  const tool = opportunity.recipe === 'study_assistant';

  if (!builder.authenticated) {
    return (
      <Link
        to={`/login?redirect=${encodeURIComponent(`/analyses/${analysis.id}`)}`}
        className={buttonClasses({
          variant: primary ? 'primary' : start ? 'outline' : 'ghost',
          size: 'sm',
          className: ACTION_WRAP,
        })}
      >
        {start ? t('builder.report.loginToStart') : t('builder.report.loginToCreate')}
      </Link>
    );
  }
  if (existing) {
    return (
      <Link
        to={`/solutions/${existing.id}`}
        className={buttonClasses({ variant: 'secondary', size: 'sm', className: ACTION_WRAP })}
      >
        {tool ? t('builder.report.openTool') : t('builder.report.open')}
      </Link>
    );
  }
  return (
    <div className="mt-3 flex flex-col gap-2">
      <Button
        variant={primary ? 'primary' : 'outline'}
        size="sm"
        className={ACTION_WRAP}
        loading={busy}
        disabled={busy || (!tool && !builder.quote)}
        onClick={() => {
          setBusy(true);
          setError(null);
          createFromOpportunity(analysis.id, opportunity.id)
            .then((solution) => navigate(`/solutions/${solution.id}`))
            .catch((caught: unknown) => {
              setError(caught);
              setBusy(false);
            });
        }}
      >
        {busy
          ? t(tool ? 'builder.report.creatingTool' : 'builder.report.creating')
          : tool
            ? t('builder.report.createTool')
            : start
              ? t('builder.report.start')
              : t('builder.report.create')}
      </Button>
      {tool ? <p className="text-[13px] text-subtle">{t('builder.report.toolNote')}</p> : null}
      {!tool && builder.quote ? (
        <p className="text-[13px] text-subtle">
          {t('builder.report.draftNote', {
            price: priceText(translator, builder.quote.typicalCredits, builder.quote.maxCredits),
          })}
        </p>
      ) : null}
      {error ? <ErrorNotice error={error} redirect={`/analyses/${analysis.id}`} /> : null}
    </div>
  );
}

/** Сайт из описания: прочитан или нет — человек должен знать, на чём основан отчёт. */
function SourceNote({ analysis }: { analysis: AnalysisView }) {
  const { t } = useTranslation();
  const source = analysis.source;
  if (!source) return null;
  const site = siteName(source.url);
  return (
    <p className="mt-1 text-[13px] text-subtle">
      {source.ok ? t('analysis.source.read', { site }) : t('analysis.source.failed', { site })}
    </p>
  );
}

function siteName(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

const COVERAGE_TONE: Record<AreaCoverage['status'], BadgeTone> = {
  found: 'success',
  not_relevant: 'neutral',
  unclear: 'warning',
};

/** Карта анализа: пять областей, которые анализ проверяет всегда, и что в каждой нашлось. */
function AnalysisMap({ coverage }: { coverage: AreaCoverage[] }) {
  const { t } = useTranslation();
  return (
    <section aria-labelledby="map-title" className="mt-8">
      <h3 id="map-title" className="text-[18px] font-medium text-text">
        {t('analysis.map.title')}
      </h3>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {coverage.map((item) => (
          <li
            key={item.area}
            className="flex flex-col gap-1 rounded-xl border border-stroke px-4 py-3"
          >
            <span className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[15px] font-medium text-text">
                {t(`analysis.map.area.${item.area}` as TranslationKey)}
              </span>
              <Badge tone={COVERAGE_TONE[item.status]}>
                {item.status === 'found'
                  ? t('analysis.map.found', { count: item.opportunities })
                  : t(`analysis.map.${item.status}` as TranslationKey)}
              </Badge>
            </span>
            {item.note ? <span className="text-[13px] text-subtle">{item.note}</span> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function NeedRow({ need }: { need: FeasibilityItem }) {
  const { t } = useTranslation();
  return (
    <li className="flex flex-col gap-0.5">
      <span className="flex flex-wrap items-center gap-2">
        <span className="text-text">{need.label}</span>
        <Badge tone={FEASIBILITY_TONE[need.status]}>
          {t(`analysis.feasibility.${need.status}` as TranslationKey)}
        </Badge>
      </span>
      {need.status !== 'ready' && need.hint ? (
        <span className="text-[13px] text-subtle">{need.hint}</span>
      ) : null}
    </li>
  );
}

function ImpactDetails({ item }: { item: OpportunityView }) {
  const { t } = useTranslation();
  const impact = item.impact;
  if (impact.kind === 'qualitative') {
    return (
      <div className="flex flex-col gap-1">
        <p className="text-text">{impact.benefit}</p>
        <p className="text-subtle">{impact.missing}</p>
        <p className="text-subtle">{impact.note}</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="text-text">
        {t('analysis.ready.hours', { from: impact.hoursPerWeek[0], to: impact.hoursPerWeek[1] })}.{' '}
        {impact.benefit}
      </p>
      <p>
        <span className="text-subtle">{t('analysis.report.formula')}: </span>
        <span className="text-text">{impact.formula}</span>
      </p>
      <div>
        <p className="text-subtle">{t('analysis.report.inputs')}:</p>
        <ul className="list-disc pl-5 text-text">
          {impact.inputs.map((input) => (
            <li key={input.label}>
              {input.label}: {input.value}{' '}
              <span className="text-subtle">({t('analysis.report.fromYou')})</span>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <p className="text-subtle">{t('analysis.report.assumptions')}:</p>
        <List items={impact.assumptions} />
      </div>
      <p className="text-subtle">{impact.note}</p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-[13px] font-medium text-subtle">{label}</dt>
      <dd className="mt-1 text-text">{children}</dd>
    </div>
  );
}

function List({ items, className }: { items: string[]; className?: string }) {
  return (
    <ul className={cn('list-disc pl-5 text-text', className)}>
      {items.map((value) => (
        <li key={value}>{value}</li>
      ))}
    </ul>
  );
}
