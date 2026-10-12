/**
 * Инструменты агента: чтение, поиск, правка файлов проекта и запуск команд.
 *
 * Модель видит только описания инструментов и их текстовые результаты. Все пути проходят через
 * `ProjectStore` (нормализация, защита от ссылок, квоты), файлы с секретами для модели закрыты,
 * размер каждого результата ограничен, чтобы один вызов не раздул контекст и счёт.
 */
import { countLineChanges, makePatch } from './line-diff.js';
import { CodeError, isGitInternalPath, isIgnoredPath, isSecretPath, normalizeDirectoryPath, normalizeProjectPath, } from './path-safety.js';
import { looksBinaryBuffer } from './project-fs.js';
export const DEFAULT_TOOL_LIMITS = {
    maxOutputChars: 30_000,
    maxReadLines: 1_000,
    maxSearchResults: 80,
    maxListEntries: 300,
    maxCommandOutputBytes: 24_000,
};
function limitsOf(ctx) {
    return { ...DEFAULT_TOOL_LIMITS, ...ctx.limits };
}
function clip(text, max) {
    if (text.length <= max)
        return text;
    return `${text.slice(0, max)}\n[... output cut: ${text.length - max} more characters ...]`;
}
function fail(label, message) {
    return { ok: false, output: `Error: ${message}`, label, summary: message.slice(0, 160) };
}
function formatBytes(bytes) {
    if (bytes >= 1024 * 1024)
        return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    if (bytes >= 1024)
        return `${(bytes / 1024).toFixed(1)} KB`;
    return `${bytes} B`;
}
// ─────────────────────────────────────────────────────────────
// Описания инструментов
// ─────────────────────────────────────────────────────────────
export function agentToolDefinitions(options) {
    const tools = [
        {
            type: 'function',
            function: {
                name: 'list_files',
                description: 'List files and directories of the project. Without "recursive" shows only the direct children of "path" ' +
                    '(directories end with "/"). Use it to explore the structure before reading files.',
                parameters: {
                    type: 'object',
                    properties: {
                        path: { type: 'string', description: 'Directory relative to the project root. Default: the root.' },
                        recursive: { type: 'boolean', description: 'List all files below the directory (limited to 300 entries).' },
                    },
                },
            },
        },
        {
            type: 'function',
            function: {
                name: 'read_file',
                description: 'Read a text file. Lines are returned with a line number and a tab in front; NEVER include these ' +
                    'prefixes when you pass text to edit_file. Long files are returned in parts: use start_line/end_line.',
                parameters: {
                    type: 'object',
                    properties: {
                        path: { type: 'string', description: 'File path relative to the project root.' },
                        start_line: { type: 'integer', description: '1-based first line to return.' },
                        end_line: { type: 'integer', description: '1-based last line to return (inclusive).' },
                    },
                    required: ['path'],
                },
            },
        },
        {
            type: 'function',
            function: {
                name: 'search_files',
                description: 'Search file contents with a regular expression (or a plain string with "literal": true) and/or find files ' +
                    'by name with a glob such as "src/**/*.ts". Returns "path:line: text". Prefer this over reading many files.',
                parameters: {
                    type: 'object',
                    properties: {
                        pattern: { type: 'string', description: 'Regular expression to find inside files. Omit to only list files matching "glob".' },
                        glob: { type: 'string', description: 'Only files whose path matches this glob (supports *, **, ?, {a,b}).' },
                        path: { type: 'string', description: 'Only search below this directory.' },
                        literal: { type: 'boolean', description: 'Treat "pattern" as a plain string, not a regular expression.' },
                        case_sensitive: { type: 'boolean', description: 'Default false.' },
                        max_results: { type: 'integer', description: 'Maximum number of matches (default 80).' },
                    },
                },
            },
        },
        {
            type: 'function',
            function: {
                name: 'edit_file',
                description: 'Replace text in an existing file. "old_string" must match the file EXACTLY (whitespace and indentation ' +
                    'included) and be unique in the file, otherwise add more surrounding lines; set "replace_all" to change every ' +
                    'occurrence. Prefer this over write_file for changes to existing files.',
                parameters: {
                    type: 'object',
                    properties: {
                        path: { type: 'string' },
                        old_string: { type: 'string', description: 'Exact text to replace (without line-number prefixes).' },
                        new_string: { type: 'string', description: 'Replacement text.' },
                        replace_all: { type: 'boolean', description: 'Replace every occurrence. Default false.' },
                    },
                    required: ['path', 'old_string', 'new_string'],
                },
            },
        },
        {
            type: 'function',
            function: {
                name: 'write_file',
                description: 'Create a new file or completely overwrite an existing one with "content". Parent directories are created ' +
                    'automatically. Write the full, working content: never use placeholders like "rest of the file unchanged".',
                parameters: {
                    type: 'object',
                    properties: {
                        path: { type: 'string' },
                        content: { type: 'string', description: 'Complete file content.' },
                    },
                    required: ['path', 'content'],
                },
            },
        },
        {
            type: 'function',
            function: {
                name: 'move_file',
                description: 'Rename or move a file. Fails if the destination exists.',
                parameters: {
                    type: 'object',
                    properties: { from: { type: 'string' }, to: { type: 'string' } },
                    required: ['from', 'to'],
                },
            },
        },
        {
            type: 'function',
            function: {
                name: 'delete_file',
                description: 'Delete a file or a whole directory (recursively). This cannot be undone: delete only what the task requires.',
                parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
            },
        },
        {
            type: 'function',
            function: {
                name: 'update_plan',
                description: 'Your task list, shown to the user. At the start of any task that needs more than one or two changes, ' +
                    'split it into 3-8 concrete, verifiable subtasks in execution order. Then work through them one at a ' +
                    'time: exactly one item in_progress, mark it done as soon as it is finished and verified, and set the ' +
                    'next one in_progress in the same call. Add items when you discover new work; remove items that turned ' +
                    'out to be unnecessary. Always send the full list. Statuses: pending, in_progress, done.',
                parameters: {
                    type: 'object',
                    properties: {
                        items: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    text: { type: 'string' },
                                    status: { type: 'string', enum: ['pending', 'in_progress', 'done'] },
                                },
                                required: ['text', 'status'],
                            },
                        },
                    },
                    required: ['items'],
                },
            },
        },
    ];
    if (options.commands) {
        tools.push({
            type: 'function',
            function: {
                name: 'run_command',
                description: 'Run a shell command in the project root inside an isolated sandbox (tests, build, linters, scripts). ' +
                    (options.network
                        ? 'Network access is available (package installs work). '
                        : 'There is NO network access: dependencies cannot be installed, use what is already in the project. ') +
                    'Commands run non-interactively and are killed after the timeout. The output is truncated, so print only what you need.',
                parameters: {
                    type: 'object',
                    properties: {
                        command: { type: 'string', description: 'Shell command, for example "npm test" or "python -m unittest".' },
                        timeout_seconds: { type: 'integer', description: 'Timeout, default 60, maximum is set by the plan.' },
                    },
                    required: ['command'],
                },
            },
        });
    }
    return tools;
}
// ─────────────────────────────────────────────────────────────
// Разбор аргументов
// ─────────────────────────────────────────────────────────────
function parseArgs(raw) {
    const text = raw.trim();
    if (text === '')
        return {};
    try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
            return parsed;
        return { __error: 'arguments must be a JSON object' };
    }
    catch (error) {
        return { __error: `arguments are not valid JSON (${error.message}). Send complete, valid JSON.` };
    }
}
function str(args, key) {
    const value = args[key];
    return typeof value === 'string' ? value : undefined;
}
function int(args, key) {
    const value = args[key];
    if (typeof value === 'number' && Number.isFinite(value))
        return Math.trunc(value);
    if (typeof value === 'string' && /^-?\d+$/.test(value.trim()))
        return Number(value);
    return undefined;
}
function bool(args, key) {
    const value = args[key];
    return value === true || value === 'true';
}
// ─────────────────────────────────────────────────────────────
// Реализации
// ─────────────────────────────────────────────────────────────
async function listFiles(args, ctx) {
    const limits = limitsOf(ctx);
    let directory;
    try {
        directory = normalizeDirectoryPath(str(args, 'path'));
    }
    catch (error) {
        return fail('list_files', error.message);
    }
    const label = `list_files ${directory || '.'}`;
    const files = await ctx.store.listFiles(ctx.userId, ctx.projectId);
    const prefix = directory ? `${directory}/` : '';
    if (directory && files.some((f) => f.path === directory)) {
        return fail(label, `${directory} is a file, not a directory. Use read_file.`);
    }
    const below = files.filter((f) => f.path.startsWith(prefix));
    if (directory && below.length === 0) {
        return fail(label, `Directory not found or empty: ${directory}`);
    }
    const lines = [];
    if (bool(args, 'recursive')) {
        for (const file of below.slice(0, limits.maxListEntries)) {
            lines.push(`${file.path}  (${formatBytes(file.size)})`);
        }
        if (below.length > limits.maxListEntries) {
            lines.push(`[... ${below.length - limits.maxListEntries} more files; narrow "path" or use search_files]`);
        }
    }
    else {
        const dirs = new Map();
        const direct = [];
        for (const file of below) {
            const rest = file.path.slice(prefix.length);
            const slash = rest.indexOf('/');
            if (slash === -1)
                direct.push({ name: rest, size: file.size });
            else
                dirs.set(rest.slice(0, slash), (dirs.get(rest.slice(0, slash)) ?? 0) + 1);
        }
        for (const [name, count] of [...dirs.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
            lines.push(`${name}/  (${count} files)`);
        }
        for (const file of direct.sort((a, b) => (a.name < b.name ? -1 : 1))) {
            lines.push(`${file.name}  (${formatBytes(file.size)})`);
        }
        if (lines.length > limits.maxListEntries) {
            const extra = lines.length - limits.maxListEntries;
            lines.length = limits.maxListEntries;
            lines.push(`[... ${extra} more entries]`);
        }
    }
    const header = `${directory || '.'}: ${below.length} file(s)`;
    return {
        ok: true,
        output: lines.length > 0 ? `${header}\n${lines.join('\n')}` : `${header} (empty project)`,
        label,
        summary: `${below.length} files`,
    };
}
async function readFile(args, ctx) {
    const limits = limitsOf(ctx);
    const rawPath = str(args, 'path');
    if (!rawPath)
        return fail('read_file', '"path" is required');
    let filePath;
    try {
        filePath = normalizeProjectPath(rawPath);
    }
    catch (error) {
        return fail(`read_file ${rawPath}`, error.message);
    }
    const label = `read_file ${filePath}`;
    if (isSecretPath(filePath)) {
        return fail(label, 'This file may contain secrets (.env, keys). Its content is not available to the assistant.');
    }
    let content;
    try {
        content = (await ctx.store.readText(ctx.userId, ctx.projectId, filePath, { maxBytes: 2_000_000 })).content;
    }
    catch (error) {
        return fail(label, error instanceof CodeError ? error.message : 'could not read the file');
    }
    ctx.readPaths.add(filePath);
    if (content === '')
        return { ok: true, output: `${filePath}: (empty file)`, label, summary: 'empty' };
    const all = content.split('\n');
    if (all[all.length - 1] === '')
        all.pop();
    const total = all.length;
    let start = int(args, 'start_line') ?? 1;
    let end = int(args, 'end_line') ?? start + limits.maxReadLines - 1;
    start = Math.max(1, start);
    end = Math.min(total, Math.max(start, end), start + limits.maxReadLines - 1);
    if (start > total)
        return fail(label, `start_line ${start} is past the end of the file (${total} lines)`);
    const width = String(end).length;
    const numbered = [];
    let chars = 0;
    let lastShown = start - 1;
    for (let i = start; i <= end; i += 1) {
        const line = all[i - 1].replace(/\r$/, '');
        const rendered = `${String(i).padStart(width, ' ')}\t${line.length > 2_000 ? `${line.slice(0, 2_000)}[... line cut]` : line}`;
        if (chars + rendered.length > limits.maxOutputChars)
            break;
        numbered.push(rendered);
        chars += rendered.length + 1;
        lastShown = i;
    }
    let output = `${filePath} (${total} lines). Lines ${start}-${lastShown}:\n${numbered.join('\n')}`;
    if (lastShown < total) {
        output += `\n[... ${total - lastShown} more lines. Call read_file with start_line=${lastShown + 1} to continue]`;
    }
    return { ok: true, output, label, summary: `${lastShown - start + 1}/${total} lines` };
}
/** Преобразует glob в регулярное выражение (поддержка *, **, ?, {a,b}). */
export function globToRegExp(glob) {
    let source = '';
    let i = 0;
    while (i < glob.length) {
        const char = glob[i];
        if (char === '*') {
            if (glob[i + 1] === '*') {
                i += 2;
                if (glob[i] === '/') {
                    i += 1;
                    source += '(?:.*/)?';
                }
                else {
                    source += '.*';
                }
                continue;
            }
            source += '[^/]*';
        }
        else if (char === '?') {
            source += '[^/]';
        }
        else if (char === '{') {
            const close = glob.indexOf('}', i);
            if (close > i) {
                const options = glob
                    .slice(i + 1, close)
                    .split(',')
                    .map((part) => part.replace(/[.+^${}()|[\]\\*?]/g, '\\$&'));
                source += `(?:${options.join('|')})`;
                i = close + 1;
                continue;
            }
            source += '\\{';
        }
        else {
            source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
        }
        i += 1;
    }
    // Без «/» в шаблоне сопоставляется имя файла в любом каталоге, как в gitignore.
    const prefix = glob.includes('/') ? '^' : '^(?:.*/)?';
    return new RegExp(`${prefix}${source}$`, 'i');
}
/** Отсекает заведомо опасные для времени выполнения шаблоны: вложенные квантификаторы. */
function isRiskyRegex(pattern) {
    return /\((?:[^()\\]|\\.)*[+*](?:[^()\\]|\\.)*\)[+*{]/.test(pattern) || pattern.length > 300;
}
async function searchFiles(args, ctx) {
    const limits = limitsOf(ctx);
    const pattern = str(args, 'pattern');
    const glob = str(args, 'glob');
    if (!pattern && !glob)
        return fail('search_files', 'Provide "pattern", "glob" or both');
    let directory;
    try {
        directory = normalizeDirectoryPath(str(args, 'path'));
    }
    catch (error) {
        return fail('search_files', error.message);
    }
    const label = `search_files ${pattern ?? glob}`;
    let regex = null;
    if (pattern) {
        const literal = bool(args, 'literal');
        if (!literal && isRiskyRegex(pattern)) {
            return fail(label, 'This regular expression is too complex or risky. Simplify it or set "literal": true.');
        }
        try {
            regex = new RegExp(literal ? pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : pattern, bool(args, 'case_sensitive') ? '' : 'i');
        }
        catch (error) {
            return fail(label, `invalid regular expression: ${error.message}`);
        }
    }
    const globRegex = glob ? globToRegExp(glob) : null;
    const maxResults = Math.min(Math.max(int(args, 'max_results') ?? limits.maxSearchResults, 1), 200);
    const prefix = directory ? `${directory}/` : '';
    const files = (await ctx.store.listFiles(ctx.userId, ctx.projectId)).filter((f) => f.path.startsWith(prefix) && (!globRegex || globRegex.test(f.path)));
    if (!regex) {
        const shown = files.slice(0, limits.maxListEntries).map((f) => f.path);
        return {
            ok: true,
            output: shown.length > 0 ? `${files.length} file(s):\n${shown.join('\n')}` : 'No files match.',
            label,
            summary: `${files.length} files`,
        };
    }
    const fs = await ctx.store.fsFor(ctx.userId, ctx.projectId);
    const results = [];
    let matches = 0;
    let scannedBytes = 0;
    let filesWithMatches = 0;
    let stoppedEarly = false;
    const deadline = Date.now() + 8_000;
    for (const file of files) {
        if (isSecretPath(file.path) || file.size > 1_000_000)
            continue;
        if (scannedBytes > 40_000_000 || Date.now() > deadline) {
            stoppedEarly = true;
            break;
        }
        let buffer;
        try {
            buffer = await fs.readBuffer(file.path, { maxBytes: 1_000_000 });
        }
        catch {
            continue;
        }
        scannedBytes += buffer.length;
        if (looksBinaryBuffer(buffer))
            continue;
        const lines = buffer.toString('utf8').split('\n');
        let fileHit = false;
        for (let index = 0; index < lines.length; index += 1) {
            const line = lines[index];
            const probe = line.length > 1_000 ? line.slice(0, 1_000) : line;
            if (!regex.test(probe))
                continue;
            matches += 1;
            fileHit = true;
            if (results.length < maxResults) {
                results.push(`${file.path}:${index + 1}: ${probe.trim().slice(0, 300)}`);
            }
        }
        if (fileHit)
            filesWithMatches += 1;
        if (matches >= maxResults * 20) {
            stoppedEarly = true;
            break;
        }
    }
    if (matches === 0) {
        return { ok: true, output: 'No matches.', label, summary: '0 matches' };
    }
    let output = `${matches}${stoppedEarly ? '+' : ''} match(es) in ${filesWithMatches} file(s)${matches > results.length ? `, showing ${results.length}` : ''}:\n${results.join('\n')}`;
    if (stoppedEarly)
        output += '\n[search stopped early: narrow it with "path" or "glob"]';
    return { ok: true, output: clip(output, limits.maxOutputChars), label, summary: `${matches} matches` };
}
function lineNumberAt(text, index) {
    let line = 1;
    for (let i = 0; i < index; i += 1)
        if (text.charCodeAt(i) === 10)
            line += 1;
    return line;
}
function snippetAround(text, startLine, endLine, context = 3) {
    const lines = text.split('\n');
    const from = Math.max(1, startLine - context);
    const to = Math.min(lines.length, endLine + context);
    const width = String(to).length;
    const out = [];
    for (let i = from; i <= to; i += 1)
        out.push(`${String(i).padStart(width, ' ')}\t${lines[i - 1].replace(/\r$/, '')}`);
    return out.join('\n');
}
function findSimilarLines(content, needle) {
    const first = needle
        .split('\n')
        .map((line) => line.trim())
        .find((line) => line.length >= 3);
    if (!first)
        return '';
    const hits = [];
    const lines = content.split('\n');
    for (let i = 0; i < lines.length && hits.length < 3; i += 1) {
        if (lines[i].includes(first) || lines[i].trim() === first)
            hits.push(`  line ${i + 1}: ${lines[i].trimEnd().slice(0, 160)}`);
    }
    return hits.length > 0 ? `\nSimilar text exists here, compare whitespace and indentation:\n${hits.join('\n')}` : '';
}
async function editFile(args, ctx) {
    const rawPath = str(args, 'path');
    const oldString = str(args, 'old_string');
    const newString = str(args, 'new_string');
    if (!rawPath || oldString === undefined || newString === undefined) {
        return fail('edit_file', '"path", "old_string" and "new_string" are required');
    }
    let filePath;
    try {
        filePath = normalizeProjectPath(rawPath);
    }
    catch (error) {
        return fail(`edit_file ${rawPath}`, error.message);
    }
    const label = `edit_file ${filePath}`;
    if (isSecretPath(filePath))
        return fail(label, 'Secret files cannot be edited by the assistant.');
    if (isGitInternalPath(filePath))
        return fail(label, 'The .git directory cannot be edited.');
    if (oldString === '')
        return fail(label, '"old_string" is empty. To create or overwrite a file use write_file.');
    if (oldString === newString)
        return fail(label, '"old_string" and "new_string" are identical, nothing to change.');
    let original;
    try {
        original = (await ctx.store.readText(ctx.userId, ctx.projectId, filePath, { maxBytes: 2_000_000 })).content;
    }
    catch (error) {
        return fail(label, error instanceof CodeError ? error.message : 'could not read the file');
    }
    const crlf = original.includes('\r\n');
    const needle = crlf && !oldString.includes('\r\n') ? oldString.replace(/\n/g, '\r\n') : oldString;
    const replacement = crlf && !newString.includes('\r\n') ? newString.replace(/\n/g, '\r\n') : newString;
    const positions = [];
    for (let from = original.indexOf(needle); from !== -1; from = original.indexOf(needle, from + needle.length)) {
        positions.push(from);
        if (positions.length > 200)
            break;
    }
    if (positions.length === 0) {
        return fail(label, `"old_string" was not found. It must match the file exactly, including whitespace and indentation, and must not ` +
            `contain line-number prefixes. Re-read the file with read_file.${findSimilarLines(original, oldString)}`);
    }
    const replaceAll = bool(args, 'replace_all');
    if (positions.length > 1 && !replaceAll) {
        const lines = positions.slice(0, 5).map((p) => lineNumberAt(original, p));
        return fail(label, `"old_string" occurs ${positions.length} times (lines ${lines.join(', ')}${positions.length > 5 ? ', ...' : ''}). ` +
            'Include more surrounding lines to make it unique, or set "replace_all": true.');
    }
    let updated;
    let firstLine = lineNumberAt(original, positions[0]);
    if (replaceAll) {
        updated = original.split(needle).join(replacement);
    }
    else {
        updated = original.slice(0, positions[0]) + replacement + original.slice(positions[0] + needle.length);
    }
    const newStartLine = firstLine;
    const newEndLine = newStartLine + replacement.split('\n').length - 1;
    try {
        await ctx.store.writeText(ctx.userId, ctx.projectId, filePath, updated, ctx.quota);
    }
    catch (error) {
        return fail(label, error instanceof CodeError ? error.message : 'could not write the file');
    }
    ctx.readPaths.add(filePath);
    const { additions, deletions } = countLineChanges(original, updated);
    const count = replaceAll ? positions.length : 1;
    firstLine = newStartLine;
    return {
        ok: true,
        output: `Edited ${filePath}: ${count} replacement(s), +${additions} -${deletions} lines. Result:\n` +
            clip(snippetAround(updated, newStartLine, newEndLine), 4_000),
        label,
        summary: `+${additions} −${deletions}`,
        change: { path: filePath, action: 'modify', additions, deletions, patch: makePatch(original, updated) },
    };
}
async function writeFileTool(args, ctx) {
    const rawPath = str(args, 'path');
    const content = str(args, 'content');
    if (!rawPath || content === undefined)
        return fail('write_file', '"path" and "content" are required');
    let filePath;
    try {
        filePath = normalizeProjectPath(rawPath);
    }
    catch (error) {
        return fail(`write_file ${rawPath}`, error.message);
    }
    const label = `write_file ${filePath}`;
    if (isSecretPath(filePath)) {
        return fail(label, 'Writing secret files (.env, keys) is blocked. Create ".env.example" with placeholder values instead.');
    }
    if (isGitInternalPath(filePath))
        return fail(label, 'The .git directory cannot be edited.');
    try {
        const { created, previous } = await ctx.store.writeText(ctx.userId, ctx.projectId, filePath, content, ctx.quota);
        ctx.readPaths.add(filePath);
        const { additions, deletions } = countLineChanges(previous ?? '', content);
        return {
            ok: true,
            output: `${created ? 'Created' : 'Overwrote'} ${filePath} (${content.split('\n').length} lines, ${formatBytes(Buffer.byteLength(content))}).`,
            label,
            summary: created ? `new, +${additions}` : `+${additions} −${deletions}`,
            change: {
                path: filePath,
                action: created ? 'create' : 'modify',
                additions,
                deletions,
                patch: makePatch(previous ?? '', content),
            },
        };
    }
    catch (error) {
        return fail(label, error instanceof CodeError ? error.message : 'could not write the file');
    }
}
async function moveFileTool(args, ctx) {
    const from = str(args, 'from');
    const to = str(args, 'to');
    if (!from || !to)
        return fail('move_file', '"from" and "to" are required');
    const label = `move_file ${from} → ${to}`;
    try {
        const source = normalizeProjectPath(from);
        const target = normalizeProjectPath(to);
        if (isSecretPath(source) || isSecretPath(target))
            return fail(label, 'Secret files cannot be moved by the assistant.');
        await ctx.store.moveFile(ctx.userId, ctx.projectId, source, target);
        return {
            ok: true,
            output: `Moved ${source} to ${target}.`,
            label,
            summary: 'moved',
            change: { path: target, from: source, action: 'move', additions: 0, deletions: 0 },
        };
    }
    catch (error) {
        return fail(label, error instanceof CodeError ? error.message : 'could not move the file');
    }
}
async function deleteFileTool(args, ctx) {
    const rawPath = str(args, 'path');
    if (!rawPath)
        return fail('delete_file', '"path" is required');
    const label = `delete_file ${rawPath}`;
    try {
        const filePath = normalizeProjectPath(rawPath);
        if (isSecretPath(filePath))
            return fail(label, 'Secret files cannot be deleted by the assistant.');
        const { removed, previous } = await ctx.store.deletePath(ctx.userId, ctx.projectId, filePath);
        const deletions = previous !== null ? countLineChanges(previous, '').deletions : 0;
        return {
            ok: true,
            output: removed.length > 1 ? `Deleted ${filePath} (${removed.length} files).` : `Deleted ${filePath}.`,
            label,
            summary: removed.length > 1 ? `${removed.length} files` : 'deleted',
            change: { path: filePath, action: 'delete', additions: 0, deletions },
        };
    }
    catch (error) {
        return fail(label, error instanceof CodeError ? error.message : 'could not delete the file');
    }
}
function updatePlan(args, ctx) {
    const raw = args.items;
    if (!Array.isArray(raw))
        return fail('update_plan', '"items" must be an array');
    const items = [];
    for (const entry of raw.slice(0, 20)) {
        if (!entry || typeof entry !== 'object')
            continue;
        const text = typeof entry.text === 'string' ? entry.text.trim() : '';
        const status = entry.status;
        if (!text)
            continue;
        items.push({
            text: text.slice(0, 200),
            status: status === 'done' || status === 'in_progress' ? status : 'pending',
        });
    }
    // Не больше одного пункта «в работе»: лишние возвращаются в очередь, порядок сохраняется.
    let seenInProgress = false;
    for (const item of items) {
        if (item.status !== 'in_progress')
            continue;
        if (seenInProgress)
            item.status = 'pending';
        seenInProgress = true;
    }
    ctx.plan = items;
    const done = items.filter((item) => item.status === 'done').length;
    const current = items.find((item) => item.status === 'in_progress');
    const next = items.find((item) => item.status === 'pending');
    const remaining = items.length - done;
    return {
        ok: true,
        output: `Plan updated: ${done}/${items.length} done.` +
            (current ? ` Now working on: "${current.text}".` : next ? ` Next: "${next.text}" (mark it in_progress when you start).` : '') +
            (remaining === 0 ? ' All items are done: verify the result and write the final message.' : ''),
        label: 'update_plan',
        summary: `${done}/${items.length}`,
        planUpdate: items,
    };
}
async function runCommand(args, ctx) {
    const limits = limitsOf(ctx);
    const command = str(args, 'command')?.trim();
    if (!command)
        return fail('run_command', '"command" is required');
    const label = `run_command ${command.length > 120 ? `${command.slice(0, 117)}...` : command}`;
    if (!ctx.sandbox) {
        return fail(label, 'Running commands is not available on this server. Work with files only and explain how to test.');
    }
    if (!ctx.commandsAllowed) {
        return fail(label, 'Running commands is not included in the current plan. Work with files only.');
    }
    const requested = int(args, 'timeout_seconds');
    const timeoutMs = Math.min(Math.max((requested ?? 60) * 1000, 1_000), ctx.commandTimeoutMs);
    const fs = await ctx.store.fsFor(ctx.userId, ctx.projectId);
    // Индекс должен быть загружен до команды, иначе изменения после неё не с чем сравнивать.
    await ctx.store.listFiles(ctx.userId, ctx.projectId);
    // Зависимости и кэши не входят в квоту, но место на диске ограничено.
    const diskCap = Math.max(ctx.quota.maxProjectBytes * 8, 64 * 1024 * 1024);
    if ((await fs.diskUsageBytes(diskCap)) > diskCap) {
        await fs.purgeIgnoredDirectories();
    }
    const result = await ctx.sandbox.run({
        cwd: fs.root,
        command,
        timeoutMs,
        maxOutputBytes: limits.maxCommandOutputBytes,
        network: ctx.allowNetwork,
        signal: ctx.signal,
    });
    const change = await ctx.store.refresh(ctx.userId, ctx.projectId, ctx.quota);
    const notes = [];
    if (change.overQuota) {
        // Команда раздула проект сверх квоты: созданные ею файлы удаляются, самые большие первыми.
        const files = await ctx.store.listFiles(ctx.userId, ctx.projectId);
        const bySize = files.filter((f) => change.created.includes(f.path)).sort((a, b) => b.size - a.size);
        let total = files.reduce((sum, f) => sum + f.size, 0);
        let count = files.length;
        const removed = [];
        for (const file of bySize) {
            if (total <= ctx.quota.maxProjectBytes && count <= ctx.quota.maxFiles)
                break;
            try {
                await ctx.store.deletePath(ctx.userId, ctx.projectId, file.path);
                total -= file.size;
                count -= 1;
                removed.push(file.path);
            }
            catch {
                // уже удалён
            }
        }
        notes.push(`The project exceeded the plan quota, so ${removed.length} file(s) created by this command were removed` +
            `${removed.length > 0 ? ` (${removed.slice(0, 5).join(', ')}${removed.length > 5 ? ', ...' : ''})` : ''}.`);
    }
    const fileLine = (label2, list) => list.length > 0 ? `${label2}: ${list.slice(0, 15).join(', ')}${list.length > 15 ? `, ... (+${list.length - 15})` : ''}` : null;
    const changed = [fileLine('created', change.created), fileLine('modified', change.modified), fileLine('deleted', change.deleted)].filter(Boolean);
    let status;
    if (result.cancelled)
        status = 'cancelled by the user';
    else if (result.timedOut)
        status = `timed out after ${Math.round(timeoutMs / 1000)}s and was killed`;
    else if (result.exitCode === null)
        status = `terminated by signal ${result.signal ?? 'unknown'}`;
    else
        status = `exit code ${result.exitCode}`;
    const output = [
        `$ ${command}`,
        `${status} (${(result.durationMs / 1000).toFixed(1)}s)`,
        result.output.trim() ? result.output.trimEnd() : '(no output)',
        changed.length > 0 ? `[files ${changed.join('; ')}]` : '',
        ...notes,
    ]
        .filter(Boolean)
        .join('\n');
    const ok = !result.timedOut && !result.cancelled && result.exitCode === 0;
    return {
        ok,
        output: clip(output, limits.maxOutputChars),
        label,
        summary: result.timedOut ? 'timeout' : result.cancelled ? 'cancelled' : `exit ${result.exitCode}`,
    };
}
// ─────────────────────────────────────────────────────────────
// Диспетчер
// ─────────────────────────────────────────────────────────────
export async function executeTool(name, rawArguments, ctx) {
    const args = parseArgs(rawArguments);
    if ('__error' in args)
        return fail(name, String(args.__error));
    try {
        switch (name) {
            case 'list_files':
                return await listFiles(args, ctx);
            case 'read_file':
                return await readFile(args, ctx);
            case 'search_files':
                return await searchFiles(args, ctx);
            case 'edit_file':
                return await editFile(args, ctx);
            case 'write_file':
                return await writeFileTool(args, ctx);
            case 'move_file':
                return await moveFileTool(args, ctx);
            case 'delete_file':
                return await deleteFileTool(args, ctx);
            case 'update_plan':
                return updatePlan(args, ctx);
            case 'run_command':
                return await runCommand(args, ctx);
            default:
                return fail(name, `Unknown tool "${name}". Available: list_files, read_file, search_files, edit_file, write_file, move_file, delete_file, update_plan${ctx.sandbox && ctx.commandsAllowed ? ', run_command' : ''}.`);
        }
    }
    catch (error) {
        console.error(`[code] инструмент ${name} завершился сбоем:`, error);
        return fail(name, 'internal tool error');
    }
}
/** Служебное: путь, который стоит скрыть из «дерева» подсказки модели (используется раннером). */
export function shouldHideFromTree(filePath) {
    return isIgnoredPath(filePath) || isSecretPath(filePath);
}
