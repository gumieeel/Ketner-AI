import planFacts from '@/features/billing/plan-facts.json';
import {
  chunkText,
  extractOfficeSections,
  type DocumentSection,
} from '@/features/chat/office-text';
import { loadPdfJs, readPdfPages, type PdfJsLike } from './pdf';

/**
 * Извлечение текста документа для инструментов — в браузере: исходный файл на сервер не уходит,
 * сервер получает только текст по частям и сам его проверяет (builder/tools/materials.ts).
 */

export const MATERIAL_FORMATS = ['pdf', 'docx', 'pptx', 'xlsx', 'txt'] as const;
export type MaterialFormat = (typeof MATERIAL_FORMATS)[number];

/** Для `<input type="file" accept>`. */
export const MATERIAL_ACCEPT = MATERIAL_FORMATS.map((format) => `.${format}`).join(',');

/** Лимиты — как на сервере: plan-facts.json сверяется тестом с services/discovery-limits.ts. */
export const MATERIAL_LIMITS = planFacts.platform.limits.tools;

export interface ExtractedDocument {
  name: string;
  format: MaterialFormat;
  sizeBytes: number;
  sections: DocumentSection[];
}

export type ExtractFailure =
  | 'unsupported'
  | 'file_too_big'
  | 'unreadable'
  | 'encrypted'
  | 'too_many_pages'
  /** Текста нет: скан или фотографии страниц — OCR не поддерживается. */
  | 'no_text';

export type ExtractResult =
  | {
      ok: true;
      document: ExtractedDocument;
      /** Частей без текста (у PDF — страницы-сканы): они не загружаются. */
      emptySections: number;
      charCount: number;
    }
  | { ok: false; reason: ExtractFailure };

export interface SectionLabels {
  page: (n: number) => string;
  slide: (n: number) => string;
  part: (n: number) => string;
}

export function materialFormat(name: string): MaterialFormat | null {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return (MATERIAL_FORMATS as readonly string[]).includes(ext) ? (ext as MaterialFormat) : null;
}

/** TXT: UTF-8, а если байты не UTF-8 — Windows-1251 (частая кодировка русских файлов). */
export function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1251').decode(bytes);
  }
}

const charsOf = (sections: readonly DocumentSection[]) =>
  sections.reduce((sum, section) => sum + section.text.trim().length, 0);

export async function extractDocument(
  file: File,
  labels: SectionLabels,
  pdfjs: () => Promise<PdfJsLike> = loadPdfJs,
): Promise<ExtractResult> {
  const format = materialFormat(file.name);
  if (!format) return { ok: false, reason: 'unsupported' };
  if (file.size > MATERIAL_LIMITS.fileBytes) return { ok: false, reason: 'file_too_big' };

  let sections: DocumentSection[];
  if (format === 'pdf') {
    const result = await readPdfPages(
      new Uint8Array(await file.arrayBuffer()),
      MATERIAL_LIMITS.materialSections,
      await pdfjs(),
    );
    if (!result.ok) return { ok: false, reason: result.reason };
    sections = result.pages.map((page) => ({ label: labels.page(page.number), text: page.text }));
  } else if (format === 'txt') {
    const text = decodeText(new Uint8Array(await file.arrayBuffer()));
    sections = chunkText(text).map((chunk, i) => ({ label: labels.part(i + 1), text: chunk }));
  } else {
    const office = await extractOfficeSections(file, format, labels);
    if (!office) return { ok: false, reason: 'unreadable' };
    sections = office;
  }
  if (sections.length > MATERIAL_LIMITS.materialSections) {
    return { ok: false, reason: 'too_many_pages' };
  }

  const withText = sections.filter((section) => section.text.trim().length > 0);
  if (withText.length === 0) return { ok: false, reason: 'no_text' };
  return {
    ok: true,
    document: {
      name: file.name.slice(0, MATERIAL_LIMITS.nameChars),
      format,
      sizeBytes: Math.max(1, file.size),
      sections: withText.map((section) => ({
        label: section.label.slice(0, MATERIAL_LIMITS.sectionLabelChars),
        text: section.text,
      })),
    },
    emptySections: sections.length - withText.length,
    charCount: charsOf(withText),
  };
}

/**
 * Самый длинный диапазон частей с начала документа, который укладывается в лимит: подсказка, когда
 * документ больше лимита и пользователь выбирает, какие страницы загрузить.
 */
export function fittingRange(
  sections: readonly DocumentSection[],
  maxChars: number = MATERIAL_LIMITS.materialChars,
): { from: number; to: number } {
  let total = 0;
  let to = 0;
  for (let i = 0; i < sections.length; i += 1) {
    const next = total + sections[i]!.text.trim().length;
    if (next > maxChars) break;
    total = next;
    to = i + 1;
  }
  return { from: 1, to: Math.max(1, to) };
}

/** Части `from..to` (с 1, включительно) и их объём. */
export function selectRange(
  document: ExtractedDocument,
  from: number,
  to: number,
): { document: ExtractedDocument; charCount: number } {
  const sections = document.sections.slice(Math.max(0, from - 1), Math.max(from, to));
  return { document: { ...document, sections }, charCount: charsOf(sections) };
}
