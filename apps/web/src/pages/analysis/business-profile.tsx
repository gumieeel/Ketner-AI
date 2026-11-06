import type { ReactNode } from 'react';
import type { AnalysisView, FeasibilityStatus } from '@/features/discovery/api';
import { useTranslation, type TranslationKey } from '@/i18n';

/** Сколько проблем показать в обзоре: остальные — в карточках возможностей ниже. */
const PROBLEMS_SHOWN = 5;

const FEASIBILITY_ORDER: FeasibilityStatus[] = [
  'ready',
  'needs_setup',
  'needs_integration',
  'not_supported',
];

/**
 * Начало результата: профиль бизнеса (что Ketner понял), найденные проблемы и объём внедрения —
 * интеграции, сложность и сколько можно запустить сразу. Всё собрано из разбора описания и
 * возможностей, посчитанных сервером; ничего нового здесь не придумывается.
 */
export function BusinessProfile({ analysis }: { analysis: AnalysisView }) {
  const { t } = useTranslation();
  const context = analysis.context;
  const opportunities = analysis.opportunities;

  const processes = context?.recurringProcesses?.filter((item) => item.steps.length > 0) ?? [];
  const tools = unique((context?.tools ?? []).map((item) => item.text));
  const goals = (context?.goals ?? []).map((item) => item.text);
  const problems = unique(opportunities.map((item) => item.problem)).slice(0, PROBLEMS_SHOWN);

  const doable = opportunities.filter((item) => item.feasibilityStatus !== 'not_supported');
  const integrations = unique(doable.flatMap((item) => item.integrationsNeeded));
  const byStatus = FEASIBILITY_ORDER.map((status) => ({
    status,
    count: opportunities.filter((item) => item.feasibilityStatus === status).length,
  })).filter((item) => item.count > 0);
  const byEffort = (['low', 'medium', 'high'] as const)
    .map((effort) => ({ effort, count: doable.filter((item) => item.effort === effort).length }))
    .filter((item) => item.count > 0);

  if (!context && opportunities.length === 0) return null;

  return (
    <div className="mt-8 grid gap-4 md:grid-cols-2">
      <Card titleId="profile-title" title={t('analysis.profile.title')}>
        {context?.domain ? (
          <p className="text-[15px] font-medium text-text">{context.domain}</p>
        ) : null}
        {context?.summary ? (
          <p className="mt-1 text-[14px] leading-6 text-muted">{context.summary}</p>
        ) : null}
        {processes.length > 0 ? (
          <Block label={t('analysis.profile.processes')}>
            <ul className="flex flex-col gap-1.5">
              {processes.map((process) => (
                <li key={process.title} className="text-[14px] leading-6 text-text">
                  <span className="text-muted">{process.title}: </span>
                  {process.steps.join(' → ')}
                </li>
              ))}
            </ul>
          </Block>
        ) : null}
        {tools.length > 0 ? (
          <Block label={t('analysis.profile.tools')}>
            <Chips items={tools} />
          </Block>
        ) : null}
        {goals.length > 0 ? (
          <Block label={t('analysis.profile.goals')}>
            <Bullets items={goals} />
          </Block>
        ) : null}
      </Card>

      <div className="flex flex-col gap-4">
        {problems.length > 0 ? (
          <Card titleId="problems-title" title={t('analysis.profile.problems')}>
            <Bullets items={problems} />
          </Card>
        ) : null}

        {opportunities.length > 0 ? (
          <Card titleId="scope-title" title={t('analysis.scope.title')}>
            <dl className="flex flex-col gap-3 text-[14px] leading-6">
              <div>
                <dt className="text-subtle">{t('analysis.scope.feasibility')}</dt>
                <dd className="text-text">
                  {byStatus
                    .map(
                      ({ status, count }) =>
                        `${t(`analysis.feasibility.${status}` as TranslationKey)}: ${count}`,
                    )
                    .join(' · ')}
                </dd>
              </div>
              {byEffort.length > 0 ? (
                <div>
                  <dt className="text-subtle">{t('analysis.scope.complexity')}</dt>
                  <dd className="text-text">
                    {byEffort
                      .map(
                        ({ effort, count }) =>
                          `${t(`analysis.scope.effort.${effort}` as TranslationKey)}: ${count}`,
                      )
                      .join(' · ')}
                  </dd>
                </div>
              ) : null}
              <div>
                <dt className="text-subtle">{t('analysis.scope.integrations')}</dt>
                <dd className="mt-1">
                  {integrations.length > 0 ? (
                    <Chips items={integrations} />
                  ) : (
                    <span className="text-text">{t('analysis.scope.noIntegrations')}</span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-subtle">{t('analysis.scope.estimate')}</dt>
                <dd className="text-text">{t(scopeKey(analysis))}</dd>
              </div>
            </dl>
          </Card>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Оценка объёма внедрения по сложности и интеграциям выполнимых возможностей: грубая, но честная —
 * сроков в днях не обещает.
 */
function scopeKey(analysis: AnalysisView): TranslationKey {
  const doable = analysis.opportunities.filter(
    (item) => item.feasibilityStatus !== 'not_supported',
  );
  if (doable.length === 0) return 'analysis.scope.estimateNone';
  const quick = doable.filter(
    (item) => item.effort === 'low' && item.integrationsNeeded.length === 0,
  ).length;
  const heavy = doable.filter(
    (item) => item.effort === 'high' || item.feasibilityStatus === 'needs_integration',
  ).length;
  if (heavy === 0) return 'analysis.scope.estimateSmall';
  if (quick > 0) return 'analysis.scope.estimateStaged';
  return 'analysis.scope.estimateLarge';
}

function unique(items: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    const key = item.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item.trim());
  }
  return result;
}

function Card({
  titleId,
  title,
  children,
}: {
  titleId: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={titleId} className="rounded-xl border border-stroke px-5 py-4">
      <h3 id={titleId} className="mb-3 text-[13px] font-medium tracking-wide text-subtle uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Block({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mt-4">
      <p className="mb-1.5 text-[13px] text-subtle">{label}</p>
      {children}
    </div>
  );
}

function Chips({ items }: { items: string[] }) {
  return (
    <ul className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <li
          key={item}
          className="rounded-full border border-stroke px-3 py-0.5 text-[13px] leading-6 text-text"
        >
          {item}
        </li>
      ))}
    </ul>
  );
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="flex flex-col gap-1.5 text-[14px] leading-6 text-text">
      {items.map((item) => (
        <li key={item} className="flex gap-2">
          <span aria-hidden="true" className="text-subtle">
            —
          </span>
          {item}
        </li>
      ))}
    </ul>
  );
}
