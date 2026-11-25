import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { buttonClasses } from '@/components/ui/button-classes';
import { Spinner } from '@/components/ui/spinner';
import { createFromOpportunity, listSolutions, type SolutionView } from '@/features/builder/api';
import { wizardSetupPath } from '@/features/builder/wizard';
import { fetchAnalysis, type AnalysisView, type OpportunityView } from '@/features/discovery/api';
import { useTranslation, type TranslationKey } from '@/i18n';
import { ErrorNotice } from '@/pages/analysis/error-notice';
import { BuilderGate } from '../shared';
import { TemplateGallery } from '../template-gallery';
import { WizardFrame } from './wizard-frame';

/**
 * Шаг 1 мастера — «Анализ» (docs/BUILDER_V1.md, раздел 3): возможность из анализа или галерея.
 * Черновик создаётся тем же `POST /solutions/from-opportunity`, что и кнопка отчёта; дальше —
 * шаг 2 для бота, страница решения для остальных типов (их шаги — в следующих PR).
 */
export function WizardStartPage() {
  return (
    <BuilderGate>
      <WizardStart />
    </BuilderGate>
  );
}

type Load =
  | { kind: 'loading' }
  | { kind: 'error'; error: unknown }
  | { kind: 'missing' }
  | {
      kind: 'ready';
      analysis: AnalysisView;
      opportunity: OpportunityView;
      existing: SolutionView | undefined;
    };

function WizardStart() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const analysisId = params.get('analysis');
  const opportunityId = params.get('opportunity');

  if (!analysisId || !opportunityId) {
    return (
      <WizardFrame
        title={t('wizard.title.default')}
        current="analysis"
        back={{ to: '/solutions', label: t('builder.back') }}
      >
        <section className="mt-8 max-w-[44rem]">
          <h2 className="text-[20px] font-medium tracking-[-0.01em] text-text">
            {t('wizard.gallery.title')}
          </h2>
          <p className="mt-2 text-[14px] leading-6 text-muted">{t('wizard.gallery.lead')}</p>
          <Link
            to="/"
            className={buttonClasses({ variant: 'primary', size: 'md', className: 'mt-4' })}
          >
            {t('wizard.gallery.analysis')}
          </Link>
          <TemplateGallery />
        </section>
      </WizardFrame>
    );
  }
  return (
    <FromOpportunity
      key={`${analysisId}:${opportunityId}`}
      analysisId={analysisId}
      opportunityId={opportunityId}
    />
  );
}

function FromOpportunity({
  analysisId,
  opportunityId,
}: {
  analysisId: string;
  opportunityId: string;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([fetchAnalysis(analysisId), listSolutions()]).then(
      ([{ analysis }, solutions]) => {
        if (!alive) return;
        const opportunity = analysis.opportunities.find((item) => item.id === opportunityId);
        if (!opportunity) {
          setLoad({ kind: 'missing' });
          return;
        }
        setLoad({
          kind: 'ready',
          analysis,
          opportunity,
          existing: solutions.find((item) => item.source?.opportunityId === opportunityId),
        });
      },
      (caught: unknown) => alive && setLoad({ kind: 'error', error: caught }),
    );
    return () => {
      alive = false;
    };
  }, [analysisId, opportunityId]);

  const frame = (children: ReactNode, title = t('wizard.title.default')) => (
    <WizardFrame
      title={title}
      current="analysis"
      back={{ to: `/analyses/${analysisId}`, label: t('wizard.backToAnalysis') }}
    >
      {children}
    </WizardFrame>
  );

  if (load.kind === 'loading') {
    return frame(
      <p className="mt-8 flex items-center gap-2 text-[14px] text-muted">
        <Spinner /> {t('analysis.page.loading')}
      </p>,
    );
  }
  if (load.kind === 'error') {
    return frame(
      <div className="mt-8">
        <ErrorNotice error={load.error} redirect={`/analyses/${analysisId}`} />
      </div>,
    );
  }
  if (load.kind === 'missing') {
    return frame(<p className="t-lead mt-8">{t('wizard.start.notFound')}</p>);
  }

  const { opportunity, existing } = load;
  const bot = opportunity.recipe === 'customer_bot';
  const nextPath = (id: string) => (bot ? wizardSetupPath(id) : `/solutions/${id}`);
  const create = () => {
    setBusy(true);
    setError(null);
    createFromOpportunity(analysisId, opportunityId)
      .then((solution) => navigate(nextPath(solution.id)))
      .catch((caught: unknown) => {
        setError(caught);
        setBusy(false);
      });
  };

  return frame(
    <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
      <article className="rounded-2xl border border-stroke bg-surface p-5 sm:p-6">
        <p className="text-[13px] text-subtle">{t('wizard.start.fromAnalysis')}</p>
        <h2 className="mt-1 text-[20px] font-medium tracking-[-0.01em] text-text">
          {opportunity.title}
        </h2>
        <dl className="mt-4 flex flex-col gap-4 text-[15px] leading-6">
          <div>
            <dt className="text-[13px] font-medium text-subtle">{t('wizard.start.type')}</dt>
            <dd className="mt-1 text-text">
              {bot ? t('wizard.start.type.customer_bot') : t('wizard.start.type.other')}
            </dd>
          </div>
          <div>
            <dt className="text-[13px] font-medium text-subtle">{t('wizard.start.problem')}</dt>
            <dd className="mt-1 text-text">{opportunity.problem}</dd>
          </div>
          <div>
            <dt className="text-[13px] font-medium text-subtle">{t('wizard.start.solution')}</dt>
            <dd className="mt-1 text-text">{opportunity.solution}</dd>
          </div>
          {opportunity.feasibility.available.length > 0 ? (
            <div>
              <dt className="text-[13px] font-medium text-subtle">{t('wizard.start.ketner')}</dt>
              <dd className="mt-1">
                <ul className="flex flex-col gap-1">
                  {opportunity.feasibility.available.map((item) => (
                    <li key={item.label} className="flex flex-wrap items-center gap-2 text-text">
                      <span aria-hidden="true" className="text-success">
                        ✓
                      </span>
                      {item.label}
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
          ) : null}
          {opportunity.feasibility.blockers.length > 0 ? (
            <div>
              <dt className="text-[13px] font-medium text-subtle">{t('wizard.start.missing')}</dt>
              <dd className="mt-1">
                <ul className="flex flex-col gap-2">
                  {opportunity.feasibility.blockers.map((item) => (
                    <li key={item.label} className="flex flex-col gap-0.5">
                      <span className="flex flex-wrap items-center gap-2 text-text">
                        {item.label}
                        <Badge tone="warning">
                          {t(`analysis.feasibility.${item.status}` as TranslationKey)}
                        </Badge>
                      </span>
                      {item.hint ? (
                        <span className="text-[13px] text-subtle">{item.hint}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
          ) : null}
        </dl>
      </article>

      <aside className="flex flex-col gap-3 self-start rounded-2xl border border-stroke bg-surface p-5">
        {existing ? (
          <>
            <p className="text-[14px] leading-6 text-muted">{t('wizard.start.exists')}</p>
            <Link
              to={nextPath(existing.id)}
              className={buttonClasses({ variant: 'primary', size: 'md' })}
            >
              {t('wizard.start.continue')}
            </Link>
          </>
        ) : (
          <>
            <Button loading={busy} disabled={busy} onClick={create}>
              {busy ? t('wizard.start.creating') : t('wizard.start.create')}
            </Button>
            <p className="text-[13px] leading-5 text-subtle">
              {opportunity.recipe === 'study_assistant'
                ? t('builder.report.toolNote')
                : t('builder.report.draftNote', { price: t('allowance.included') })}
            </p>
          </>
        )}
        {error ? <ErrorNotice error={error} redirect={`/analyses/${analysisId}`} /> : null}
      </aside>
    </div>,
    bot ? t('wizard.title.customer_bot') : t('wizard.title.default'),
  );
}
