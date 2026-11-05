/**
 * Материалы инструментов: документы, которые пользователь загрузил в инструмент (учебный помощник).
 *
 * Текст извлекает браузер (PDF — pdf.js, DOCX/PPTX/XLSX — свой разбор ZIP, TXT как есть) и присылает
 * `ExtractedDocument`: имя, формат, размер файла и части (страницы, слайды, листы, разделы). Исходный
 * файл на сервер не попадает и не хранится. Сервер не доверяет присланному: проверяет схему и
 * размеры, нормализует текст, сам нумерует части и считает отпечаток содержимого.
 *
 * Материал — данные пользователя, а не инструкции: в запрос к модели он попадает только внутри
 * разметки данных (этап 2), никогда в системный промпт.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { PLATFORM_LIMITS } from '../../services/discovery-limits.js';

export const MATERIAL_FORMATS = ['pdf', 'docx', 'pptx', 'xlsx', 'txt'] as const;
export type MaterialFormat = (typeof MATERIAL_FORMATS)[number];

export const MATERIAL_LIMITS = PLATFORM_LIMITS.tools;

export interface MaterialSection {
  /** `s1`, `s2`… — назначает сервер по порядку; на них ссылаются результаты инструмента. */
  id: string;
  label: string;
  text: string;
  chars: number;
}

export interface Material {
  id: string;
  solutionId: string;
  ownerId: string;
  name: string;
  format: MaterialFormat;
  sizeBytes: number;
  charCount: number;
  sections: MaterialSection[];
  contentHash: string;
  createdAt: string;
}

/** Материал без текста: для списков (текст до 200 000 символов не гоняется зря). */
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

export function summarize(material: Material): MaterialSummary {
  return {
    id: material.id,
    solutionId: material.solutionId,
    name: material.name,
    format: material.format,
    sizeBytes: material.sizeBytes,
    charCount: material.charCount,
    sections: material.sections.map(({ id, label, chars }) => ({ id, label, chars })),
    createdAt: material.createdAt,
  };
}

/** Тело `POST /api/solutions/:id/materials`. Длины проверяются строго: лишнее — ошибка. */
export const extractedDocumentSchema = z.object({
  name: z.string().trim().min(1).max(MATERIAL_LIMITS.nameChars),
  format: z.enum(MATERIAL_FORMATS),
  sizeBytes: z.number().int().positive().max(MATERIAL_LIMITS.fileBytes),
  sections: z
    .array(
      z.object({
        label: z.string().max(MATERIAL_LIMITS.sectionLabelChars).default(''),
        text: z.string().max(MATERIAL_LIMITS.materialChars),
      }),
    )
    .min(1)
    .max(MATERIAL_LIMITS.materialSections),
});

export type ExtractedDocument = z.infer<typeof extractedDocumentSchema>;

// Управляющие символы, кроме перевода строки и табуляции, — мусор извлечения или попытка спрятать текст.
// eslint-disable-next-line no-control-regex -- управляющие символы и ищем, чтобы удалить
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u2028\u2029\uFEFF]/g;

/** Текст части: один вид переводов строк, без управляющих символов и лишних пустых строк. */
export function normalizeText(value: string): string {
  return value
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(CONTROL, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeLabel(value: string): string {
  return value.normalize('NFC').replace(CONTROL, '').replace(/\s+/g, ' ').trim();
}

export type MaterialBuildResult =
  | {
      ok: true;
      name: string;
      format: MaterialFormat;
      sizeBytes: number;
      sections: MaterialSection[];
      charCount: number;
      contentHash: string;
    }
  | { ok: false; code: 'material_no_text' | 'material_too_large'; charCount: number };

/**
 * Нормализует присланный документ: пустые части отбрасываются, части нумеруются заново.
 * Нет текста — скан или пустой файл; больше лимита — слишком большой.
 */
export function buildMaterial(input: ExtractedDocument): MaterialBuildResult {
  const kept = input.sections
    .map((section) => ({ label: normalizeLabel(section.label), text: normalizeText(section.text) }))
    .filter((section) => section.text.length > 0);
  const sections: MaterialSection[] = kept.map((section, index) => ({
    id: `s${index + 1}`,
    label: section.label || `${index + 1}`,
    text: section.text,
    chars: section.text.length,
  }));
  const charCount = sections.reduce((sum, section) => sum + section.chars, 0);
  if (charCount === 0) return { ok: false, code: 'material_no_text', charCount };
  if (charCount > MATERIAL_LIMITS.materialChars) {
    return { ok: false, code: 'material_too_large', charCount };
  }
  const contentHash = createHash('sha256')
    .update(JSON.stringify(sections.map((section) => [section.label, section.text])))
    .digest('hex');
  return {
    ok: true,
    name: normalizeLabel(input.name) || 'document',
    format: input.format,
    sizeBytes: input.sizeBytes,
    sections,
    charCount,
    contentHash,
  };
}
