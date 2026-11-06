import { callSolutions } from '@/features/builder/api';
import type { ExtractedDocument, MaterialFormat } from './extract';

/** Материалы инструмента (`/api/solutions/:id/materials`, docs/api.md). */

export interface MaterialSummary {
  id: string;
  solutionId: string;
  name: string;
  format: MaterialFormat;
  sizeBytes: number;
  charCount: number;
  sections: Array<{ id: string; label: string; chars: number }>;
  createdAt: string;
}

export interface MaterialDetails extends Omit<MaterialSummary, 'sections'> {
  sections: Array<{ id: string; label: string; text: string; chars: number }>;
}

export interface MaterialUsage {
  count: number;
  maxCount: number;
  userChars: number;
  maxUserChars: number;
  maxMaterialChars: number;
}

const enc = encodeURIComponent;

export function listMaterials(
  solutionId: string,
): Promise<{ materials: MaterialSummary[]; usage: MaterialUsage }> {
  return callSolutions(`/${enc(solutionId)}/materials`);
}

export function uploadMaterial(
  solutionId: string,
  document: ExtractedDocument,
): Promise<{ material: MaterialSummary; duplicate: boolean }> {
  return callSolutions(`/${enc(solutionId)}/materials`, {
    method: 'POST',
    body: JSON.stringify(document),
  });
}

export async function fetchMaterial(solutionId: string, id: string): Promise<MaterialDetails> {
  return (
    await callSolutions<{ material: MaterialDetails }>(`/${enc(solutionId)}/materials/${enc(id)}`)
  ).material;
}

export async function deleteMaterial(solutionId: string, id: string): Promise<void> {
  await callSolutions(`/${enc(solutionId)}/materials/${enc(id)}`, { method: 'DELETE' });
}

// ─── Запуски операций (конспект, таблица) ─────────────────────────────────────

export type StudyOperation = 'notes' | 'table' | 'quiz' | 'self_check';
export type QuizFormat = 'choice' | 'open' | 'mixed';

/** Вход запуска: у теста — число вопросов и формат, у самопроверки — тема вместо пожеланий. */
export interface StudyRunInput {
  subject: string;
  focus?: string;
  topic?: string;
  count?: number;
  format?: QuizFormat;
  materials: Array<{ id: string; sections?: string[] }>;
}

export interface RunQuote {
  model: string;
  typicalCredits: number;
  maxCredits: number;
  inputChars: number;
  maxInputChars: number;
  confirmationRequired: boolean;
}

export interface RunSource {
  ref: string;
  materialId: string;
  materialName: string;
  sectionId: string;
  label: string;
}

export interface NotesResult {
  title: string;
  summary: string;
  sections: Array<{
    heading: string;
    points: string[];
    keyTerms: Array<{ term: string; definition: string }>;
    sources: string[];
  }>;
}

export interface TableResult {
  title: string;
  description: string;
  columns: string[];
  rows: Array<{ cells: string[]; sources: string[] }>;
}

export type RunStatus = 'queued' | 'running' | 'done' | 'failed';

export interface ToolRunView {
  id: string;
  solutionId: string;
  operation: StudyOperation;
  status: RunStatus;
  input: StudyRunInput;
  sources: RunSource[];
  quote: RunQuote;
  result: NotesResult | TableResult | QuestionSetView | null;
  resultSchema: number;
  model: { id: string; name: string } | null;
  chargedCredits: number;
  error: { code: string; message: string } | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface RunSummary extends Omit<ToolRunView, 'result' | 'input' | 'sources'> {
  title: string | null;
  subject: string;
}

export async function quoteRun(
  solutionId: string,
  operation: StudyOperation,
  input: StudyRunInput,
): Promise<RunQuote> {
  return (
    await callSolutions<{ quote: RunQuote }>(`/${enc(solutionId)}/runs/quote`, {
      method: 'POST',
      body: JSON.stringify({ operation, input }),
    })
  ).quote;
}

export async function startRun(
  solutionId: string,
  request: {
    operation: StudyOperation;
    input: StudyRunInput;
    idempotencyKey: string;
    acceptedMaxCredits: number;
    confirm?: boolean;
  },
): Promise<ToolRunView> {
  return (
    await callSolutions<{ run: ToolRunView }>(`/${enc(solutionId)}/runs`, {
      method: 'POST',
      body: JSON.stringify(request),
    })
  ).run;
}

export async function listRuns(solutionId: string): Promise<RunSummary[]> {
  return (await callSolutions<{ runs: RunSummary[] }>(`/${enc(solutionId)}/runs`)).runs;
}

export async function fetchRun(solutionId: string, runId: string): Promise<ToolRunView> {
  return (await callSolutions<{ run: ToolRunView }>(`/${enc(solutionId)}/runs/${enc(runId)}`)).run;
}

export async function deleteRun(solutionId: string, runId: string): Promise<void> {
  await callSolutions(`/${enc(solutionId)}/runs/${enc(runId)}`, { method: 'DELETE' });
}

export const isActiveRun = (run: { status: RunStatus }) =>
  run.status === 'queued' || run.status === 'running';

// ─── Тест, самопроверка, попытки и прогресс ──────────────────────────────────

/** Набор вопросов до сдачи: без ключей ответов (их сервер не присылает). */
export interface QuestionSetView {
  title: string;
  rejected: number;
  questions: Array<{
    id: string;
    type: 'choice' | 'open';
    question: string;
    options?: string[];
    topic: string;
    sources: string[];
  }>;
}

export type Verdict = 'correct' | 'partial' | 'incorrect' | 'unanswered' | 'pending';

export interface AttemptQuestion {
  id: string;
  type: 'choice' | 'open';
  question: string;
  options?: string[];
  topic: string;
  sources: string[];
  /** Только после сдачи. */
  correctIndex?: number;
  modelAnswer?: string;
  keyPoints?: string[];
  explanation?: string;
  evidence?: string;
}

export interface AnswerValue {
  selected?: number;
  text?: string;
}

export interface AnswerResult {
  questionId: string;
  verdict: Verdict;
  score: number;
  feedback?: string;
  missing?: string[];
  sources?: string[];
}

export interface AttemptView {
  id: string;
  runId: string;
  kind: 'quiz' | 'self_check';
  status: 'in_progress' | 'submitted' | 'graded';
  title: string;
  questions: AttemptQuestion[];
  answers: Record<string, AnswerValue>;
  results: AnswerResult[] | null;
  score: number | null;
  maxScore: number;
  retryOf: string | null;
  grade: {
    status: RunStatus;
    chargedCredits: number;
    error: { code: string; message: string } | null;
    quote: RunQuote;
  } | null;
  sources: RunSource[];
  createdAt: string;
  submittedAt: string | null;
  gradedAt: string | null;
}

export interface AttemptSummary {
  id: string;
  runId: string;
  kind: 'quiz' | 'self_check';
  title: string;
  status: AttemptView['status'];
  score: number | null;
  maxScore: number;
  answered: number;
  pending: number;
  createdAt: string;
  submittedAt: string | null;
}

export type TopicLevel = 'insufficient' | 'weak' | 'developing' | 'strong';

export interface TopicProgress {
  topic: string;
  answered: number;
  correct: number;
  partial: number;
  incorrect: number;
  pending: number;
  earned: number;
  accuracy: number | null;
  attempts: number;
  level: TopicLevel;
  sources: RunSource[];
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

export const isQuestionRun = (operation: StudyOperation) =>
  operation === 'quiz' || operation === 'self_check';

export async function createAttempt(
  solutionId: string,
  runId: string,
  retryOf?: string,
): Promise<AttemptView> {
  return (
    await callSolutions<{ attempt: AttemptView }>(
      `/${enc(solutionId)}/runs/${enc(runId)}/attempts`,
      {
        method: 'POST',
        body: JSON.stringify(retryOf ? { retryOf } : {}),
      },
    )
  ).attempt;
}

export async function fetchAttempt(solutionId: string, attemptId: string): Promise<AttemptView> {
  return (
    await callSolutions<{ attempt: AttemptView }>(`/${enc(solutionId)}/attempts/${enc(attemptId)}`)
  ).attempt;
}

export async function listAttempts(solutionId: string, runId?: string): Promise<AttemptSummary[]> {
  const query = runId ? `?runId=${enc(runId)}` : '';
  return (
    await callSolutions<{ attempts: AttemptSummary[] }>(`/${enc(solutionId)}/attempts${query}`)
  ).attempts;
}

export async function saveAnswers(
  solutionId: string,
  attemptId: string,
  answers: Record<string, AnswerValue>,
): Promise<AttemptView> {
  return (
    await callSolutions<{ attempt: AttemptView }>(
      `/${enc(solutionId)}/attempts/${enc(attemptId)}/answers`,
      { method: 'PUT', body: JSON.stringify({ answers }) },
    )
  ).attempt;
}

export async function submitAttempt(
  solutionId: string,
  attemptId: string,
  answers: Record<string, AnswerValue>,
): Promise<AttemptView> {
  return (
    await callSolutions<{ attempt: AttemptView }>(
      `/${enc(solutionId)}/attempts/${enc(attemptId)}/submit`,
      { method: 'POST', body: JSON.stringify({ answers }) },
    )
  ).attempt;
}

export async function quoteGrade(solutionId: string, attemptId: string): Promise<RunQuote> {
  return (
    await callSolutions<{ quote: RunQuote }>(
      `/${enc(solutionId)}/attempts/${enc(attemptId)}/grade/quote`,
      { method: 'POST', body: '{}' },
    )
  ).quote;
}

export async function gradeAttempt(
  solutionId: string,
  attemptId: string,
  request: { idempotencyKey: string; acceptedMaxCredits: number; confirm?: boolean },
): Promise<AttemptView> {
  return (
    await callSolutions<{ attempt: AttemptView }>(
      `/${enc(solutionId)}/attempts/${enc(attemptId)}/grade`,
      { method: 'POST', body: JSON.stringify(request) },
    )
  ).attempt;
}

export async function fetchProgress(solutionId: string): Promise<Progress> {
  return (await callSolutions<{ progress: Progress }>(`/${enc(solutionId)}/progress`)).progress;
}
