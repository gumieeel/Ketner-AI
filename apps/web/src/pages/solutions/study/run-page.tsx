import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { Spinner } from '@/components/ui/spinner';
import { DiscoveryApiError, newIdempotencyKey } from '@/features/discovery/api';
import {
  deleteRun,
  fetchRun,
  isActiveRun,
  quoteRun,
  startRun,
  isQuestionRun,
  type NotesResult,
  type QuestionSetView,
  type RunQuote,
  type TableResult,
  type ToolRunView,
} from '@/features/study/api';
import { POLL_MS } from '@/features/discovery/use-analysis';
import { OPERATION_LABEL } from '@/features/study/labels';
import { useTranslation, type TranslationKey } from '@/i18n';
import { formatDateTime } from '@/lib/format-date';
import { ErrorNotice } from '@/pages/analysis/error-notice';
import { BuilderGate, Page } from '../shared';
import { QuestionsOverview } from './attempt-views';
import { NotesView, TableView } from './result-views';

/** Результат запуска операции: свой интерфейс конспекта или таблицы, а не сообщение в чате. */
export function RunPage() {
  const { solutionId = '', runId = '' } = useParams();
  return (
    <BuilderGate>
      <RunView key={runId} solutionId={solutionId} runId={runId} />
    </BuilderGate>
  );
}

const WORKING: Record<ToolRunView['operation'], TranslationKey> = {
  notes: 'study.run.notesWorking',
  table: 'study.run.tableWorking',
  quiz: 'study.run.quizWorking',
  self_check: 'study.run.quizWorking',
};

function RunView({ solutionId, runId }: { solutionId: string; runId: string }) {
  const translator = useTranslation();
  const { t, language } = translator;
  const navigate = useNavigate();
  const [run, setRun] = useState<ToolRunView | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [removing, setRemoving] = useState(false);
  const back = { to: `/solutions/${solutionId}`, label: t('study.result.back') };

  const refresh = useCallback(async () => {
    try {
      setRun(await fetchRun(solutionId, runId));
    } catch (caught) {
      if (caught instanceof DiscoveryApiError && caught.status === 404) setMissing(true);
      else setError(caught);
    }
  }, [solutionId, runId]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const active = run !== null && isActiveRun(run);
  useEffect(() => {
    if (!active) return;
    const timer = window.setTimeout(() => void refresh(), POLL_MS);
    return () => window.clearTimeout(timer);
  }, [active, run, refresh]);

  if (missing) {
    return (
      <Page title={t('study.result.notFound')} back={back}>
        <p className="t-lead mt-4">{t('study.result.notFoundLead')}</p>
      </Page>
    );
  }
  if (!run) {
    return (
      <Page title={t('study.badge')} back={back}>
        {error ? (
          <div className="mt-8">
            <ErrorNotice error={error} redirect={`/solutions/${solutionId}/runs/${runId}`} />
          </div>
        ) : (
          <p className="mt-8 flex items-center gap-2 text-[14px] text-muted">
            <Spinner /> {t('analysis.page.loading')}
          </p>
        )}
      </Page>
    );
  }

  const label = t(OPERATION_LABEL[run.operation]);
  const title =
    run.status === 'done' && run.result && 'title' in run.result ? run.result.title : label;
  const charged = t('study.result.charged', {
    credits: run.chargedCredits.toLocaleString(language === 'en' ? 'en-US' : 'ru-RU'),
  });

  return (
    <Page title={title} back={back} wide>
      <p className="mt-3 text-[13px] text-subtle">
        {[
          label,
          run.input.subject,
          run.model?.name,
          run.status === 'done' ? charged : null,
          formatDateTime(run.createdAt, language),
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>

      {active ? (
        <p role="status" className="mt-8 flex items-center gap-2 text-[15px] text-muted">
          <Spinner /> {t(WORKING[run.operation])}
        </p>
      ) : null}

      {run.status === 'failed' ? (
        <div
          className="mt-8 rounded-xl bg-warning-soft px-4 py-3 text-[14px] leading-6 text-text"
          role="alert"
        >
          <p>{run.error?.message ?? t('study.run.failed')}</p>
          <p className="mt-1 text-muted">
            {run.chargedCredits > 0 ? charged : t('study.run.notCharged')}
          </p>
        </div>
      ) : null}

      {run.status === 'done' && run.result && run.operation === 'notes' ? (
        <NotesView notes={run.result as NotesResult} sources={run.sources} />
      ) : null}
      {run.status === 'done' && run.result && run.operation === 'table' ? (
        <TableView table={run.result as TableResult} sources={run.sources} />
      ) : null}
      {run.status === 'done' && run.result && isQuestionRun(run.operation) ? (
        <QuestionsOverview run={run} set={run.result as QuestionSetView} />
      ) : null}

      {error ? (
        <div className="mt-6">
          <ErrorNotice error={error} redirect={`/solutions/${solutionId}/runs/${runId}`} />
        </div>
      ) : null}

      {!active ? (
        <div className="mt-10 flex flex-wrap gap-3 border-t border-stroke pt-6">
          <RerunButton
            run={run}
            onStarted={(next) => navigate(`/solutions/${solutionId}/runs/${next.id}`)}
          />
          <Button variant="outline" onClick={() => setRemoving(true)}>
            {t('study.result.delete')}
          </Button>
        </div>
      ) : null}

      {removing ? (
        <Modal labelledBy="delete-run-title" size="sm" onClose={() => setRemoving(false)}>
          <DeleteRun
            withAttempts={isQuestionRun(run.operation)}
            onCancel={() => setRemoving(false)}
            onConfirm={async () => {
              await deleteRun(solutionId, runId);
              navigate(`/solutions/${solutionId}`, { replace: true });
            }}
          />
        </Modal>
      ) : null}
    </Page>
  );
}

function DeleteRun({
  withAttempts,
  onCancel,
  onConfirm,
}: {
  /** Тест или самопроверка: вместе с вопросами удаляются попытки и их вклад в прогресс. */
  withAttempts: boolean;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  return (
    <div className="flex flex-col gap-4 p-6">
      <h2 id="delete-run-title" className="text-[18px] font-medium text-text">
        {t('study.result.deleteTitle')}
      </h2>
      <p className="text-[14px] leading-6 text-muted">
        {t(withAttempts ? 'study.result.deleteQuestionsText' : 'study.result.deleteText')}
      </p>
      {error ? <ErrorNotice error={error} redirect="/solutions" /> : null}
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Button variant="outline" onClick={onCancel}>
          {t('analysis.new.cancel')}
        </Button>
        <Button
          variant="danger"
          loading={busy}
          disabled={busy}
          onClick={() => {
            setBusy(true);
            onConfirm().catch((caught: unknown) => {
              setError(caught);
              setBusy(false);
            });
          }}
        >
          {t('study.result.delete')}
        </Button>
      </div>
    </div>
  );
}

/** Запустить ещё раз с тем же входом: сначала новая цена, потом подтверждение. */
function RerunButton({
  run,
  onStarted,
}: {
  run: ToolRunView;
  onStarted: (run: ToolRunView) => void;
}) {
  const { t } = useTranslation();
  const [quote, setQuote] = useState<RunQuote | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const keyRef = useRef<string>(newIdempotencyKey());

  const ask = async () => {
    setError(null);
    setBusy(true);
    try {
      setQuote(await quoteRun(run.solutionId, run.operation, run.input));
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };
  const confirm = async () => {
    if (!quote) return;
    setBusy(true);
    try {
      const next = await startRun(run.solutionId, {
        operation: run.operation,
        input: run.input,
        idempotencyKey: keyRef.current,
        acceptedMaxCredits: quote.maxCredits,
        confirm: true,
      });
      onStarted(next);
    } catch (caught) {
      const fresh =
        caught instanceof DiscoveryApiError && caught.code === 'confirmation_required'
          ? (caught.details.quote as RunQuote | undefined)
          : undefined;
      if (fresh) setQuote(fresh);
      else setError(caught);
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        variant={run.status === 'failed' ? 'primary' : 'outline'}
        loading={busy && !quote}
        onClick={() => void ask()}
      >
        {t('study.result.rerun')}
      </Button>
      {quote ? (
        <Modal labelledBy="rerun-title" size="sm" onClose={() => setQuote(null)}>
          <div className="flex flex-col gap-4 p-6">
            <h2 id="rerun-title" className="text-[18px] font-medium text-text">
              {t('study.result.rerunTitle')}
            </h2>
            <p className="text-[14px] leading-6 text-muted">
              {t('study.create.price', {
                typical: quote.typicalCredits,
                max: quote.maxCredits,
                model: quote.model,
              })}
            </p>
            {error ? <ErrorNotice error={error} redirect={`/solutions/${run.solutionId}`} /> : null}
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <Button variant="outline" onClick={() => setQuote(null)}>
                {t('analysis.new.cancel')}
              </Button>
              <Button loading={busy} disabled={busy} onClick={() => void confirm()}>
                {t('study.create.confirmButton', { max: quote.maxCredits })}
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}
      {error && !quote ? (
        <div className="basis-full">
          <ErrorNotice error={error} redirect={`/solutions/${run.solutionId}`} />
        </div>
      ) : null}
    </>
  );
}
