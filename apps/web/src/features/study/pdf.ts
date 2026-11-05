/**
 * Текст PDF по страницам — pdf.js (Mozilla). Библиотека и её воркер грузятся только здесь и только
 * когда пользователь выбрал PDF в учебном помощнике: в остальные страницы сайта они не попадают.
 *
 * Только текстовый слой: страницы-картинки (сканы) дают пустой текст — распознавания (OCR) нет,
 * и вызывающий код честно говорит об этом. Исполнение кода из PDF выключено (`isEvalSupported`),
 * шрифты не подключаются к странице (`disableFontFace`): нужен только текст.
 */

export interface PdfPageText {
  number: number;
  text: string;
}

export type PdfResult =
  | { ok: true; pages: PdfPageText[] }
  | { ok: false; reason: 'encrypted' | 'unreadable' | 'too_many_pages' };

/** Часть API pdf.js, которой мы пользуемся (так её можно подменить в тестах). */
export interface PdfJsLike {
  getDocument(source: {
    data: Uint8Array;
    isEvalSupported: boolean;
    disableFontFace: boolean;
    enableXfa: boolean;
    stopAtErrors: boolean;
    /** 0 — только ошибки: предупреждения о шрифтах для отрисовки нам не нужны (читаем только текст). */
    verbosity: number;
  }): {
    promise: Promise<{
      numPages: number;
      getPage(number: number): Promise<{
        getTextContent(): Promise<{ items: Array<{ str?: string; hasEOL?: boolean }> }>;
        cleanup(): void;
      }>;
    }>;
    /** Освобождает документ и воркер (в pdf.js 6 — у задачи загрузки, не у документа). */
    destroy(): Promise<void>;
  };
}

let loading: Promise<PdfJsLike> | null = null;

/** pdf.js с воркером из сборки сайта (CSP: worker-src 'self'). */
export function loadPdfJs(): Promise<PdfJsLike> {
  loading ??= Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]).then(([pdfjs, worker]) => {
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    return pdfjs as unknown as PdfJsLike;
  });
  return loading;
}

/** Текст страницы: фрагменты подряд, перенос строки там, где его отметил pdf.js. */
export function pageText(items: ReadonlyArray<{ str?: string; hasEOL?: boolean }>): string {
  let text = '';
  for (const item of items) {
    if (typeof item.str !== 'string') continue;
    text += item.str;
    if (item.hasEOL) text += '\n';
  }
  return text;
}

export async function readPdfPages(
  data: Uint8Array,
  maxPages: number,
  pdfjs: PdfJsLike,
): Promise<PdfResult> {
  const task = pdfjs.getDocument({
    data,
    isEvalSupported: false,
    disableFontFace: true,
    enableXfa: false,
    stopAtErrors: false,
    verbosity: 0,
  });
  let document;
  try {
    document = await task.promise;
  } catch (error) {
    await task.destroy().catch(() => undefined);
    const name = (error as { name?: string } | null)?.name;
    return { ok: false, reason: name === 'PasswordException' ? 'encrypted' : 'unreadable' };
  }
  try {
    if (document.numPages > maxPages) return { ok: false, reason: 'too_many_pages' };
    const pages: PdfPageText[] = [];
    for (let number = 1; number <= document.numPages; number += 1) {
      const page = await document.getPage(number);
      const content = await page.getTextContent();
      pages.push({ number, text: pageText(content.items) });
      page.cleanup();
    }
    return { ok: true, pages };
  } catch {
    return { ok: false, reason: 'unreadable' };
  } finally {
    await task.destroy().catch(() => undefined);
  }
}
