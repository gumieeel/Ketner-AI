import { createRequire } from 'node:module';
import * as legacyPdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { beforeAll, describe, expect, it } from 'vitest';
import { chunkText } from '@/features/chat/office-text';
import {
  decodeText,
  extractDocument,
  fittingRange,
  MATERIAL_LIMITS,
  materialFormat,
  selectRange,
  type ExtractedDocument,
} from '@/features/study/extract';
import { pageText, type PdfJsLike } from '@/features/study/pdf';
import { buildPdf } from './pdf-fixture';

const labels = {
  page: (n: number) => `Стр. ${n}`,
  slide: (n: number) => `Слайд ${n}`,
  part: (n: number) => `Часть ${n}`,
};

/** Файл для разбора: имя, размер и байты (как у File в браузере). */
function file(name: string, bytes: Uint8Array | string, size?: number): File {
  const data = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes;
  return {
    name,
    size: size ?? data.length,
    arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
  } as unknown as File;
}

// Настоящий pdf.js (сборка для Node и jsdom); на сайте — та же библиотека в своём чанке.
const realPdf = async () => legacyPdfjs as unknown as PdfJsLike;
beforeAll(() => {
  legacyPdfjs.GlobalWorkerOptions.workerSrc = createRequire(import.meta.url).resolve(
    'pdfjs-dist/legacy/build/pdf.worker.mjs',
  );
});

describe('извлечение материалов: форматы и текст', () => {
  it('формат — по расширению; остальное не принимается', () => {
    expect(materialFormat('Лекция.PDF')).toBe('pdf');
    expect(materialFormat('notes.docx')).toBe('docx');
    expect(materialFormat('slides.pptx')).toBe('pptx');
    expect(materialFormat('table.xlsx')).toBe('xlsx');
    expect(materialFormat('a.txt')).toBe('txt');
    expect(materialFormat('old.doc')).toBeNull();
    expect(materialFormat('virus.exe')).toBeNull();
    expect(materialFormat('noext')).toBeNull();
  });

  it('TXT: UTF-8, а файл в Windows-1251 читается без «кракозябр»', () => {
    expect(decodeText(new TextEncoder().encode('Привет'))).toBe('Привет');
    const cp1251 = new Uint8Array([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2]); // «Привет»
    expect(decodeText(cp1251)).toBe('Привет');
  });

  it('сплошной текст делится по абзацам на части не длиннее лимита', () => {
    const paragraphs = Array.from({ length: 30 }, (_, i) => `Абзац ${i} `.repeat(30));
    const chunks = chunkText(paragraphs.join('\n'), 1000);
    expect(chunks.length).toBeGreaterThan(5);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(1000);
    expect(chunks.join('\n')).toBe(paragraphs.join('\n'));
    // Один огромный абзац тоже режется.
    expect(chunkText('я'.repeat(2500), 1000).map((chunk) => chunk.length)).toEqual([
      1000, 1000, 500,
    ]);
  });

  it('TXT целиком: части с подписями, объём в символах', async () => {
    const result = await extractDocument(file('конспект.txt', 'Тема 1\n\nТема 2'), labels);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document).toMatchObject({ name: 'конспект.txt', format: 'txt' });
    expect(result.document.sections).toEqual([{ label: 'Часть 1', text: 'Тема 1\n\nТема 2' }]);
    expect(result.charCount).toBe('Тема 1\n\nТема 2'.length);
  });

  it('неподдерживаемый формат, слишком большой файл, пустой текст — без отправки на сервер', async () => {
    expect(await extractDocument(file('a.exe', 'MZ'), labels)).toEqual({
      ok: false,
      reason: 'unsupported',
    });
    expect(
      await extractDocument(file('big.txt', 'x', MATERIAL_LIMITS.fileBytes + 1), labels),
    ).toEqual({ ok: false, reason: 'file_too_big' });
    expect(await extractDocument(file('empty.txt', '  \n \n'), labels)).toEqual({
      ok: false,
      reason: 'no_text',
    });
    expect(await extractDocument(file('broken.docx', 'not a zip'), labels)).toEqual({
      ok: false,
      reason: 'unreadable',
    });
  });
});

describe('извлечение PDF настоящим pdf.js', () => {
  it('текст по страницам; страница-скан пропускается и считается', async () => {
    const pdf = buildPdf(['Photosynthesis basics\nChlorophyll (green)', null, 'Cell division']);
    const result = await extractDocument(file('bio.pdf', pdf), labels, realPdf);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.sections).toEqual([
      { label: 'Стр. 1', text: 'Photosynthesis basics\nChlorophyll (green)' },
      { label: 'Стр. 3', text: 'Cell division' },
    ]);
    expect(result.emptySections).toBe(1);
  });

  it('PDF только из сканов — честное «нет текста», а не пустой материал', async () => {
    const result = await extractDocument(file('scan.pdf', buildPdf([null, null])), labels, realPdf);
    expect(result).toEqual({ ok: false, reason: 'no_text' });
  });

  it('повреждённый PDF — «не удалось прочитать»', async () => {
    const result = await extractDocument(file('bad.pdf', '%PDF-1.4 garbage'), labels, realPdf);
    expect(result).toEqual({ ok: false, reason: 'unreadable' });
  });

  it('pdf.js вызывается без исполнения кода и без подключения шрифтов', async () => {
    let options: Record<string, unknown> | null = null;
    const spy: PdfJsLike = {
      getDocument(source) {
        options = source;
        return {
          promise: Promise.resolve({
            numPages: 1,
            getPage: async () => ({
              getTextContent: async () => ({ items: [{ str: 'x' }] }),
              cleanup: () => undefined,
            }),
          }),
          destroy: async () => undefined,
        };
      },
    };
    await extractDocument(file('a.pdf', 'x'), labels, async () => spy);
    expect(options).toMatchObject({
      isEvalSupported: false,
      disableFontFace: true,
      enableXfa: false,
      verbosity: 0,
    });
  });

  it('пароль и слишком много страниц — свои причины', async () => {
    const failing = (error: unknown): PdfJsLike => ({
      getDocument: () => ({ promise: Promise.reject(error), destroy: async () => undefined }),
    });
    expect(
      await extractDocument(file('a.pdf', 'x'), labels, async () =>
        failing({ name: 'PasswordException' }),
      ),
    ).toEqual({ ok: false, reason: 'encrypted' });
    const huge: PdfJsLike = {
      getDocument: () => ({
        promise: Promise.resolve({
          numPages: MATERIAL_LIMITS.materialSections + 1,
          getPage: async () => {
            throw new Error('не должен читать страницы');
          },
        }),
        destroy: async () => undefined,
      }),
    };
    expect(await extractDocument(file('a.pdf', 'x'), labels, async () => huge)).toEqual({
      ok: false,
      reason: 'too_many_pages',
    });
  });

  it('текст страницы собирается из фрагментов с переносами строк', () => {
    expect(
      pageText([
        { str: 'Закон ', hasEOL: false },
        { str: 'Ома', hasEOL: true },
        { str: 'U = IR' },
        {},
      ]),
    ).toBe('Закон Ома\nU = IR');
  });
});

describe('документ больше лимита: выбор частей', () => {
  const document: ExtractedDocument = {
    name: 'book.pdf',
    format: 'pdf',
    sizeBytes: 10,
    sections: [
      { label: 'Стр. 1', text: 'a'.repeat(400) },
      { label: 'Стр. 2', text: 'b'.repeat(400) },
      { label: 'Стр. 3', text: 'c'.repeat(400) },
    ],
  };

  it('подсказка — самый длинный диапазон с начала, который помещается', () => {
    expect(fittingRange(document.sections, 900)).toEqual({ from: 1, to: 2 });
    expect(fittingRange(document.sections, 100)).toEqual({ from: 1, to: 1 });
  });

  it('выбранный диапазон и его объём', () => {
    const selected = selectRange(document, 2, 3);
    expect(selected.document.sections.map((section) => section.label)).toEqual([
      'Стр. 2',
      'Стр. 3',
    ]);
    expect(selected.charCount).toBe(800);
  });
});
