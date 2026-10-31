/**
 * Impact Estimator: польза возможности. Считает код, а не модель.
 *
 * Число (часы в неделю) появляется, только если пользователь сам назвал, сколько раз и сколько
 * минут занимает задача, и это подтверждается цитатой из его текста. Доля, которую возьмёт на себя
 * ИИ, — допущение с диапазоном; итог всегда «прогноз от–до» с формулой. Без чисел — только
 * качественная оценка и вопрос, каких данных не хватает.
 */

import type { Language } from '../types.js';
import type { ContextOutput, ContextTask, OpportunityOutput } from './schemas.js';

export type AutomationShare = 'low' | 'medium' | 'high';

/** Доля задачи, которую ИИ реально возьмёт на себя: диапазон-допущение. */
export const SHARE_RANGE: Readonly<Record<AutomationShare, readonly [number, number]>> = {
  low: [0.1, 0.3],
  medium: [0.3, 0.6],
  high: [0.6, 0.8],
};

export type Impact =
  | {
      kind: 'estimate';
      /** Прогноз экономии, часов в неделю: от и до. */
      hoursPerWeek: [number, number];
      formula: string;
      inputs: Array<{ label: string; value: string; source: 'user' }>;
      assumptions: string[];
      benefit: string;
      note: string;
    }
  | {
      kind: 'qualitative';
      benefit: string;
      /** Каких данных не хватает для расчёта. */
      missing: string;
      note: string;
    };

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[«»"“”„]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Числа задачи остаются, только если цитата-доказательство действительно есть в тексте пользователя
 * и содержит эти числа. Иначе числа сбрасываются: модель могла их придумать.
 */
/** Числа задачи, которые проверяются цитатой (старые записи могут не иметь новых полей). */
const NUMBER_FIELDS = [
  'timesPerDay',
  'timesPerWeek',
  'timesPerMonth',
  'minutesEach',
  'hoursEach',
] as const;

const numberOf = (task: ContextTask, field: (typeof NUMBER_FIELDS)[number]): number | null =>
  task[field] ?? null;

export function verifyTaskNumbers(context: ContextOutput, userText: string): ContextOutput {
  const haystack = normalize(userText);
  const tasks = context.tasks.map((task): ContextTask => {
    if (NUMBER_FIELDS.every((field) => numberOf(task, field) === null)) return task;
    const evidence = task.evidence ? normalize(task.evidence) : '';
    const quoted = evidence.length >= 3 && haystack.includes(evidence);
    const mentions = (value: number | null) =>
      value === null ||
      evidence.includes(String(value)) ||
      evidence.includes(String(value).replace('.', ','));
    if (quoted && NUMBER_FIELDS.every((field) => mentions(numberOf(task, field)))) {
      return { ...task, source: 'user' };
    }
    return {
      ...task,
      timesPerDay: null,
      timesPerWeek: null,
      timesPerMonth: null,
      minutesEach: null,
      hoursEach: null,
      evidence: null,
      source: 'inferred',
    };
  });
  return { ...context, tasks };
}

/** Рабочих дней в неделе и недель в месяце: допущения пересчёта, видны в отчёте. */
const WORKDAYS_PER_WEEK = 5;
const WEEKS_PER_MONTH = 4.3;

const formatNumber = (value: number, language: Language): string =>
  language === 'en' ? String(value) : String(value).replace('.', ',');

interface WeeklyTask {
  perWeek: number;
  minutes: number;
  /** Как пользователь назвал частоту и длительность — для формулы и входных данных. */
  howOften: string;
  howLong: string;
  formula: string;
  assumption: string | null;
}

/** Частота и длительность в неделю — только из чисел пользователя; пересчёт — с допущением. */
function weeklyTask(task: ContextTask, language: Language): WeeklyTask | null {
  const en = language === 'en';
  const n = (value: number) => formatNumber(value, language);
  const minutesEach = numberOf(task, 'minutesEach');
  const hoursEach = numberOf(task, 'hoursEach');
  const minutes = minutesEach ?? (hoursEach !== null ? hoursEach * 60 : null);
  if (minutes === null) return null;
  const howLong =
    minutesEach !== null
      ? en
        ? `${n(minutesEach)} min`
        : `${n(minutesEach)} мин`
      : en
        ? `${n(hoursEach!)} h`
        : `${n(hoursEach!)} ч`;

  const perWeek = numberOf(task, 'timesPerWeek');
  const perDay = numberOf(task, 'timesPerDay');
  const perMonth = numberOf(task, 'timesPerMonth');
  if (perWeek !== null) {
    const howOften = en ? `${n(perWeek)} times a week` : `${n(perWeek)} раз в неделю`;
    return { perWeek, minutes, howOften, howLong, formula: howOften, assumption: null };
  }
  if (perDay !== null) {
    const howOften = en ? `${n(perDay)} times a day` : `${n(perDay)} раз в день`;
    return {
      perWeek: perDay * WORKDAYS_PER_WEEK,
      minutes,
      howOften,
      howLong,
      formula: en
        ? `${howOften} × ${WORKDAYS_PER_WEEK} days`
        : `${howOften} × ${WORKDAYS_PER_WEEK} дней`,
      assumption: en
        ? `A week is ${WORKDAYS_PER_WEEK} working days; if you work every day, the saving is higher.`
        : `В неделе ${WORKDAYS_PER_WEEK} рабочих дней; если вы работаете каждый день, экономия больше.`,
    };
  }
  if (perMonth !== null) {
    const howOften = en ? `${n(perMonth)} times a month` : `${n(perMonth)} раз в месяц`;
    return {
      perWeek: perMonth / WEEKS_PER_MONTH,
      minutes,
      howOften,
      howLong,
      formula: `${howOften} ÷ ${n(WEEKS_PER_MONTH)}`,
      assumption: en
        ? `A month is ${WEEKS_PER_MONTH} weeks.`
        : `В месяце ${n(WEEKS_PER_MONTH)} недели.`,
    };
  }
  return null;
}

function roundHalf(value: number): number {
  return Math.round(value * 2) / 2;
}

export function estimateImpact(
  opportunity: OpportunityOutput,
  context: ContextOutput,
  language: Language,
): Impact {
  const en = language === 'en';
  const note = en
    ? 'This is a forecast, not a measured result.'
    : 'Это прогноз, а не измеренный результат.';
  const task = opportunity.impact.taskId
    ? context.tasks.find((item) => item.id === opportunity.impact.taskId)
    : undefined;
  const benefit = opportunity.impact.benefit;

  const weekly = task && task.source === 'user' ? weeklyTask(task, language) : null;
  if (weekly) {
    const [low, high] = SHARE_RANGE[opportunity.impact.automationShare];
    const weeklyMinutes = weekly.perWeek * weekly.minutes;
    const from = roundHalf((weeklyMinutes * low) / 60);
    const to = roundHalf((weeklyMinutes * high) / 60);
    if (to > 0) {
      return {
        kind: 'estimate',
        hoursPerWeek: [from, Math.max(from, to)],
        formula: en
          ? `${weekly.formula} × ${weekly.howLong} × ${low * 100}–${high * 100}% that AI takes over`
          : `${weekly.formula} × ${weekly.howLong} × ${low * 100}–${high * 100}% работы берёт на себя ИИ`,
        inputs: [
          { label: en ? 'How often' : 'Как часто', value: weekly.howOften, source: 'user' },
          { label: en ? 'Time each time' : 'Время за раз', value: weekly.howLong, source: 'user' },
        ],
        assumptions: [
          en
            ? `AI takes over ${low * 100}–${high * 100}% of the task; the rest stays with you (checking and edits).`
            : `ИИ берёт на себя ${low * 100}–${high * 100}% задачи; остальное остаётся за вами (проверка и правки).`,
          ...(weekly.assumption ? [weekly.assumption] : []),
          en
            ? 'The time to set the solution up is not included.'
            : 'Время на настройку решения не учтено.',
        ],
        benefit,
        note,
      };
    }
  }

  return {
    kind: 'qualitative',
    benefit,
    missing: en
      ? 'To estimate the time saved, tell how often you do this task and how long it takes each time.'
      : 'Чтобы оценить экономию времени, укажите, как часто вы делаете эту задачу и сколько времени она занимает за раз.',
    note,
  };
}
