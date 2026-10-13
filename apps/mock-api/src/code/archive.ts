/**
 * ZIP и GitHub: импорт проекта из архива и экспорт проекта в ZIP.
 *
 * Архивы приходят из внешнего мира, поэтому все ограничения применяются ДО распаковки по
 * заявленным размерам (защита от «бомб»), пути проходят нормализацию, а секреты, служебные
 * каталоги, двоичные и нечитаемые как UTF-8 файлы пропускаются с указанием причины.
 */

import { Zip, ZipDeflate, unzipSync } from 'fflate';
import { looksBinaryBuffer } from './project-fs.js';
import { isGitInternalPath, isIgnoredPath, isSecretPath, normalizeProjectPath } from './path-safety.js';

export interface ExtractLimits {
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
}

export interface ExtractedArchive {
  files: Array<{ path: string; content: string }>;
  skipped: Array<{ path: string; reason: string }>;
}

const DECODER = new TextDecoder('utf-8', { fatal: true });

/** Общий верхний каталог (в архивах GitHub это `repo-<sha>/`) убирается. */
function commonRoot(names: string[]): string {
  if (names.length === 0) return '';
  const first = names[0].split('/')[0];
  if (!first || !names[0].includes('/')) return '';
  return names.every((name) => name.startsWith(`${first}/`)) ? `${first}/` : '';
}

export function extractZipText(data: Uint8Array, limits: ExtractLimits): ExtractedArchive {
  const skipped: ExtractedArchive['skipped'] = [];
  const accepted = new Map<string, string>();
  let declaredTotal = 0;
  let count = 0;

  const names: string[] = [];
  // Первый проход: только список имён, без распаковки.
  unzipSync(data, {
    filter: (file) => {
      if (!file.name.endsWith('/')) names.push(file.name);
      return false;
    },
  });
  const root = commonRoot(names);

  const raw = unzipSync(data, {
    filter: (file) => {
      if (file.name.endsWith('/')) return false;
      const relative = root && file.name.startsWith(root) ? file.name.slice(root.length) : file.name;
      let normalized: string;
      try {
        normalized = normalizeProjectPath(relative);
      } catch {
        skipped.push({ path: relative.slice(0, 120), reason: 'недопустимый путь' });
        return false;
      }
      if (isGitInternalPath(normalized)) return false;
      if (isIgnoredPath(normalized)) {
        skipped.push({ path: normalized, reason: 'зависимости и кэш не импортируются' });
        return false;
      }
      if (isSecretPath(normalized)) {
        skipped.push({ path: normalized, reason: 'файл с секретами не импортируется' });
        return false;
      }
      if (file.originalSize > limits.maxFileBytes) {
        skipped.push({ path: normalized, reason: 'файл больше лимита тарифа' });
        return false;
      }
      if (count >= limits.maxFiles) {
        skipped.push({ path: normalized, reason: 'превышено число файлов тарифа' });
        return false;
      }
      if (declaredTotal + file.originalSize > limits.maxTotalBytes) {
        skipped.push({ path: normalized, reason: 'превышен общий размер проекта' });
        return false;
      }
      declaredTotal += file.originalSize;
      count += 1;
      accepted.set(file.name, normalized);
      return true;
    },
  });

  const files: ExtractedArchive['files'] = [];
  for (const [name, bytes] of Object.entries(raw)) {
    const normalized = accepted.get(name);
    if (!normalized) continue;
    if (looksBinaryBuffer(Buffer.from(bytes.buffer, bytes.byteOffset, Math.min(bytes.length, 8000)))) {
      skipped.push({ path: normalized, reason: 'двоичный файл' });
      continue;
    }
    try {
      files.push({ path: normalized, content: DECODER.decode(bytes) });
    } catch {
      skipped.push({ path: normalized, reason: 'не UTF-8' });
    }
  }
  return { files, skipped };
}

/** Потоковая сборка ZIP: чанки отдаются сразу, весь архив в памяти не держится. */
export function createZipWriter(onChunk: (chunk: Uint8Array, final: boolean) => void): {
  add: (path: string, data: Uint8Array) => void;
  end: () => void;
} {
  const zip = new Zip((error, chunk, final) => {
    if (error) throw error;
    onChunk(chunk, final);
  });
  return {
    add(path, data) {
      const entry = new ZipDeflate(path, { level: 6 });
      zip.add(entry);
      entry.push(data, true);
    },
    end: () => zip.end(),
  };
}

// ─────────────────────────────────────────────────────────────
// GitHub
// ─────────────────────────────────────────────────────────────

export interface GithubRef {
  owner: string;
  repo: string;
  ref?: string;
}

const GITHUB_NAME = /^[A-Za-z0-9_.-]{1,100}$/;

/** Принимает https://github.com/owner/repo[.git][/tree/ref/...] и короткую запись owner/repo. */
export function parseGithubUrl(input: string): GithubRef | null {
  const text = input.trim();
  if (!text || text.length > 300) return null;
  let segments: string[];
  const short = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(text);
  if (short) {
    segments = [short[1], short[2]];
  } else {
    let url: URL;
    try {
      url = new URL(text.startsWith('http') ? text : `https://${text}`);
    } catch {
      return null;
    }
    if (url.protocol !== 'https:' || !['github.com', 'www.github.com'].includes(url.hostname.toLowerCase())) return null;
    if (url.username || url.password || url.port) return null;
    segments = url.pathname.split('/').filter(Boolean);
  }
  if (segments.length < 2) return null;
  const owner = segments[0];
  const repo = segments[1].replace(/\.git$/i, '');
  if (!GITHUB_NAME.test(owner) || !GITHUB_NAME.test(repo) || repo === '.' || repo === '..') return null;
  let ref: string | undefined;
  if (segments[2] === 'tree' && segments[3]) {
    ref = decodeURIComponent(segments[3]);
    if (!/^[A-Za-z0-9_./-]{1,100}$/.test(ref) || ref.includes('..')) return null;
  }
  return { owner, repo, ...(ref ? { ref } : {}) };
}

export class GithubImportError extends Error {
  constructor(
    readonly code: 'not_found' | 'too_large' | 'unavailable',
    message: string,
  ) {
    super(message);
  }
}

export async function downloadGithubZip(
  target: GithubRef,
  options: { maxBytes: number; timeoutMs?: number; fetchImpl?: typeof fetch; token?: string },
): Promise<Uint8Array> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const headers: Record<string, string> = { 'User-Agent': 'ketner-code', Accept: 'application/vnd.github+json' };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  const url =
    `https://api.github.com/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}/zipball` +
    (target.ref ? `/${target.ref.split('/').map(encodeURIComponent).join('/')}` : '');
  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers,
      redirect: 'follow',
      signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
    });
  } catch {
    throw new GithubImportError('unavailable', 'GitHub недоступен. Попробуйте позже или загрузите ZIP-архив.');
  }
  if (response.status === 404 || response.status === 403 || response.status === 401) {
    throw new GithubImportError(
      'not_found',
      options.token
        ? 'Репозиторий не найден или у привязанного аккаунта GitHub нет к нему доступа.'
        : 'Репозиторий не найден или закрыт. Подключите GitHub в настройках, чтобы импортировать приватные репозитории.',
    );
  }
  if (!response.ok || !response.body) {
    throw new GithubImportError('unavailable', 'GitHub недоступен. Попробуйте позже или загрузите ZIP-архив.');
  }
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > options.maxBytes) {
    throw new GithubImportError('too_large', 'Архив репозитория слишком большой для импорта.');
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > options.maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new GithubImportError('too_large', 'Архив репозитория слишком большой для импорта.');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}
