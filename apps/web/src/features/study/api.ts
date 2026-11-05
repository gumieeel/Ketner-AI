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

export type StudyOperation = 'notes' | 'table';

export interface StudyRunInput {
  subject: string;
  focus: string;
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
  result: NotesResult | TableResult | null;
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
