/**
 * Файловая система одного проекта: реальные файлы в каталоге на диске сервера.
 *
 * Файлы лежат именно на диске, а не в базе, чтобы команды песочницы и git работали с ними
 * напрямую. Модуль отвечает за безопасность путей:
 *  - путь нормализуется (`normalizeProjectPath`), выйти из каталога проекта нельзя;
 *  - символические ссылки не читаются и не пишутся: их могла создать команда в песочнице
 *    (`ln -s /etc/passwd x`), а чтение по ссылке вывело бы за пределы проекта;
 *  - запись идёт через временный файл и rename, поэтому оборванная запись не оставляет полфайла.
 */
import { constants as fsConstants } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { lstat, mkdir, open, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CodeError, IGNORED_DIRECTORIES, isGitInternalPath, normalizeProjectPath } from './path-safety.js';
/** Файл считается двоичным, если в первых 8 КБ есть нулевой байт. */
export function looksBinaryBuffer(buffer) {
    const end = Math.min(buffer.length, 8000);
    for (let i = 0; i < end; i += 1) {
        if (buffer[i] === 0)
            return true;
    }
    return false;
}
export const DEFAULT_MAX_LIST_ENTRIES = 20_000;
export class ProjectFs {
    root;
    constructor(root) {
        this.root = path.resolve(root);
    }
    async ensureRoot() {
        await mkdir(this.root, { recursive: true });
    }
    /**
     * Абсолютный путь внутри проекта. Каждый существующий сегмент проверяется на символическую
     * ссылку; несуществующий хвост допустим только если `allowMissing`.
     */
    async resolve(relative, options = {}) {
        const normalized = normalizeProjectPath(relative);
        const segments = normalized.split('/');
        let current = this.root;
        for (let i = 0; i < segments.length; i += 1) {
            current = path.join(current, segments[i]);
            let info;
            try {
                info = await lstat(current);
            }
            catch (error) {
                if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
                    if (options.allowMissing)
                        return path.join(this.root, ...segments);
                    throw new CodeError('not_found', `Файл не найден: ${normalized}`);
                }
                throw error;
            }
            if (info.isSymbolicLink()) {
                throw new CodeError('forbidden_path', `Символические ссылки не поддерживаются: ${normalized}`);
            }
            if (i < segments.length - 1 && !info.isDirectory()) {
                throw new CodeError('invalid_path', `${segments.slice(0, i + 1).join('/')} — не каталог`);
            }
        }
        return current;
    }
    /** Рекурсивный обход без символических ссылок и служебных каталогов. */
    async list(options = {}) {
        const maxEntries = options.maxEntries ?? DEFAULT_MAX_LIST_ENTRIES;
        const result = [];
        const queue = [''];
        while (queue.length > 0 && result.length < maxEntries) {
            const relativeDir = queue.shift();
            const absoluteDir = relativeDir ? path.join(this.root, relativeDir) : this.root;
            let entries;
            try {
                entries = await readdir(absoluteDir, { withFileTypes: true });
            }
            catch (error) {
                if (error.code === 'ENOENT')
                    continue;
                throw error;
            }
            entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
            for (const entry of entries) {
                if (entry.isSymbolicLink())
                    continue;
                const relative = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
                if (entry.isDirectory()) {
                    if (!IGNORED_DIRECTORIES.has(entry.name))
                        queue.push(relative);
                    continue;
                }
                if (!entry.isFile())
                    continue;
                const info = await lstat(path.join(this.root, relative));
                result.push({ path: relative, size: info.size, mtimeMs: info.mtimeMs });
                if (result.length >= maxEntries)
                    break;
            }
        }
        return result.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    }
    async stat(relative) {
        let absolute;
        try {
            absolute = await this.resolve(relative);
        }
        catch (error) {
            if (error instanceof CodeError && error.code === 'not_found')
                return null;
            throw error;
        }
        const info = await lstat(absolute);
        if (!info.isFile())
            return null;
        return { path: normalizeProjectPath(relative), size: info.size, mtimeMs: info.mtimeMs };
    }
    /** Содержимое файла как есть. O_NOFOLLOW закрывает гонку между проверкой ссылки и открытием. */
    async readBuffer(relative, options = {}) {
        const absolute = await this.resolve(relative);
        const info = await lstat(absolute);
        if (info.isDirectory()) {
            throw new CodeError('invalid_path', `${normalizeProjectPath(relative)} — каталог, а не файл`);
        }
        if (options.maxBytes !== undefined && info.size > options.maxBytes) {
            throw new CodeError('file_too_large', `Файл ${normalizeProjectPath(relative)} занимает ${info.size} байт, лимит чтения ${options.maxBytes}`);
        }
        const handle = await open(absolute, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
        try {
            return await handle.readFile();
        }
        finally {
            await handle.close();
        }
    }
    /** Текстовое содержимое файла; двоичные файлы читать как текст нельзя. */
    async readText(relative, options = {}) {
        const buffer = await this.readBuffer(relative, options);
        if (looksBinaryBuffer(buffer)) {
            throw new CodeError('binary_file', `${normalizeProjectPath(relative)} — двоичный файл, прочитать как текст нельзя`);
        }
        return { content: buffer.toString('utf8'), size: buffer.length };
    }
    /** Запись файла (создание каталогов по пути). Возвращает данные записанного файла. */
    async write(relative, content) {
        const normalized = normalizeProjectPath(relative);
        if (isGitInternalPath(normalized)) {
            throw new CodeError('forbidden_path', 'Служебный каталог .git недоступен для записи');
        }
        const absolute = await this.resolve(normalized, { allowMissing: true });
        // Ссылку по существующему хвосту resolve уже отверг; каталоги создаём по проверенному пути.
        await mkdir(path.dirname(absolute), { recursive: true });
        // Путь мог оказаться каталогом: перезаписывать каталог файлом нельзя.
        try {
            const existing = await lstat(absolute);
            if (existing.isDirectory()) {
                throw new CodeError('invalid_path', `${normalized} — каталог, а не файл`);
            }
        }
        catch (error) {
            if (error.code !== 'ENOENT')
                throw error;
        }
        const temporary = `${absolute}.${randomBytes(6).toString('hex')}.ketner-tmp`;
        try {
            await writeFile(temporary, content);
            await rename(temporary, absolute);
        }
        catch (error) {
            await rm(temporary, { force: true });
            throw error;
        }
        const info = await stat(absolute);
        return { path: normalized, size: info.size, mtimeMs: info.mtimeMs };
    }
    /** Удаление файла или каталога (рекурсивно). Возвращает, существовало ли что-то. */
    async remove(relative) {
        const normalized = normalizeProjectPath(relative);
        if (isGitInternalPath(normalized)) {
            throw new CodeError('forbidden_path', 'Служебный каталог .git недоступен для удаления');
        }
        let absolute;
        try {
            absolute = await this.resolve(normalized);
        }
        catch (error) {
            if (error instanceof CodeError && error.code === 'not_found')
                return false;
            throw error;
        }
        await rm(absolute, { recursive: true, force: true });
        return true;
    }
    /** Переименование или перемещение файла. Существующий файл назначения не перезаписывается. */
    async move(from, to) {
        const source = normalizeProjectPath(from);
        const target = normalizeProjectPath(to);
        if (isGitInternalPath(source) || isGitInternalPath(target)) {
            throw new CodeError('forbidden_path', 'Служебный каталог .git недоступен');
        }
        if (source === target)
            return;
        const absoluteSource = await this.resolve(source);
        const absoluteTarget = await this.resolve(target, { allowMissing: true });
        try {
            await lstat(absoluteTarget);
            throw new CodeError('already_exists', `${target} уже существует`);
        }
        catch (error) {
            if (error instanceof CodeError)
                throw error;
            if (error.code !== 'ENOENT')
                throw error;
        }
        await mkdir(path.dirname(absoluteTarget), { recursive: true });
        await rename(absoluteSource, absoluteTarget);
    }
    /** Полный размер каталога на диске, включая зависимости и кэши, которые не входят в квоту. */
    async diskUsageBytes(limit = Number.POSITIVE_INFINITY) {
        let total = 0;
        const stack = [this.root];
        while (stack.length > 0) {
            const dir = stack.pop();
            let entries;
            try {
                entries = await readdir(dir, { withFileTypes: true });
            }
            catch {
                continue;
            }
            for (const entry of entries) {
                const full = path.join(dir, entry.name);
                if (entry.isSymbolicLink())
                    continue;
                if (entry.isDirectory()) {
                    stack.push(full);
                }
                else if (entry.isFile()) {
                    try {
                        total += (await lstat(full)).size;
                    }
                    catch {
                        // файл исчез во время обхода
                    }
                    if (total > limit)
                        return total;
                }
            }
        }
        return total;
    }
    /** Удаляет кэши и зависимости, не входящие в квоту (node_modules и др.). Возвращает число удалённых каталогов. */
    async purgeIgnoredDirectories() {
        let removed = 0;
        const stack = [this.root];
        while (stack.length > 0) {
            const dir = stack.pop();
            let entries;
            try {
                entries = await readdir(dir, { withFileTypes: true });
            }
            catch {
                continue;
            }
            for (const entry of entries) {
                if (entry.isSymbolicLink() || !entry.isDirectory())
                    continue;
                const full = path.join(dir, entry.name);
                if (IGNORED_DIRECTORIES.has(entry.name) && entry.name !== '.git') {
                    await rm(full, { recursive: true, force: true });
                    removed += 1;
                }
                else if (entry.name !== '.git') {
                    stack.push(full);
                }
            }
        }
        return removed;
    }
}
