/**
 * Прогресс по темам — только из настоящих ответов человека в сданных попытках.
 *
 * Правила (код, а не модель):
 *   - ответ без проверки (`pending`) в точность не идёт; пустой ответ считается неверным;
 *   - меньше `minAnswers` ответов по теме — «мало данных», никаких выводов;
 *   - слабая тема — точность ниже `weakBelow` при достаточном числе ответов;
 *   - «стабильно верно» — только при `strongMinAnswers` ответах минимум в `strongMinAttempts`
 *     попытках, точности от `strongFrom` и верном последнем ответе. Слова «освоено» нет: даже это —
 *     наблюдение по ответам, а не гарантия знания.
 */
import type { Attempt, AttemptKind, Verdict } from '../attempt-store.js';
import type { RunSource } from '../operations.js';
import type { QuestionSet } from './questions.js';

export const PROGRESS_RULES = {
  minAnswers: 3,
  weakBelow: 0.6,
  strongFrom: 0.85,
  strongMinAnswers: 5,
  strongMinAttempts: 2,
} as const;

export type TopicLevel = 'insufficient' | 'weak' | 'developing' | 'strong';

export interface TopicProgress {
  topic: string;
  answered: number;
  correct: number;
  partial: number;
  incorrect: number;
  pending: number;
  /** Сумма баллов по проверенным ответам. */
  earned: number;
  /** earned / answered; null — проверенных ответов нет. */
  accuracy: number | null;
  /** В скольких попытках встречалась тема. */
  attempts: number;
  lastVerdict: Verdict | null;
  level: TopicLevel;
  /** Части материалов из вопросов, на которых были ошибки: что перечитать. */
  sources: RunSource[];
  /** Последняя сданная попытка с ошибками по теме: из неё можно повторить ошибки. */
  retryAttemptId: string | null;
}

export type Recommendation =
  | { kind: 'start' }
  | {
      kind: 'retry_mistakes';
      topic: string;
      attemptId: string;
      wrong: number;
      answered: number;
      sources: RunSource[];
    }
  | { kind: 'reread'; topic: string; sources: RunSource[] }
  | { kind: 'more_practice'; topic: string; answered: number };

export interface AttemptSummary {
  id: string;
  runId: string;
  kind: AttemptKind;
  title: string;
  status: Attempt['status'];
  score: number | null;
  maxScore: number;
  answered: number;
  pending: number;
  createdAt: string;
  submittedAt: string | null;
}

export interface Progress {
  totals: {
    attempts: number;
    completed: number;
    answered: number;
    earned: number;
    pending: number;
    accuracy: number | null;
  };
  topics: TopicProgress[];
  recommendations: Recommendation[];
  history: AttemptSummary[];
}

export interface RunQuestions {
  title: string;
  set: QuestionSet;
  sources: RunSource[];
}

const topicKey = (topic: string) => topic.toLowerCase().replace(/\s+/g, ' ').trim();
const round = (value: number) => Math.round(value * 1000) / 1000;

function level(topic: Omit<TopicProgress, 'level'>): TopicLevel {
  if (topic.answered < PROGRESS_RULES.minAnswers || topic.accuracy === null) return 'insufficient';
  if (topic.accuracy < PROGRESS_RULES.weakBelow) return 'weak';
  if (
    topic.accuracy >= PROGRESS_RULES.strongFrom &&
    topic.answered >= PROGRESS_RULES.strongMinAnswers &&
    topic.attempts >= PROGRESS_RULES.strongMinAttempts &&
    topic.lastVerdict === 'correct'
  ) {
    return 'strong';
  }
  return 'developing';
}

export function summarizeAttempt(attempt: Attempt, title: string): AttemptSummary {
  const results = attempt.results ?? [];
  return {
    id: attempt.id,
    runId: attempt.runId,
    kind: attempt.kind,
    title,
    status: attempt.status,
    score: attempt.score,
    maxScore: attempt.maxScore,
    answered: results.filter((item) => item.verdict !== 'pending').length,
    pending: results.filter((item) => item.verdict === 'pending').length,
    createdAt: attempt.createdAt,
    submittedAt: attempt.submittedAt,
  };
}

export function computeProgress(
  attempts: readonly Attempt[],
  runs: ReadonlyMap<string, RunQuestions>,
): Progress {
  const finished = attempts
    .filter(
      (attempt) => attempt.status !== 'in_progress' && attempt.results && runs.has(attempt.runId),
    )
    .sort(
      (a, b) =>
        (a.submittedAt ?? '').localeCompare(b.submittedAt ?? '') || a.id.localeCompare(b.id),
    );

  const topics = new Map<string, Omit<TopicProgress, 'level'> & { attemptIds: Set<string> }>();
  let answered = 0;
  let earned = 0;
  let pending = 0;

  for (const attempt of finished) {
    const run = runs.get(attempt.runId)!;
    for (const result of attempt.results!) {
      const question = run.set.questions.find((item) => item.id === result.questionId);
      if (!question) continue;
      const key = topicKey(question.topic);
      const topic = topics.get(key) ?? {
        topic: question.topic,
        answered: 0,
        correct: 0,
        partial: 0,
        incorrect: 0,
        pending: 0,
        earned: 0,
        accuracy: null,
        attempts: 0,
        lastVerdict: null,
        sources: [],
        retryAttemptId: null,
        attemptIds: new Set<string>(),
      };
      topic.attemptIds.add(attempt.id);
      if (result.verdict === 'pending') {
        topic.pending += 1;
        pending += 1;
      } else {
        topic.answered += 1;
        topic.earned += result.score;
        answered += 1;
        earned += result.score;
        if (result.verdict === 'correct') topic.correct += 1;
        else if (result.verdict === 'partial') topic.partial += 1;
        else topic.incorrect += 1;
        topic.lastVerdict = result.verdict;
        if (result.verdict !== 'correct') {
          topic.retryAttemptId = attempt.id;
          for (const ref of question.sources) {
            const source = run.sources.find((item) => item.ref === ref);
            if (
              source &&
              !topic.sources.some(
                (item) =>
                  item.materialId === source.materialId && item.sectionId === source.sectionId,
              )
            ) {
              topic.sources.push(source);
            }
          }
        }
      }
      topics.set(key, topic);
    }
  }

  const list: TopicProgress[] = [...topics.values()].map(({ attemptIds, ...topic }) => {
    const filled = {
      ...topic,
      earned: round(topic.earned),
      attempts: attemptIds.size,
      accuracy: topic.answered > 0 ? round(topic.earned / topic.answered) : null,
      sources: topic.sources.slice(0, 3),
    };
    return { ...filled, level: level(filled) };
  });
  const order: Record<TopicLevel, number> = { weak: 0, developing: 1, insufficient: 2, strong: 3 };
  list.sort(
    (a, b) =>
      order[a.level] - order[b.level] ||
      (a.accuracy ?? 1) - (b.accuracy ?? 1) ||
      b.answered - a.answered ||
      a.topic.localeCompare(b.topic),
  );

  const recommendations: Recommendation[] = [];
  if (finished.length === 0) recommendations.push({ kind: 'start' });
  for (const topic of list.filter((item) => item.level === 'weak').slice(0, 3)) {
    if (topic.retryAttemptId) {
      recommendations.push({
        kind: 'retry_mistakes',
        topic: topic.topic,
        attemptId: topic.retryAttemptId,
        wrong: topic.partial + topic.incorrect,
        answered: topic.answered,
        sources: topic.sources,
      });
    }
  }
  for (const topic of list
    .filter((item) => item.level === 'developing' && item.sources.length > 0)
    .slice(0, 2)) {
    recommendations.push({ kind: 'reread', topic: topic.topic, sources: topic.sources });
  }
  for (const topic of list
    .filter((item) => item.level === 'insufficient' && item.answered > 0)
    .slice(0, 2)) {
    recommendations.push({ kind: 'more_practice', topic: topic.topic, answered: topic.answered });
  }

  return {
    totals: {
      attempts: attempts.length,
      completed: finished.length,
      answered,
      earned: round(earned),
      pending,
      accuracy: answered > 0 ? round(earned / answered) : null,
    },
    topics: list,
    recommendations,
    history: [...attempts]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 50)
      .map((attempt) => summarizeAttempt(attempt, runs.get(attempt.runId)?.title ?? '')),
  };
}
