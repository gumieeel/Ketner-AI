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
export function verifyTaskNumbers(context: ContextOutput, userText: string): ContextOutput {
  const haystack = normalize(userText);
  const tasks = context.tasks.map((task): ContextTask => {
    if (task.timesPerWeek === null && task.minutesEach === null) return task;
    const evidence = task.evidence ? normalize(task.evidence) : '';
    const quoted = evidence.length >= 3 && haystack.includes(evidence);
    const mentions = (value: number | null) =>
      value === null ||
      evidence.includes(String(value)) ||
      evidence.includes(String(value).replace('.', ','));
    if (quoted && mentions(task.timesPerWeek) && mentions(task.minutesEach)) {
      return { ...task, source: 'user' };
    }
    return { ...task, timesPerWeek: null, minutesEach: null, evidence: null, source: 'inferred' };
  });
  return { ...context, tasks };
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

  if (task && task.source === 'user' && task.timesPerWeek !== null && task.minutesEach !== null) {
    const [low, high] = SHARE_RANGE[opportunity.impact.automationShare];
    const weeklyMinutes = task.timesPerWeek * task.minutesEach;
    const from = roundHalf((weeklyMinutes * low) / 60);
    const to = roundHalf((weeklyMinutes * high) / 60);
    if (to > 0) {
      return {
        kind: 'estimate',
        hoursPerWeek: [from, Math.max(from, to)],
        formula: en
          ? `${task.timesPerWeek} times a week × ${task.minutesEach} min × ${low * 100}–${high * 100}% that AI takes over`
          : `${task.timesPerWeek} раз в неделю × ${task.minutesEach} мин × ${low * 100}–${high * 100}% работы берёт на себя ИИ`,
        inputs: [
          {
            label: en ? 'How often' : 'Как часто',
            value: en ? `${task.timesPerWeek} times a week` : `${task.timesPerWeek} раз в неделю`,
            source: 'user',
          },
          {
            label: en ? 'Time each time' : 'Время за раз',
            value: en ? `${task.minutesEach} min` : `${task.minutesEach} мин`,
            source: 'user',
          },
        ],
        assumptions: [
          en
            ? `AI takes over ${low * 100}–${high * 100}% of the task; the rest stays with you (checking and edits).`
            : `ИИ берёт на себя ${low * 100}–${high * 100}% задачи; остальное остаётся за вами (проверка и правки).`,
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
