/**
 * Извлечение текста из Office-документов (DOCX, XLSX, PPTX) прямо в браузере.
 *
 * Эти форматы — ZIP-архивы с XML. Раньше их читали как обычный текст и получали «кракозябры»,
 * за которые пользователь платил токенами. Здесь без сторонних библиотек разбирается ZIP
 * (central directory + deflate через DecompressionStream) и достаётся текст.
 *
 * PDF и старые бинарные форматы (DOC/XLS/PPT) не поддерживаются: приложение честно говорит
 * об этом пользователю и модели, а не подсовывает мусор.
 */

export type OfficeFormat = 'docx' | 'xlsx' | 'pptx';

const MAX_OFFICE_BYTES = 25 * 1024 * 1024;
const MAX_ENTRY_BYTES = 30 * 1024 * 1024;
const MAX_SHEET_ROWS = 2000;

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
}

function readZipEntries(view: DataView): ZipEntry[] | null {
  // Конец центрального каталога ищем с конца файла (комментарий архива до 64 КБ).
  const minPos = Math.max(0, view.byteLength - 22 - 0xffff);
  let eocd = -1;
  for (let i = view.byteLength - 22; i >= minPos; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;

  const total = view.getUint16(eocd + 10, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  if (total === 0xffff || cdOffset === 0xffffffff) return null; // ZIP64 не поддерживается

  const decoder = new TextDecoder('utf-8');
  const entries: ZipEntry[] = [];
  let pos = cdOffset;
  for (let i = 0; i < total; i++) {
    if (pos + 46 > view.byteLength || view.getUint32(pos, true) !== 0x02014b50) return null;
    const method = view.getUint16(pos + 10, true);
    const compressedSize = view.getUint32(pos + 20, true);
    const uncompressedSize = view.getUint32(pos + 24, true);
    const nameLength = view.getUint16(pos + 28, true);
    const extraLength = view.getUint16(pos + 30, true);
    const commentLength = view.getUint16(pos + 32, true);
    const localOffset = view.getUint32(pos + 42, true);
    const name = decoder.decode(
      new Uint8Array(view.buffer, view.byteOffset + pos + 46, nameLength),
    );
    entries.push({ name, method, compressedSize, uncompressedSize, localOffset });
    pos += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('DecompressionStream не поддерживается этим браузером');
  }
  const body = new Response(data as BodyInit).body;
  if (!body) throw new Error('Не удалось открыть поток данных');
  const stream = body.pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function readEntry(
  view: DataView,
  bytes: Uint8Array,
  entry: ZipEntry,
): Promise<string | null> {
  if (entry.uncompressedSize > MAX_ENTRY_BYTES) return null;
  const pos = entry.localOffset;
  if (pos + 30 > view.byteLength || view.getUint32(pos, true) !== 0x04034b50) return null;
  const nameLength = view.getUint16(pos + 26, true);
  const extraLength = view.getUint16(pos + 28, true);
  const start = pos + 30 + nameLength + extraLength;
  const raw = bytes.subarray(start, start + entry.compressedSize);
  let data: Uint8Array;
  if (entry.method === 0) data = raw;
  else if (entry.method === 8) data = await inflateRaw(raw);
  else return null;
  return new TextDecoder('utf-8').decode(data);
}

function decodeXml(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => safeFromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => safeFromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function safeFromCodePoint(code: number): string {
  try {
    return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : '';
  } catch {
    return '';
  }
}

/** Текст всех узлов `<tag>` внутри фрагмента XML. */
function collectTags(xml: string, tag: string): string {
  const regex = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'g');
  let out = '';
  for (const match of xml.matchAll(regex)) out += decodeXml(match[1]);
  return out;
}

function docxToText(xml: string): string {
  const paragraphs: string[] = [];
  for (const para of xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)) {
    let text = '';
    for (const token of para[0].matchAll(
      /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br\/>|<w:cr\/>/g,
    )) {
      if (token[0].startsWith('<w:tab')) text += '\t';
      else if (token[0].startsWith('<w:br') || token[0].startsWith('<w:cr')) text += '\n';
      else text += decodeXml(token[1] ?? '');
    }
    paragraphs.push(text);
  }
  return paragraphs
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function pptxSlideToText(xml: string): string {
  const paragraphs: string[] = [];
  for (const para of xml.matchAll(/<a:p[ >][\s\S]*?<\/a:p>/g)) {
    const text = collectTags(para[0], 'a:t');
    if (text.trim()) paragraphs.push(text);
  }
  return paragraphs.join('\n');
}

function columnIndex(ref: string): number {
  const letters = ref.replace(/[^A-Z]/gi, '').toUpperCase();
  let index = 0;
  for (const ch of letters) index = index * 26 + (ch.charCodeAt(0) - 64);
  return index - 1;
}

function parseSharedStrings(xml: string | null): string[] {
  if (!xml) return [];
  const result: string[] = [];
  for (const si of xml.matchAll(/<si>([\s\S]*?)<\/si>|<si\/>/g)) {
    result.push(si[1] ? collectTags(si[1], 't') : '');
  }
  return result;
}

function sheetToTsv(xml: string, shared: string[]): string {
  const rows: string[] = [];
  for (const row of xml.matchAll(/<row[ >][\s\S]*?<\/row>/g)) {
    if (rows.length >= MAX_SHEET_ROWS) {
      rows.push(`... (показаны первые ${MAX_SHEET_ROWS} строк)`);
      break;
    }
    const cells: string[] = [];
    for (const cell of row[0].matchAll(/<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cell[1];
      const body = cell[2] ?? '';
      const ref = /r="([A-Z]+\d+)"/.exec(attrs)?.[1];
      const type = /t="([a-zA-Z]+)"/.exec(attrs)?.[1];
      let value = '';
      if (type === 'inlineStr') value = collectTags(body, 't');
      else {
        const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
        if (v !== undefined) value = type === 's' ? (shared[Number(v)] ?? '') : decodeXml(v);
      }
      const col = ref ? columnIndex(ref) : cells.length;
      while (cells.length < col) cells.push('');
      cells[col] = value.replace(/[\t\r\n]+/g, ' ');
    }
    if (cells.some((c) => c !== '')) rows.push(cells.join('\t'));
  }
  return rows.join('\n');
}

async function xlsxSheets(
  entries: Map<string, ZipEntry>,
  read: (name: string) => Promise<string | null>,
): Promise<Array<{ name: string; text: string }>> {
  const shared = parseSharedStrings(await read('xl/sharedStrings.xml'));
  const workbook = (await read('xl/workbook.xml')) ?? '';
  const rels = (await read('xl/_rels/workbook.xml.rels')) ?? '';

  const targets = new Map<string, string>();
  for (const rel of rels.matchAll(/<Relationship\s[^>]*>/g)) {
    const id = /Id="([^"]+)"/.exec(rel[0])?.[1];
    const target = /Target="([^"]+)"/.exec(rel[0])?.[1];
    if (id && target) targets.set(id, target.replace(/^\//, '').replace(/^xl\//, ''));
  }

  const sheets: Array<{ name: string; path: string }> = [];
  for (const sheet of workbook.matchAll(/<sheet\s[^>]*>/g)) {
    const name = /name="([^"]*)"/.exec(sheet[0])?.[1];
    const rid = /r:id="([^"]+)"/.exec(sheet[0])?.[1];
    const target = rid ? targets.get(rid) : undefined;
    if (name && target) sheets.push({ name: decodeXml(name), path: `xl/${target}` });
  }
  if (sheets.length === 0) {
    // Запасной путь: листы по именам файлов.
    const names = [...entries.keys()]
      .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
      .sort((a, b) => Number(/(\d+)\.xml$/.exec(a)?.[1]) - Number(/(\d+)\.xml$/.exec(b)?.[1]));
    names.forEach((path, i) => sheets.push({ name: `Лист ${i + 1}`, path }));
  }

  const parts: Array<{ name: string; text: string }> = [];
  for (const sheet of sheets) {
    const xml = await read(sheet.path);
    if (!xml) continue;
    const tsv = sheetToTsv(xml, shared);
    if (tsv) parts.push({ name: sheet.name, text: tsv });
  }
  return parts;
}

/** Содержимое документа по частям: слайды, листы или весь текст DOCX. */
type OfficeContent =
  | { format: 'docx'; text: string }
  | { format: 'pptx'; slides: Array<{ number: number; text: string }> }
  | { format: 'xlsx'; sheets: Array<{ name: string; text: string }> };

async function readOffice(file: Blob, format: OfficeFormat): Promise<OfficeContent | null> {
  if (file.size > MAX_OFFICE_BYTES) return null;
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);

  const list = readZipEntries(view);
  if (!list) return null;
  const entries = new Map(list.map((e) => [e.name, e]));
  const read = async (name: string): Promise<string | null> => {
    const entry = entries.get(name);
    return entry ? readEntry(view, bytes, entry) : null;
  };

  if (format === 'docx') {
    const xml = await read('word/document.xml');
    return xml ? { format, text: docxToText(xml) } : null;
  }
  if (format === 'pptx') {
    const names = [...entries.keys()]
      .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
      .sort((a, b) => Number(/(\d+)\.xml$/.exec(a)?.[1]) - Number(/(\d+)\.xml$/.exec(b)?.[1]));
    const slides: Array<{ number: number; text: string }> = [];
    for (let i = 0; i < names.length; i++) {
      const xml = await read(names[i]);
      slides.push({ number: i + 1, text: xml ? pptxSlideToText(xml) : '' });
    }
    return { format, slides };
  }
  return { format, sheets: await xlsxSheets(entries, read) };
}

/**
 * Возвращает текст документа либо `null`, если формат не удалось прочитать.
 * Ошибки не выбрасываются: вызывающий код сообщает пользователю, что текст не извлечён.
 */
export async function extractOfficeText(
  file: Blob,
  format: OfficeFormat,
  maxChars = 200_000,
): Promise<string | null> {
  try {
    const content = await readOffice(file, format);
    if (!content) return null;
    let text = '';
    if (content.format === 'docx') text = content.text;
    else if (content.format === 'pptx') {
      text = content.slides
        .filter((slide) => slide.text)
        .map((slide) => `## Слайд ${slide.number}\n${slide.text}`)
        .join('\n\n');
    } else {
      text = content.sheets.map((sheet) => `## ${sheet.name}\n${sheet.text}`).join('\n\n');
    }

    text = text.trim();
    if (!text) return null;
    return text.length > maxChars
      ? `${text.slice(0, maxChars)}\n\n... [текст документа обрезан]`
      : text;
  } catch {
    return null;
  }
}

export interface DocumentSection {
  label: string;
  text: string;
}

/** Длина части длинного сплошного текста (DOCX, TXT), символов. */
export const CHUNK_CHARS = 4000;

/**
 * Делит сплошной текст на части примерно по `size` символов, по границам абзацев: на части
 * ссылаются результаты инструментов, и пользователь выбирает, какие из них взять.
 */
export function chunkText(text: string, size = CHUNK_CHARS): string[] {
  const chunks: string[] = [];
  let current = '';
  for (const paragraph of text.split(/\n/)) {
    if (current && current.length + paragraph.length + 1 > size) {
      chunks.push(current);
      current = '';
    }
    // Один абзац длиннее части — режется по длине, чтобы часть не разрасталась.
    let rest = paragraph;
    while (rest.length > size) {
      if (current) {
        chunks.push(current);
        current = '';
      }
      chunks.push(rest.slice(0, size));
      rest = rest.slice(size);
    }
    current = current ? `${current}\n${rest}` : rest;
  }
  if (current.trim()) chunks.push(current);
  return chunks.filter((chunk) => chunk.trim().length > 0);
}

/**
 * Части документа для инструментов: слайды PPTX, листы XLSX, фрагменты DOCX. `null` — файл не
 * прочитался; пустой массив — текста в нём нет.
 */
export async function extractOfficeSections(
  file: Blob,
  format: OfficeFormat,
  labels: { slide: (n: number) => string; part: (n: number) => string },
): Promise<DocumentSection[] | null> {
  try {
    const content = await readOffice(file, format);
    if (!content) return null;
    if (content.format === 'pptx') {
      return content.slides
        .filter((slide) => slide.text.trim())
        .map((slide) => ({ label: labels.slide(slide.number), text: slide.text }));
    }
    if (content.format === 'xlsx') {
      return content.sheets.map((sheet) => ({ label: sheet.name, text: sheet.text }));
    }
    return chunkText(content.text).map((text, i) => ({ label: labels.part(i + 1), text }));
  } catch {
    return null;
  }
}
