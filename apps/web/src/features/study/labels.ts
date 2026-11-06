import type { TranslationKey } from '@/i18n';
import type { StudyOperation, TopicLevel, Verdict } from './api';

export const OPERATION_LABEL: Record<StudyOperation, TranslationKey> = {
  notes: 'study.operation.notes',
  table: 'study.operation.table',
  quiz: 'study.operation.quiz',
  self_check: 'study.operation.self_check',
};

export const VERDICT_LABEL: Record<Verdict, TranslationKey> = {
  correct: 'study.verdict.correct',
  partial: 'study.verdict.partial',
  incorrect: 'study.verdict.incorrect',
  unanswered: 'study.verdict.unanswered',
  pending: 'study.verdict.pending',
};

/** Уровень темы: «стабильно верно» — наблюдение по ответам, а не «освоено». */
export const LEVEL_LABEL: Record<TopicLevel, TranslationKey> = {
  insufficient: 'study.level.insufficient',
  weak: 'study.level.weak',
  developing: 'study.level.developing',
  strong: 'study.level.strong',
};
