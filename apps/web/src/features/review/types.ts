/**
 * Перекрёстная проверка нейросетей: модель одной компании проверяет ответ модели другой.
 * Формы совпадают с mock-API (services/answer-review.ts, docs/api.md «Проверка ответа»).
 */

export interface ReviewerInfo {
  modelId: string;
  modelName: string;
  /** Компания-разработчик модели-рецензента. */
  developer: string;
}

export type ReviewSeverity = 'high' | 'medium' | 'low';
export type AnswerVerdict = 'ok' | 'minor' | 'major' | 'wrong' | 'unknown';

export interface AnswerReviewIssue {
  severity: ReviewSeverity;
  quote?: string;
  problem: string;
  fix?: string;
}

export interface AnswerReview {
  id: string;
  verdict: AnswerVerdict;
  summary: string;
  issues: AnswerReviewIssue[];
  corrected?: string;
  reviewer: ReviewerInfo;
  authorModelId?: string;
  createdAt: string;
}

/** Проверки за сутки: общий лимит для чата, Ketner Code и судьи сравнения. */
export interface ReviewQuota {
  used: number;
  limit: number;
  remaining: number;
}

export type JudgeAgreement = 'full' | 'partial' | 'low' | 'unknown';

export interface JudgeDispute {
  topic: string;
  positions: Array<{ model: string; claim: string }>;
  resolution?: string;
}

export interface JudgeResult {
  id: string;
  content: string;
  agreement: JudgeAgreement;
  consensus: string[];
  disputes: JudgeDispute[];
  judge: ReviewerInfo;
  slots: number[];
  createdAt: string;
}
