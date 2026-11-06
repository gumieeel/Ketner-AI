import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { listRuns, isActiveRun, type RunStatus, type RunSummary } from '@/features/study/api';
import { POLL_MS } from '@/features/discovery/use-analysis';
import { OPERATION_LABEL } from '@/features/study/labels';
import { useTranslation, type TranslationKey } from '@/i18n';
import { formatDateTime } from '@/lib/format-date';
import { ErrorNotice } from '@/pages/analysis/error-notice';

const STATUS: Record<RunStatus, { label: TranslationKey; tone: BadgeTone }> = {
  queued: { label: 'study.run.status.queued', tone: 'neutral' },
  running: { label: 'study.run.status.running', tone: 'neutral' },
  done: { label: 'study.run.status.done', tone: 'success' },
  failed: { label: 'study.run.status.failed', tone: 'warning' },
};

/** История запусков инструмента: каждый результат можно открыть снова. */
export function RunsPanel({ solutionId }: { solutionId: string }) {
  const { t, language } = useTranslation();
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const active = runs?.some(isActiveRun) ?? false;

  useEffect(() => {
    let alive = true;
    const load = () =>
      listRuns(solutionId).then(
        (next) => alive && setRuns(next),
        (caught: unknown) => alive && setError(caught),
      );
    void load();
    const timer = active ? window.setInterval(() => void load(), POLL_MS) : null;
    return () => {
      alive = false;
      if (timer) window.clearInterval(timer);
    };
  }, [solutionId, active]);

  return (
    <section aria-labelledby="runs-title" className="mt-10 border-t border-stroke pt-8">
      <h2 id="runs-title" className="text-[20px] font-medium tracking-[-0.01em] text-text">
        {t('study.runs.title')}
      </h2>
      {error ? (
        <div className="mt-4">
          <ErrorNotice error={error} redirect={`/solutions/${solutionId}`} />
        </div>
      ) : null}
      {runs && runs.length === 0 ? (
        <p className="mt-3 text-[14px] text-muted">{t('study.runs.empty')}</p>
      ) : null}
      {runs && runs.length > 0 ? (
        <ul aria-label={t('study.runs.title')} className="mt-4 flex flex-col gap-2">
          {runs.map((run) => (
            <li key={run.id}>
              <Link
                to={`/solutions/${solutionId}/runs/${run.id}`}
                className="flex flex-col gap-1 rounded-xl border border-stroke p-4 hover:bg-surface-2 sm:flex-row sm:items-center sm:justify-between"
              >
                <span className="min-w-0">
                  <span className="block truncate text-[15px] font-medium text-text">
                    {run.title ?? run.subject}
                  </span>
                  <span className="block text-[13px] text-subtle">
                    {t(OPERATION_LABEL[run.operation])}
                    {' · '}
                    {run.subject}
                    {' · '}
                    {formatDateTime(run.createdAt, language)}
                  </span>
                </span>
                <Badge tone={STATUS[run.status].tone}>{t(STATUS[run.status].label)}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
