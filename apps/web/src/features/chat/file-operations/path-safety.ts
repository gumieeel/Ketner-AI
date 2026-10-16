/**
 * Безопасная нормализация путей из ответов модели.
 *
 * Модель — недоверенный источник: путь из `file-actions` нельзя использовать как есть.
 * Здесь отсекаются выходы за пределы проекта (`..`), служебные каталоги `.git`, абсолютные
 * пути Windows, управляющие символы, а также записи в файлы с секретами.
 */

export type PathCheck = { ok: true; path: string } | { ok: false; reason: string };

const MAX_PATH_LENGTH = 300;

const SENSITIVE_PATTERNS: RegExp[] = [
  /(^|\/)\.env(\.|$)/i,
  /(^|\/)\.npmrc$/i,
  /(^|\/)\.pypirc$/i,
  /(^|\/)\.netrc$/i,
  /(^|\/)id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i,
  /\.(pem|key|p12|pfx|keystore|jks)$/i,
  /(^|\/)(credentials|secrets?)(\.[a-z0-9]+)?$/i,
  /(^|\/)service-account.*\.json$/i,
  /(^|\/)\.aws\//i,
  /(^|\/)\.ssh\//i,
];

/** Файлы с секретами: их содержимое не отправляется модели, поэтому и менять их по её совету нельзя. */
export function isSensitivePath(path: string): boolean {
  const normalized = path.replace(/\\/g, '/');
  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(normalized));
}

/** Убирает дублирующий корень проекта (`my-app/src/a.ts` → `src/a.ts`), если все файлы лежат под ним. */
export function stripRootPrefix(
  path: string,
  rootName: string | undefined,
  knownPaths: string[],
): string {
  if (!rootName) return path;
  const prefix = `${rootName}/`;
  if (!path.startsWith(prefix)) return path;
  // Если файл с таким путём реально есть в проекте — это не корень, а настоящая вложенная папка.
  if (knownPaths.includes(path)) return path;
  return path.slice(prefix.length);
}

export interface SanitizeOptions {
  /** Пути файлов проекта: нужны для сопоставления регистра и корневого префикса. */
  knownPaths?: string[];
  /** Имя корневой папки проекта (для локальных папок). */
  rootName?: string;
}

/**
 * Приводит путь из ответа модели к безопасному относительному виду либо объясняет, почему нельзя.
 */
export function sanitizeChangePath(raw: unknown, options: SanitizeOptions = {}): PathCheck {
  if (typeof raw !== 'string') return { ok: false, reason: 'путь не указан' };
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(raw))
    return { ok: false, reason: 'недопустимые символы в пути' };

  let path = raw.trim().replace(/\\/g, '/');
  if (/^[a-zA-Z]:/.test(path) || path.startsWith('//')) {
    return { ok: false, reason: 'абсолютный путь вне проекта' };
  }
  path = path
    .replace(/^(\.\/)+/, '')
    .replace(/^\/+/, '')
    .replace(/\/{2,}/g, '/');
  if (path.endsWith('/')) return { ok: false, reason: 'путь указывает на папку, а не на файл' };
  if (!path || path === '.') return { ok: false, reason: 'пустой путь' };
  if (path.length > MAX_PATH_LENGTH) return { ok: false, reason: 'слишком длинный путь' };

  const segments = path.split('/');
  if (segments.some((s) => s === '..'))
    return { ok: false, reason: 'путь выходит за пределы проекта (..)' };
  if (segments.some((s) => s === '.git'))
    return { ok: false, reason: 'изменение служебной папки .git запрещено' };
  if (segments.some((s) => s === '.')) path = segments.filter((s) => s !== '.').join('/');
  if (!path) return { ok: false, reason: 'пустой путь' };

  const known = options.knownPaths ?? [];
  path = stripRootPrefix(path, options.rootName, known);

  if (!known.includes(path)) {
    // Windows и macOS не различают регистр: `Src/App.ts` — тот же файл, что и `src/app.ts`.
    const lower = path.toLowerCase();
    const matches = known.filter((p) => p.toLowerCase() === lower);
    if (matches.length === 1) path = matches[0];
  }

  return { ok: true, path };
}
