import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  createAttempt,
  fetchProgress,
  type Progress,
  type Recommendation,
  type TopicLevel,
} from '@/features/study/api';
import { LEVEL_LABEL } from '@/features/study/labels';
import { useTranslation } from '@/i18n';
import { formatDateTime } from '@/lib/format-date';
import { ErrorNotice } from '@/pages/analysis/error-notice';
import { SourceChips } from './result-views';

const LEVEL_TONE: Record<TopicLevel, BadgeTone> = {
  insufficient: 'neutral',
  weak: 'danger',
  developing: 'warning',
  strong: 'success',
};

/**
 * Прогресс по темам — из сданных попыток. Выводы — только при достаточном числе ответов: меньше
 * трёх — «мало данных»; «стабильно верно» — по правилу, которое показано рядом.
 */
export function ProgressPanel({ solutionId }: { solutionId: string }) {
  const { t, language } = useTranslation();
  const navigate = useNavigate();
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const number = (value: number) => value.toLocaleString(language === 'en' ? 'en-US' : 'ru-RU');
  const percent = (value: number) => `${Math.round(value * 100)}%`;

  useEffect(() => {
    let alive = true;
    fetchProgress(solutionId).then(
      (next) => alive && setProgress(next),
      (caught: unknown) => alive && setError(caught),
    );
    return () => {
      alive = false;
    };
  }, [solutionId]);

  const retry = async (recommendation: Extract<Recommendation, { kind: 'retry_mistakes' }>) => {
    const runId = progress?.history.find((item) => item.id === recommendation.attemptId)?.runId;
    if (!runId) return;
    setBusy(recommendation.attemptId);
    try {
      const attempt = await createAttempt(solutionId, runId, recommendation.attemptId);
      navigate(`/solutions/${solutionId}/attempts/${attempt.id}`);
    } catch (caught) {
      setError(caught);
      setBusy(null);
    }
  };

  return (
    <section aria-labelledby="progress-title" className="mt-10 border-t border-stroke pt-8">
      <h2 id="progress-title" className="text-[20px] font-medium tracking-[-0.01em] text-text">
        {t('study.progress.title')}
      </h2>
      {error ? (
        <div className="mt-4">
          <ErrorNotice error={error} redirect={`/solutions/${solutionId}`} />
        </div>
      ) : null}
      {progress && progress.totals.completed === 0 ? (
        <p className="mt-3 text-[14px] text-muted">{t('study.progress.empty')}</p>
      ) : null}
      {progress && progress.totals.completed > 0 ? (
        <>
          <p className="mt-3 text-[14px] leading-6 text-text">
            {t('study.progress.totals', {
              completed: number(progress.totals.completed),
              answered: number(progress.totals.answered),
            })}
            {progress.totals.accuracy !== null
              ? ` ${t('study.progress.accuracy', { value: percent(progress.totals.accuracy) })}`
              : ''}
            {progress.totals.pending > 0
              ? ` ${t('study.progress.pending', { count: progress.totals.pending })}`
              : ''}
          </p>

          {progress.recommendations.length > 0 ? (
            <div className="mt-6">
              <h3 className="text-[16px] font-medium text-text">{t('study.progress.next')}</h3>
              <ul className="mt-3 flex flex-col gap-3">
                {progress.recommendations.map((item, index) => (
                  <li
                    key={index}
                    className="rounded-xl border border-stroke p-4 text-[14px] leading-6 text-text"
                  >
                    {item.kind === 'retry_mistakes' ? (
                      <>
                        <p>
                          {t('study.progress.retry', {
                            topic: item.topic,
                            wrong: number(item.wrong),
                            answered: number(item.answered),
                          })}
                        </p>
                        <SourceChips
                          refs={item.sources.map((source) => source.ref)}
                          sources={item.sources}
                        />
                        <Button
                          className="mt-3"
                          size="sm"
                          loading={busy === item.attemptId}
                          disabled={busy !== null}
                          onClick={() => void retry(item)}
                        >
                          {t('study.attempt.retryMistakes')}
                        </Button>
                      </>
                    ) : null}
                    {item.kind === 'reread' ? (
                      <>
                        <p>{t('study.progress.reread', { topic: item.topic })}</p>
                        <SourceChips
                          refs={item.sources.map((source) => source.ref)}
                          sources={item.sources}
                        />
                      </>
                    ) : null}
                    {item.kind === 'more_practice' ? (
                      <p>
                        {t('study.progress.morePractice', {
                          topic: item.topic,
                          answered: number(item.answered),
                        })}
                      </p>
                    ) : null}
                    {item.kind === 'start' ? <p>{t('study.progress.empty')}</p> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="mt-6 overflow-x-auto rounded-xl border border-stroke">
            <table className="w-full border-collapse text-left text-[14px] leading-6">
              <caption className="sr-only">{t('study.progress.topics')}</caption>
              <thead className="bg-surface-2">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium text-text">
                    {t('study.progress.topic')}
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium text-text">
                    {t('study.progress.answers')}
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium text-text">
                    {t('study.progress.level')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {progress.topics.map((topic) => (
                  <tr key={topic.topic} className="border-t border-stroke align-top">
                    <td className="px-3 py-2 text-text">{topic.topic}</td>
                    <td className="px-3 py-2 text-muted">
                      {t('study.progress.answersValue', {
                        correct: number(topic.correct),
                        answered: number(topic.answered),
                      })}
                      {topic.partial > 0
                        ? ` · ${t('study.progress.partial', { count: number(topic.partial) })}`
                        : ''}
                      {topic.pending > 0
                        ? ` · ${t('study.progress.pendingShort', { count: number(topic.pending) })}`
                        : ''}
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone={LEVEL_TONE[topic.level]}>{t(LEVEL_LABEL[topic.level])}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[12px] leading-5 text-subtle">{t('study.progress.rules')}</p>

          <div className="mt-6">
            <h3 className="text-[16px] font-medium text-text">{t('study.progress.history')}</h3>
            <ul aria-label={t('study.progress.history')} className="mt-3 flex flex-col gap-2">
              {progress.history.map((attempt) => (
                <li key={attempt.id}>
                  <Link
                    to={`/solutions/${solutionId}/attempts/${attempt.id}`}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-stroke p-3 text-[14px] hover:bg-surface-2"
                  >
                    <span className="text-text">
                      {attempt.title} ·{' '}
                      {attempt.score === null
                        ? t('study.attempt.inProgress')
                        : t('study.attempt.score', {
                            score: number(attempt.score),
                            max: number(attempt.maxScore),
                          })}
                    </span>
                    <span className="text-[13px] text-subtle">
                      {formatDateTime(attempt.createdAt, language)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </>
      ) : null}
    </section>
  );
}
