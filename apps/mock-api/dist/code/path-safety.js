/**
 * Безопасные пути внутри проекта и общие ошибки модуля «Ketner Code».
 *
 * Все пути, пришедшие от клиента или от модели, сначала проходят через `normalizeProjectPath`:
 * только относительные пути без `..`, без служебных каталогов и без управляющих символов.
 */
const STATUS_BY_CODE = {
    invalid_request: 400,
    invalid_path: 400,
    forbidden_path: 403,
    not_found: 404,
    already_exists: 409,
    quota_exceeded: 413,
    file_too_large: 413,
    binary_file: 415,
    conflict: 409,
    agent_disabled: 403,
    sandbox_unavailable: 503,
};
/** Ошибка модуля: код и HTTP-статус известны сразу, текст безопасен для показа пользователю. */
export class CodeError extends Error {
    code;
    status;
    constructor(code, message) {
        super(message);
        this.name = 'CodeError';
        this.code = code;
        this.status = STATUS_BY_CODE[code];
    }
}
export const MAX_PATH_LENGTH = 300;
export const MAX_SEGMENT_LENGTH = 120;
/**
 * Каталоги, которые не показываются в дереве, не участвуют в поиске и не входят в квоту проекта:
 * зависимости и кэши, которые порождают команды (`npm install`, сборка). Выгрузка и копия в БД их
 * тоже пропускают.
 */
export const IGNORED_DIRECTORIES = new Set([
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
export function isIgnoredPath(relativePath) {
    return relativePath.split('/').some((segment) => IGNORED_DIRECTORIES.has(segment));
}
/**
 * Приводит путь к каноническому виду `a/b/c.ts` или бросает `invalid_path`.
 * Отклоняются: пустой путь, абсолютные пути (в том числе `C:\`), `..`, NUL и управляющие символы,
 * слишком длинные пути. Обратные слэши заменяются на прямые, ведущие `./` убираются.
 */
export function normalizeProjectPath(input) {
    if (typeof input !== 'string') {
        throw new CodeError('invalid_path', 'Путь должен быть строкой');
    }
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f\u007f]/.test(input)) {
        throw new CodeError('invalid_path', 'Путь содержит недопустимые символы');
    }
    let value = input.trim().replace(/\\/g, '/');
    if (value === '') {
        throw new CodeError('invalid_path', 'Пустой путь');
    }
    if (value.startsWith('/') || /^[a-zA-Z]:/.test(value) || value.startsWith('~')) {
        throw new CodeError('invalid_path', 'Нужен путь относительно корня проекта');
    }
    const segments = [];
    for (const segment of value.split('/')) {
        if (segment === '' || segment === '.')
            continue;
        if (segment === '..') {
            throw new CodeError('invalid_path', 'Путь не может выходить за пределы проекта (..)');
        }
        if (segment.length > MAX_SEGMENT_LENGTH) {
            throw new CodeError('invalid_path', 'Слишком длинное имя файла или каталога');
        }
        segments.push(segment);
    }
    if (segments.length === 0) {
        throw new CodeError('invalid_path', 'Пустой путь');
    }
    value = segments.join('/');
    if (value.length > MAX_PATH_LENGTH) {
        throw new CodeError('invalid_path', 'Слишком длинный путь');
    }
    return value;
}
/** Как `normalizeProjectPath`, но пустой путь и «.» означают корень проекта (пустая строка). */
export function normalizeDirectoryPath(input) {
    if (input === undefined || input === null)
        return '';
    if (typeof input === 'string' && ['', '.', './', '/'].includes(input.trim()))
        return '';
    return normalizeProjectPath(input);
}
/** В служебный каталог `.git` нельзя писать файловыми инструментами (команды git работают как обычно). */
export function isGitInternalPath(relativePath) {
    return relativePath === '.git' || relativePath.startsWith('.git/');
}
const SECRET_PATTERNS = [
    /(^|\/)\.env(\..+)?$/i,
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
/** Шаблоны вида `.env.example` не содержат секретов и разрешены. */
const SECRET_EXEMPT = /(^|\/)\.env\.(example|sample|template|dist|defaults?)$/i;
/**
 * Файл с секретами: агент не читает его и не отправляет содержимое модели. Пользователь может
 * открыть и править такой файл сам в редакторе: ограничение касается только передачи модели.
 */
export function isSecretPath(relativePath) {
    const normalized = relativePath.replace(/\\/g, '/');
    if (SECRET_EXEMPT.test(normalized))
        return false;
    return SECRET_PATTERNS.some((pattern) => pattern.test(normalized));
}
/** Язык файла по расширению: для подсветки в редакторе и подсказки модели. */
export function languageOf(relativePath) {
    const name = relativePath.split('/').pop() ?? relativePath;
    const lower = name.toLowerCase();
    if (lower === 'dockerfile')
        return 'dockerfile';
    if (lower === 'makefile')
        return 'makefile';
    const ext = lower.includes('.') ? lower.split('.').pop() : '';
    const map = {
        ts: 'typescript',
        tsx: 'tsx',
        js: 'javascript',
        jsx: 'jsx',
        mjs: 'javascript',
        cjs: 'javascript',
        json: 'json',
        md: 'markdown',
        py: 'python',
        rb: 'ruby',
        go: 'go',
        rs: 'rust',
        java: 'java',
        kt: 'kotlin',
        cs: 'csharp',
        cpp: 'cpp',
        c: 'c',
        h: 'c',
        php: 'php',
        sh: 'bash',
        bash: 'bash',
        yml: 'yaml',
        yaml: 'yaml',
        toml: 'toml',
        html: 'html',
        css: 'css',
        scss: 'scss',
        sql: 'sql',
        xml: 'xml',
        txt: 'text',
    };
    return map[ext] ?? ext;
}
