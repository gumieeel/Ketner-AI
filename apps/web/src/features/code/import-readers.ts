import { unzipSync } from 'fflate';
import { isSensitivePath } from '../chat/file-operations/path-safety';
import type { ImportSkip } from './types';

/** Те же каталоги сервер не принимает (apps/mock-api/src/code/path-safety.ts): отсекаем заранее, чтобы не гонять трафик. */
const IGNORED_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  '__pycache__',
  '.venv',
  'venv',
  '.cache',
  '.next',
  '.nuxt',
  '.turbo',
  '.gradle',
  '.pytest_cache',
  '.mypy_cache',
  '.parcel-cache',
]);

export interface ReadLimits {
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
}

export interface ReadResult {
  files: Array<{ path: string; content: string }>;
  skipped: ImportSkip[];
}

const DECODER = new TextDecoder('utf-8', { fatal: true });

/** Текст файла или null, если файл двоичный либо не в UTF-8. */
export function decodeText(bytes: Uint8Array): string | null {
  const probe = Math.min(bytes.length, 8000);
  for (let i = 0; i < probe; i += 1) {
    if (bytes[i] === 0) return null;
  }
  try {
    return DECODER.decode(bytes);
  } catch {
    return null;
  }
}

/** Причина, по которой путь не импортируется, либо null. */
export function skipReason(path: string): string | null {
  if (path.split('/').some((segment) => IGNORED_DIRECTORIES.has(segment))) {
    return 'зависимости и служебные каталоги не импортируются';
  }
  if (isSensitivePath(path)) return 'файл с секретами не импортируется';
  return null;
}

class Collector {
  readonly result: ReadResult = { files: [], skipped: [] };
  private total = 0;

  constructor(private readonly limits: ReadLimits) {}

  /** Предварительная проверка по заявленному размеру: до чтения содержимого. */
  precheck(path: string, size: number): boolean {
    const reason = skipReason(path);
    if (reason) return this.skip(path, reason);
    if (size > this.limits.maxFileBytes) return this.skip(path, 'файл больше лимита вашего тарифа');
    if (this.result.files.length >= this.limits.maxFiles) return this.skip(path, 'превышено число файлов тарифа');
    if (this.total + size > this.limits.maxTotalBytes) return this.skip(path, 'превышен общий размер проекта');
    return true;
  }

  add(path: string, bytes: Uint8Array): void {
    const text = decodeText(bytes);
    if (text === null) {
      this.skip(path, 'двоичный файл');
      return;
    }
    this.total += bytes.length;
    this.result.files.push({ path, content: text });
  }

  skip(path: string, reason: string): false {
    this.result.skipped.push({ path, reason });
    return false;
  }
}

/** Файлы выбранной папки (`<input webkitdirectory>`). Имя самой папки в путь не входит. */
export async function readFolderFiles(list: FileList | File[], limits: ReadLimits): Promise<ReadResult> {
  const collector = new Collector(limits);
  for (const file of Array.from(list)) {
    const full = file.webkitRelativePath || file.name;
    const parts = full.split('/');
    const path = (parts.length > 1 ? parts.slice(1) : parts).join('/');
    if (!path) continue;
    if (!collector.precheck(path, file.size)) continue;
    try {
      collector.add(path, new Uint8Array(await file.arrayBuffer()));
    } catch {
      collector.skip(path, 'не удалось прочитать файл');
    }
  }
  return collector.result;
}

/** Общий верхний каталог архива (так упаковывает GitHub) убирается. */
function commonRoot(names: string[]): string {
  if (names.length === 0) return '';
  const first = names[0].split('/')[0];
  if (!first || !names[0].includes('/')) return '';
  return names.every((name) => name.startsWith(`${first}/`)) ? `${first}/` : '';
}

export async function readZipFile(file: File, limits: ReadLimits): Promise<ReadResult> {
  const collector = new Collector(limits);
  const data = new Uint8Array(await file.arrayBuffer());

  const names: string[] = [];
  unzipSync(data, {
    filter: (entry) => {
      if (!entry.name.endsWith('/')) names.push(entry.name);
      return false;
    },
  });
  const root = commonRoot(names);

  const accepted = new Map<string, string>();
  const raw = unzipSync(data, {
    filter: (entry) => {
      if (entry.name.endsWith('/')) return false;
      const relative = root && entry.name.startsWith(root) ? entry.name.slice(root.length) : entry.name;
      const path = relative.replace(/\\/g, '/');
      if (!path || path.startsWith('/') || path.split('/').includes('..')) return collector.skip(path || entry.name, 'недопустимый путь');
      if (!collector.precheck(path, entry.originalSize)) return false;
      accepted.set(entry.name, path);
      return true;
    },
  });
  for (const [name, bytes] of Object.entries(raw)) {
    const path = accepted.get(name);
    if (path) collector.add(path, bytes);
  }
  return collector.result;
}

/** Делит файлы на запросы разумного размера: сервер принимает импорт частями. */
export function chunkFiles<T extends { content: string }>(files: T[], maxBytes = 3_000_000, maxCount = 400): T[][] {
  const chunks: T[][] = [];
  let current: T[] = [];
  let size = 0;
  for (const file of files) {
    const fileSize = file.content.length;
    if (current.length > 0 && (size + fileSize > maxBytes || current.length >= maxCount)) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(file);
    size += fileSize;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}
