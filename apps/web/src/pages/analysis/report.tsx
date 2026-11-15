import { useEffect, useId, useState, type ReactNode } from 'react';
import {
  ArrowRightIcon,
  BoltIcon,
  BookmarkIcon,
  ChartIcon,
  ChevronDownIcon,
  ClockIcon,
  EditIcon,
  FileTextIcon,
  InfoIcon,
  MapIcon,
  MessagesIcon,
  RocketIcon,
  SparkleIcon,
} from '@/components/icons';
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
import { priceText } from '@/features/discovery/format';
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
import {
  CombinedEstimate,
  Disclaimer,
  EstimateDetails,
  EstimateSummary,
  RequestQuoteButton,
} from './estimate';
import { ProfileEditor } from './profile-editor';
import type { EstimatesBlock, EstimateView } from '@/features/pricing/api';
import { ErrorNotice } from './error-notice';
import { productSwitch } from '@/lib/product-switches';

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
  estimates = null,
  onChanged,
  children,
}: {
  analysis: AnalysisView;
  plans: PlansSummary | null;
  /** Предварительные сметы внедрения: посчитаны сервером. */
  estimates?: EstimatesBlock | null;
  onChanged: () => Promise<void>;
  /** Под отчётом в основной колонке: описание задачи, ответы. */
  children?: ReactNode;
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
  /**
   * Действия возможности. У рекомендуемой главное действие — на виду (готовая автоматизация или
   * план), остальное — в «Подробнее»; у остальных возможностей все действия — в «Подробнее».
   */
  const actionsFor = (
    item: OpportunityView,
    featured: boolean,
  ): { row: ReactNode; details: ReactNode } => {
    if (item.feasibilityStatus === 'not_supported') return { row: null, details: null };
    const solution =
      item.recipe === 'personal_assistant' ||
      item.recipe === 'customer_bot' ||
      item.recipe === 'study_assistant' ? (
        <SolutionAction
          analysis={analysis}
          opportunity={item}
          builder={builder}
          primary={featured}
          start
        />
      ) : null;
    const plan = plans ? (
      <PlanAction
        analysis={analysis}
        opportunity={item}
        plans={plans}
        secondary={featured ? solution !== null : true}
      />
    ) : null;
    // Анализ до этапа A (без карты областей): помощник создаётся из любой возможности.
    const legacy = !planned ? (
      <SolutionAction analysis={analysis} opportunity={item} builder={builder} />
    ) : null;
    const group = (...nodes: ReactNode[]) =>
      nodes.some(Boolean) ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start">{nodes}</div>
      ) : null;
    if (featured) {
      return {
        row: solution ?? plan,
        details: group(solution ? plan : null, legacy),
      };
    }
    return { row: null, details: group(solution, plan, legacy) };
  };
  const situation = analysis.context?.summary ?? analysis.inputText;

  const [showAll, setShowAll] = useState(false);
  const listed = main ? [main, ...opportunities] : opportunities;
  const visible = showAll ? listed : listed.slice(0, VISIBLE_OPPORTUNITIES);
  // Рекомендуем начать: главная рекомендация, а у анализа без неё — первая выполнимая.
  const featuredId =
    main?.id ?? listed.find((item) => item.feasibilityStatus !== 'not_supported')?.id ?? null;
  const hidden = listed.length - visible.length;
  const estimateFor = (id: string): EstimateView | null =>
    estimates?.items.find((item) => item.scopeKey === `opp:${id}`) ?? null;
  const combined = estimates?.items.find((item) => item.scope === 'combined') ?? null;

  return (
    <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_21rem] lg:items-start">
      <div className="flex min-w-0 flex-col gap-8">
        <SummaryCard analysis={analysis} />

        <section aria-labelledby="result-title">
          <h2
            id="result-title"
            className="flex items-center gap-2.5 text-[20px] font-medium tracking-[-0.01em] text-text"
          >
            <SparkleIcon aria-hidden="true" className="size-5 text-accent" />
            {t('analysis.ready.title')}
          </h2>
          {listed.length === 0 ? (
            <p className="mt-3 text-[15px] leading-6 text-muted">{t('analysis.ready.empty')}</p>
          ) : (
            <ul className="mt-4 flex flex-col gap-3">
              {visible.map((item) => {
                const featured = item.id === featuredId;
                const actions = actionsFor(item, featured);
                return (
                  <OpportunityCard
                    key={item.id}
                    item={item}
                    featured={featured}
                    situation={situation}
                    action={actions.row}
                    moreActions={actions.details}
                    estimate={estimateFor(item.id)}
                    analysisId={analysis.id}
                  />
                );
              })}
            </ul>
          )}
          {hidden > 0 || showAll ? (
            <button
              type="button"
              aria-expanded={showAll}
              onClick={() => setShowAll((value) => !value)}
              className="mt-3 inline-flex min-h-11 items-center gap-1.5 text-[14px] text-muted hover:text-text md:min-h-0"
            >
              <ChevronDownIcon
                aria-hidden="true"
                className={cn('size-4 transition-transform', showAll && 'rotate-180')}
              />
              {showAll
                ? t('analysis.result.showLess')
                : t('analysis.result.showMore', { count: hidden })}
            </button>
          ) : null}
          {listed.length > 0 ? (
            <div className="mt-4 flex items-start gap-3 rounded-2xl border border-stroke bg-surface px-5 py-4">
              <InfoIcon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-accent" />
              <p className="text-[14px] leading-6 text-text">{t('analysis.result.choose')}</p>
            </div>
          ) : null}
          <p className="mt-3 text-[13px] leading-5 text-subtle">
            {t('analysis.report.statusNote')}
          </p>
        </section>

        {combined ? <CombinedEstimate estimate={combined} analysisId={analysis.id} /> : null}
        {estimates && estimates.items.length > 0 && !combined ? <Disclaimer /> : null}
        {analysis.context ? <ProfileEditor analysis={analysis} onChanged={onChanged} /> : null}

        <SourceNote analysis={analysis} />
        <BusinessProfile analysis={analysis} />
        {analysis.coverage ? <AnalysisMap coverage={analysis.coverage} /> : null}
        {children}
      </div>

      <aside
        aria-label={t('analysis.result.asideLabel')}
        className="flex flex-col gap-4 lg:sticky lg:top-24"
      >
        <PlanCard analysis={analysis} plans={plans} steps={startWith} />
        <SideCard
          icon={<BookmarkIcon className="size-5" />}
          titleId="save-title"
          title={t('analysis.result.saveTitle')}
          text={t('analysis.result.saveText')}
        >
          <SaveControl analysis={analysis} onChanged={onChanged} block />
        </SideCard>
        <SideCard
          icon={<RocketIcon className="size-5" />}
          titleId="next-title"
          title={t('analysis.result.nextTitle')}
          text={t('analysis.result.nextText')}
        >
          {builder.authenticated ? (
            <Link
              to="/solutions"
              className={buttonClasses({ variant: 'primary', size: 'md', fullWidth: true })}
            >
              {t('analysis.result.toSolutions')}
              <ArrowRightIcon aria-hidden="true" className="size-4" />
            </Link>
          ) : (
            <Link
              to={`/login?redirect=${encodeURIComponent(`/analyses/${analysis.id}`)}`}
              className={buttonClasses({ variant: 'primary', size: 'md', fullWidth: true })}
            >
              {t('analysis.result.loginToSolutions')}
            </Link>
          )}
        </SideCard>
      </aside>
    </div>
  );
}

/** Сколько возможностей видно сразу (с главной рекомендацией); остальные — по кнопке. */
const VISIBLE_OPPORTUNITIES = 3;

/**
 * «Краткое резюме»: вывод анализа и справа — экономия времени, только если её посчитал сервер
 * по числам самого человека; иначе — сколько возможностей можно запустить сразу.
 */
function SummaryCard({ analysis }: { analysis: AnalysisView }) {
  const { t } = useTranslation();
  const doable = analysis.opportunities.filter(
    (item) => item.feasibilityStatus !== 'not_supported',
  );
  const hours = doable.reduce<[number, number] | null>((sum, item) => {
    if (item.impact.kind !== 'estimate') return sum;
    const [from, to] = item.impact.hoursPerWeek;
    return sum ? [sum[0] + from, sum[1] + to] : [from, to];
  }, null);
  const readyNow = analysis.opportunities.filter(
    (item) => item.feasibilityStatus === 'ready',
  ).length;
  const round = (value: number) => Math.round(value * 10) / 10;

  return (
    <section
      aria-labelledby="summary-title"
      className="grid gap-5 rounded-2xl border border-stroke bg-surface px-5 py-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-0"
    >
      <div className="flex gap-4 sm:pr-6">
        <SparkleIcon aria-hidden="true" className="mt-0.5 size-6 shrink-0 text-accent" />
        <div className="min-w-0">
          <h2 id="summary-title" className="text-[18px] font-medium text-text">
            {t('analysis.result.summaryTitle')}
          </h2>
          <p className="mt-2 text-[15px] leading-6 text-muted">
            {analysis.summary ?? analysis.context?.summary ?? ''}
          </p>
        </div>
      </div>
      <div className="flex gap-3 border-stroke max-sm:border-t max-sm:pt-4 sm:min-w-[13rem] sm:border-l sm:pl-6">
        <ClockIcon aria-hidden="true" className="mt-0.5 size-6 shrink-0 text-muted" />
        {hours ? (
          <div>
            <p className="text-[13px] leading-5 text-subtle">{t('analysis.result.savingTitle')}</p>
            <p className="mt-1 text-[24px] font-medium tracking-[-0.01em] text-text">
              {t('analysis.ready.hours', { from: round(hours[0]), to: round(hours[1]) })}
            </p>
            <p className="text-[13px] leading-5 text-subtle">{t('analysis.result.savingNote')}</p>
          </div>
        ) : (
          <div>
            <p className="text-[13px] leading-5 text-subtle">{t('analysis.result.readyTitle')}</p>
            <p className="mt-1 text-[24px] font-medium tracking-[-0.01em] text-text">
              {t('analysis.result.readyCount', {
                ready: readyNow,
                total: analysis.opportunities.length,
              })}
            </p>
            <p className="text-[13px] leading-5 text-subtle">{t('analysis.result.readyNote')}</p>
          </div>
        )}
      </div>
    </section>
  );
}

/** «Ваш план внедрения»: первые шаги лучших возможностей и составленный план, если он есть. */
function PlanCard({
  analysis,
  plans,
  steps,
}: {
  analysis: AnalysisView;
  plans: PlansSummary | null;
  steps: OpportunityView[];
}) {
  const { t } = useTranslation();
  const existing = plans?.items[0] ?? null;
  if (steps.length === 0 && !existing) return null;
  return (
    <SideCard
      icon={<MapIcon className="size-5" />}
      titleId="start-title"
      title={t('analysis.report.startTitle')}
    >
      <ol className="flex flex-col">
        {steps.map((item, index) => (
          <li key={item.id} className="relative flex gap-3 pb-4 last:pb-0">
            {index < steps.length - 1 ? (
              <span
                aria-hidden="true"
                className="absolute top-7 bottom-0 left-[0.8125rem] w-px bg-accent/40"
              />
            ) : null}
            <span
              aria-hidden="true"
              className="flex size-[1.625rem] shrink-0 items-center justify-center rounded-full bg-accent-soft text-[13px] font-medium text-accent"
            >
              {index + 1}
            </span>
            <span className="min-w-0 pt-0.5">
              <span className="block text-[14px] leading-5 font-medium text-text">
                {item.firstStep}
              </span>
              <span className="mt-0.5 block text-[13px] leading-5 text-subtle">{item.title}</span>
            </span>
          </li>
        ))}
      </ol>
      {existing ? (
        <Link
          to={`/analyses/${analysis.id}/plans/${existing.id}`}
          className={buttonClasses({
            variant: 'outline',
            size: 'md',
            fullWidth: true,
            className: 'mt-4',
          })}
        >
          {t('analysis.plan.open')}
          <ArrowRightIcon aria-hidden="true" className="size-4" />
        </Link>
      ) : null}
    </SideCard>
  );
}

function SideCard({
  icon,
  titleId,
  title,
  text,
  children,
}: {
  icon: ReactNode;
  titleId: string;
  title: string;
  text?: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={titleId} className="rounded-2xl border border-stroke bg-surface p-5">
      <div className="flex gap-3">
        <span aria-hidden="true" className="mt-0.5 text-accent">
          {icon}
        </span>
        <div className="min-w-0">
          <h3 id={titleId} className="text-[16px] font-medium text-text">
            {title}
          </h3>
          {text ? <p className="mt-1 text-[14px] leading-5 text-muted">{text}</p> : null}
        </div>
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

const AREA_ICON: Record<NonNullable<OpportunityView['area']>, typeof SparkleIcon> = {
  clients: MessagesIcon,
  sales: ChartIcon,
  content: EditIcon,
  documents: FileTextIcon,
  routine: BoltIcon,
};

function SaveControl({
  analysis,
  onChanged,
  block = false,
}: {
  analysis: AnalysisView;
  onChanged: () => Promise<void>;
  /** Во всю ширину карточки справа. */
  block?: boolean;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const href = `/login?redirect=${encodeURIComponent(`/analyses/${analysis.id}`)}`;

  if (analysis.guest) {
    return (
      <Link
        to={href}
        className={buttonClasses({
          variant: 'outline',
          size: block ? 'md' : 'sm',
          fullWidth: block,
        })}
      >
        {t('analysis.report.loginToSave')}
      </Link>
    );
  }
  return (
    <div className={cn('flex flex-col gap-2', block ? 'items-stretch' : 'items-end')}>
      <Button
        variant={analysis.saved ? 'secondary' : 'outline'}
        size={block ? 'md' : 'sm'}
        fullWidth={block}
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
  moreActions,
  situation,
  featured = false,
  estimate = null,
  analysisId,
}: {
  item: OpportunityView;
  /** Предварительная смета этой возможности (null — нет). */
  estimate?: EstimateView | null;
  analysisId: string;
  /** Главное действие на виду (у рекомендуемой возможности). */
  action: ReactNode;
  /** Остальные действия — в «Подробнее». */
  moreActions: ReactNode;
  situation: string;
  featured?: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  const headingId = useId();

  return (
    <li
      aria-labelledby={headingId}
      className={cn(
        'relative rounded-2xl border bg-surface px-5 py-5',
        featured ? 'border-accent/60 shadow-sm' : 'border-stroke',
      )}
    >
      {featured ? (
        <span className="absolute -top-3 left-4 rounded-md bg-accent px-2 py-0.5 text-[12px] font-medium text-canvas">
          {t('analysis.result.recommended')}
        </span>
      ) : null}
      <div className="flex flex-col gap-4 md:flex-row md:items-start">
        <div className="flex min-w-0 flex-1 gap-4">
          <span
            aria-hidden="true"
            className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent max-sm:size-11"
          >
            <AreaIconView area={item.area} />
          </span>
          <div className="min-w-0">
            {item.area || item.recipe ? (
              <p className="mb-0.5 text-[13px] text-subtle">
                {item.area ? t(`analysis.map.area.${item.area}` as TranslationKey) : null}
                {item.area && item.recipe ? ' · ' : null}
                {item.recipe ? t(`analysis.recipe.${item.recipe}` as TranslationKey) : null}
              </p>
            ) : null}
            <h4
              id={headingId}
              className={cn(
                'leading-6 font-medium text-text',
                featured ? 'text-[18px]' : 'text-[16px]',
              )}
            >
              {item.title}
            </h4>
            <p className="mt-1 text-[14px] leading-6 text-muted">{item.solution}</p>
            <ul className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px] text-muted">
              <li className="inline-flex items-center gap-1.5">
                <ChartIcon aria-hidden="true" className="size-4 text-accent" />
                {t(`analysis.report.effort.${item.effort}` as TranslationKey)}
              </li>
              {item.impact.kind === 'estimate' ? (
                <li className="inline-flex items-center gap-1.5">
                  <ClockIcon aria-hidden="true" className="size-4" />
                  {t('analysis.ready.hours', {
                    from: item.impact.hoursPerWeek[0],
                    to: item.impact.hoursPerWeek[1],
                  })}
                </li>
              ) : null}
              {item.solutionType ? (
                <li>
                  <Badge tone="neutral">
                    {t(`estimate.solutionType.${item.solutionType}` as TranslationKey)}
                  </Badge>
                </li>
              ) : null}
              <li>
                <Badge tone={FEASIBILITY_TONE[item.feasibilityStatus]}>
                  {t(`analysis.feasibility.${item.feasibilityStatus}` as TranslationKey)}
                </Badge>
              </li>
            </ul>
            {item.feasibilityStatus === 'not_supported' ? (
              <p className="mt-2 text-[14px] leading-6 text-muted">
                {t('analysis.report.notSupported', {
                  what: item.feasibility.blockers.map((blocker) => blocker.label).join(', '),
                })}
              </p>
            ) : null}
            {estimate ? (
              <>
                <EstimateSummary estimate={estimate} />
                <div className="mt-3 flex flex-wrap gap-3">
                  <RequestQuoteButton analysisId={analysisId} estimate={estimate} secondary />
                </div>
                <EstimateDetails estimate={estimate} />
              </>
            ) : null}
          </div>
        </div>

        <div
          className={cn(
            'flex shrink-0 flex-col gap-1 [&>div]:mt-0',
            action ? 'md:w-60 md:items-stretch' : 'md:items-end',
          )}
        >
          {action}
          <button
            type="button"
            aria-expanded={open}
            aria-controls={detailsId}
            onClick={() => setOpen((value) => !value)}
            className={
              action
                ? 'inline-flex min-h-11 items-center gap-1 self-start text-[14px] font-medium text-accent hover:underline md:min-h-9 md:self-center'
                : buttonClasses({ variant: 'outline', size: 'sm', className: 'self-start gap-1' })
            }
          >
            {open ? t('analysis.report.less') : t('analysis.report.more')}
            <ChevronDownIcon
              aria-hidden="true"
              className={cn('size-4 transition-transform', open && 'rotate-180')}
            />
          </button>
        </div>
      </div>

      <div id={detailsId} hidden={!open} className="mt-4 border-t border-stroke pt-4">
        {moreActions ? <div className="mb-5">{moreActions}</div> : null}
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
        {/* Чат закрыт (lib/product-switches.ts): кнопки «обсудить в чате» нет. */}
        {productSwitch('chat') ? (
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
            className="mt-4 inline-flex min-h-11 items-center text-[14px] text-muted underline underline-offset-4 hover:text-text md:min-h-0"
          >
            {t('analysis.chat.discuss')}
          </Link>
        ) : null}
      </div>
    </li>
  );
}

function AreaIconView({ area }: { area: OpportunityView['area'] }) {
  const Icon = area ? AREA_ICON[area] : SparkleIcon;
  return <Icon className="size-6" />;
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
