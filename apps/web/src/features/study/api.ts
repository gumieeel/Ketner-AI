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
