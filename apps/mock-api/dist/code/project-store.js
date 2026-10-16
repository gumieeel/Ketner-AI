/**
 * Хранилище проектов «Ketner Code».
 *
 * Рабочая копия проекта — каталог на диске сервера (с ним работают инструменты агента и команды
 * песочницы). Долговечность обеспечивает необязательный драйвер БД (Postgres/Supabase): диск на
 * бесплатном Render эфемерный и сбрасывается при деплое, поэтому при наличии драйвера каждое
 * изменение дублируется в БД, а недостающий на диске проект поднимается из БД при первом обращении.
 *
 * Каталоги пользователей разделены по хэшу идентификатора: проект ищется по паре (пользователь,
 * проект), поэтому чужой проект недоступен даже при знании его id.
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CodeError, isIgnoredPath, normalizeProjectPath, } from './path-safety.js';
import { looksBinaryBuffer, ProjectFs } from './project-fs.js';
import { isTemplateId, templateFiles } from './templates.js';
import { MAX_THREAD_ITEMS, } from './types.js';
const PROJECT_ID_PATTERN = /^[a-zA-Z0-9-]{8,64}$/;
export function sanitizeProjectName(input) {
    const raw = typeof input === 'string' ? input : '';
    // eslint-disable-next-line no-control-regex
    const cleaned = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!cleaned)
        throw new CodeError('invalid_request', 'Название проекта не может быть пустым');
    return [...cleaned].slice(0, 80).join('');
}
export class ProjectStore {
    rootDir;
    driver;
    metas = new Map();
    indexes = new Map();
    locks = new Map();
    pendingDb = new Set();
    dbChains = new Map();
    constructor(options) {
        this.rootDir = path.resolve(options.rootDir);
        this.driver = options.driver ?? null;
    }
    setDriver(driver) {
        this.driver = driver;
    }
    // ───────────────────────── пути и служебное ─────────────────────────
    key(userId, projectId) {
        return `${userId}\u0000${projectId}`;
    }
    userDir(userId) {
        return path.join(this.rootDir, `u_${createHash('sha256').update(userId).digest('hex').slice(0, 32)}`);
    }
    projectDir(userId, projectId) {
        if (!PROJECT_ID_PATTERN.test(projectId)) {
            throw new CodeError('not_found', 'Проект не найден');
        }
        return path.join(this.userDir(userId), projectId);
    }
    filesDir(userId, projectId) {
        return path.join(this.projectDir(userId, projectId), 'files');
    }
    /** Выполняет операции над одним проектом строго по очереди. */
    async withLock(userId, projectId, run) {
        const key = this.key(userId, projectId);
        const previous = this.locks.get(key) ?? Promise.resolve();
        const next = previous.catch(() => undefined).then(run);
        this.locks.set(key, next);
        try {
            return await next;
        }
        finally {
            if (this.locks.get(key) === next)
                this.locks.delete(key);
        }
    }
    /** Фоновая запись в БД: порядок записей одного проекта сохраняется, сбой не ломает запрос. */
    scheduleDb(userId, projectId, task) {
        const driver = this.driver;
        if (!driver)
            return;
        const key = this.key(userId, projectId);
        const previous = this.dbChains.get(key) ?? Promise.resolve();
        const next = previous
            .then(() => task(driver))
            .catch((error) => {
            console.error('[code] не удалось сохранить проект в БД:', error);
        });
        this.dbChains.set(key, next);
        this.pendingDb.add(next);
        void next.finally(() => {
            this.pendingDb.delete(next);
            if (this.dbChains.get(key) === next)
                this.dbChains.delete(key);
        });
    }
    /** Ждёт завершения всех фоновых записей в БД (для тестов и остановки сервера). */
    async flush() {
        while (this.pendingDb.size > 0) {
            await Promise.all([...this.pendingDb]);
        }
    }
    // ───────────────────────── метаданные ─────────────────────────
    async readMetaFromDisk(userId, projectId) {
        try {
            const raw = await readFile(path.join(this.projectDir(userId, projectId), 'meta.json'), 'utf8');
            const parsed = JSON.parse(raw);
            if (parsed && parsed.id === projectId && parsed.userId === userId)
                return parsed;
        }
        catch (error) {
            if (error instanceof CodeError)
                return null;
            if (error.code !== 'ENOENT') {
                console.warn('[code] meta.json не прочитан:', error);
            }
        }
        return null;
    }
    async writeMeta(meta) {
        const dir = this.projectDir(meta.userId, meta.id);
        await mkdir(dir, { recursive: true });
        const target = path.join(dir, 'meta.json');
        const temporary = `${target}.tmp`;
        await writeFile(temporary, JSON.stringify(meta, null, 2), 'utf8');
        await rename(temporary, target);
        this.metas.set(this.key(meta.userId, meta.id), meta);
    }
    /** Метаданные проекта; недостающий на диске проект поднимается из БД. */
    async get(userId, projectId) {
        if (!PROJECT_ID_PATTERN.test(projectId))
            return null;
        const cached = this.metas.get(this.key(userId, projectId));
        if (cached)
            return cached;
        const onDisk = await this.readMetaFromDisk(userId, projectId);
        if (onDisk) {
            this.metas.set(this.key(userId, projectId), onDisk);
            return onDisk;
        }
        return this.hydrateFromDriver(userId, projectId);
    }
    async hydrateFromDriver(userId, projectId) {
        if (!this.driver)
            return null;
        let loaded;
        try {
            loaded = await this.driver.loadProject(userId, projectId);
        }
        catch (error) {
            console.error('[code] не удалось загрузить проект из БД:', error);
            return null;
        }
        if (!loaded)
            return null;
        return this.withLock(userId, projectId, async () => {
            const fs = new ProjectFs(this.filesDir(userId, projectId));
            await fs.ensureRoot();
            for (const file of loaded.files) {
                try {
                    await fs.write(file.path, file.content);
                }
                catch (error) {
                    console.warn(`[code] файл ${file.path} не восстановлен из БД:`, error);
                }
            }
            await this.writeThread(userId, projectId, loaded.thread);
            await this.writeMeta(loaded.meta);
            return loaded.meta;
        });
    }
    async list(userId) {
        const byId = new Map();
        const dir = this.userDir(userId);
        let names = [];
        try {
            names = await readdir(dir);
        }
        catch {
            names = [];
        }
        for (const name of names) {
            if (!PROJECT_ID_PATTERN.test(name))
                continue;
            const meta = (await this.readMetaFromDisk(userId, name)) ?? null;
            if (meta)
                byId.set(meta.id, this.metas.get(this.key(userId, meta.id)) ?? meta);
        }
        if (this.driver) {
            try {
                for (const meta of await this.driver.listProjects(userId)) {
                    const local = byId.get(meta.id);
                    if (!local || local.updatedAt < meta.updatedAt)
                        byId.set(meta.id, local ?? meta);
                }
            }
            catch (error) {
                console.error('[code] не удалось получить список проектов из БД:', error);
            }
        }
        return [...byId.values()].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
    }
    async count(userId) {
        return (await this.list(userId)).length;
    }
    async create(userId, input, limits) {
        const name = sanitizeProjectName(input.name);
        if ((await this.count(userId)) >= limits.maxProjects) {
            throw new CodeError('quota_exceeded', 'На вашем тарифе больше проектов создать нельзя. Удалите ненужный проект или повысьте тариф.');
        }
        const template = isTemplateId(input.template) ? input.template : 'empty';
        const description = typeof input.description === 'string' && input.description.trim()
            ? input.description.trim().slice(0, 300)
            : undefined;
        const id = randomUUID();
        const now = new Date().toISOString();
        const source = input.source ?? (template === 'empty' ? { type: 'empty' } : { type: 'template', ref: template });
        const meta = {
            id,
            userId,
            name,
            ...(description ? { description } : {}),
            source,
            fileCount: 0,
            totalBytes: 0,
            createdAt: now,
            updatedAt: now,
        };
        await this.withLock(userId, id, async () => {
            const fs = new ProjectFs(this.filesDir(userId, id));
            await fs.ensureRoot();
            await this.writeMeta(meta);
        });
        // Для импорта шаблон не нужен: файлы приходят от клиента.
        if (source.type === 'empty' || source.type === 'template') {
            const files = Object.entries(templateFiles(template, name)).map(([filePath, content]) => ({ path: filePath, content }));
            await this.importFiles(userId, id, files, limits.quota);
        }
        this.scheduleDb(userId, id, async (driver) => {
            const current = await this.get(userId, id);
            if (current)
                await driver.saveProject(current);
        });
        return (await this.get(userId, id)) ?? meta;
    }
    async update(userId, projectId, patch) {
        const meta = await this.requireMeta(userId, projectId);
        return this.withLock(userId, projectId, async () => {
            const next = { ...meta, updatedAt: new Date().toISOString() };
            if (patch.name !== undefined)
                next.name = sanitizeProjectName(patch.name);
            if (patch.description !== undefined) {
                const text = typeof patch.description === 'string' ? patch.description.trim().slice(0, 300) : '';
                if (text)
                    next.description = text;
                else
                    delete next.description;
            }
            await this.writeMeta(next);
            this.scheduleDb(userId, projectId, (driver) => driver.saveProject(next));
            return next;
        });
    }
    async remove(userId, projectId) {
        const meta = await this.get(userId, projectId);
        if (!meta)
            return false;
        await this.withLock(userId, projectId, async () => {
            await rm(this.projectDir(userId, projectId), { recursive: true, force: true });
            this.metas.delete(this.key(userId, projectId));
            this.indexes.delete(this.key(userId, projectId));
        });
        this.scheduleDb(userId, projectId, (driver) => driver.deleteProject(userId, projectId));
        return true;
    }
    async requireMeta(userId, projectId) {
        const meta = await this.get(userId, projectId);
        if (!meta)
            throw new CodeError('not_found', 'Проект не найден');
        return meta;
    }
    // ───────────────────────── файлы ─────────────────────────
    /** Файловая система проекта для инструментов и песочницы. */
    async fsFor(userId, projectId) {
        await this.requireMeta(userId, projectId);
        const fs = new ProjectFs(this.filesDir(userId, projectId));
        await fs.ensureRoot();
        return fs;
    }
    async loadIndex(userId, projectId, force = false) {
        const key = this.key(userId, projectId);
        const cached = this.indexes.get(key);
        if (cached && !force)
            return cached;
        const fs = await this.fsFor(userId, projectId);
        const entries = await fs.list();
        const index = {
            files: new Map(entries.map((entry) => [entry.path, entry])),
            totalBytes: entries.reduce((sum, entry) => sum + entry.size, 0),
        };
        this.indexes.set(key, index);
        return index;
    }
    async listFiles(userId, projectId) {
        const index = await this.loadIndex(userId, projectId);
        return [...index.files.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    }
    async readText(userId, projectId, filePath, options = {}) {
        const fs = await this.fsFor(userId, projectId);
        return fs.readText(filePath, options);
    }
    async touchMeta(userId, projectId, index) {
        const meta = await this.requireMeta(userId, projectId);
        const next = {
            ...meta,
            fileCount: index.files.size,
            totalBytes: index.totalBytes,
            updatedAt: new Date().toISOString(),
        };
        await this.writeMeta(next);
        this.scheduleDb(userId, projectId, (driver) => driver.saveProject(next));
        return next;
    }
    checkQuota(index, filePath, newSize, quota) {
        if (newSize > quota.maxFileBytes) {
            throw new CodeError('file_too_large', `Файл ${filePath} (${newSize} байт) больше лимита ${quota.maxFileBytes} байт на файл вашего тарифа`);
        }
        const existing = index.files.get(filePath);
        if (!existing && index.files.size + 1 > quota.maxFiles) {
            throw new CodeError('quota_exceeded', `Достигнут лимит файлов проекта (${quota.maxFiles})`);
        }
        const bytesAfter = index.totalBytes - (existing?.size ?? 0) + newSize;
        if (bytesAfter > quota.maxProjectBytes) {
            throw new CodeError('quota_exceeded', `Проект не должен превышать ${Math.round(quota.maxProjectBytes / 1024)} КБ (лимит тарифа)`);
        }
    }
    /** Записывает один текстовый файл с проверкой квот. */
    async writeText(userId, projectId, filePath, content, quota) {
        const normalized = normalizeProjectPath(filePath);
        if (typeof content !== 'string')
            throw new CodeError('invalid_request', 'content должен быть строкой');
        await this.requireMeta(userId, projectId);
        return this.withLock(userId, projectId, async () => {
            const index = await this.loadIndex(userId, projectId);
            const size = Buffer.byteLength(content, 'utf8');
            if (!isIgnoredPath(normalized))
                this.checkQuota(index, normalized, size, quota);
            const fs = await this.fsFor(userId, projectId);
            let previous = null;
            if (index.files.has(normalized)) {
                try {
                    previous = (await fs.readText(normalized)).content;
                }
                catch {
                    previous = null;
                }
            }
            const entry = await fs.write(normalized, content);
            const created = !index.files.has(normalized);
            if (!isIgnoredPath(normalized)) {
                index.totalBytes += entry.size - (index.files.get(normalized)?.size ?? 0);
                index.files.set(normalized, entry);
                await this.touchMeta(userId, projectId, index);
                this.scheduleDb(userId, projectId, (driver) => driver.saveFile(userId, projectId, { path: normalized, content, size: entry.size }));
            }
            return { entry, created, previous };
        });
    }
    /** Массовая запись (импорт, шаблон). Файлы, не прошедшие проверку, возвращаются с причиной. */
    async importFiles(userId, projectId, files, quota) {
        await this.requireMeta(userId, projectId);
        return this.withLock(userId, projectId, async () => {
            const index = await this.loadIndex(userId, projectId);
            const fs = await this.fsFor(userId, projectId);
            const skipped = [];
            const toSync = [];
            let written = 0;
            for (const file of files) {
                let normalized;
                try {
                    normalized = normalizeProjectPath(file.path);
                }
                catch (error) {
                    skipped.push({ path: String(file.path), reason: error.message });
                    continue;
                }
                if (typeof file.content !== 'string') {
                    skipped.push({ path: normalized, reason: 'content должен быть строкой' });
                    continue;
                }
                if (isIgnoredPath(normalized)) {
                    skipped.push({ path: normalized, reason: 'служебный каталог (зависимости, кэш) не импортируется' });
                    continue;
                }
                if (normalized === '.git' || normalized.startsWith('.git/')) {
                    skipped.push({ path: normalized, reason: 'служебный каталог .git' });
                    continue;
                }
                const size = Buffer.byteLength(file.content, 'utf8');
                try {
                    this.checkQuota(index, normalized, size, quota);
                    const entry = await fs.write(normalized, file.content);
                    index.totalBytes += entry.size - (index.files.get(normalized)?.size ?? 0);
                    index.files.set(normalized, entry);
                    toSync.push({ path: normalized, content: file.content, size: entry.size });
                    written += 1;
                }
                catch (error) {
                    skipped.push({ path: normalized, reason: error instanceof CodeError ? error.message : 'ошибка записи' });
                }
            }
            if (written > 0) {
                await this.touchMeta(userId, projectId, index);
                for (const file of toSync) {
                    this.scheduleDb(userId, projectId, (driver) => driver.saveFile(userId, projectId, file));
                }
            }
            return { written, skipped };
        });
    }
    /** Удаляет файл или каталог. Возвращает удалённые пути (для обновления индекса клиента). */
    async deletePath(userId, projectId, targetPath) {
        const normalized = normalizeProjectPath(targetPath);
        await this.requireMeta(userId, projectId);
        return this.withLock(userId, projectId, async () => {
            const index = await this.loadIndex(userId, projectId);
            const fs = await this.fsFor(userId, projectId);
            let previous = null;
            if (index.files.has(normalized)) {
                try {
                    previous = (await fs.readText(normalized)).content;
                }
                catch {
                    previous = null;
                }
            }
            const existed = await fs.remove(normalized);
            if (!existed)
                throw new CodeError('not_found', `Файл не найден: ${normalized}`);
            const removed = [];
            for (const known of [...index.files.keys()]) {
                if (known === normalized || known.startsWith(`${normalized}/`)) {
                    index.totalBytes -= index.files.get(known)?.size ?? 0;
                    index.files.delete(known);
                    removed.push(known);
                }
            }
            await this.touchMeta(userId, projectId, index);
            for (const gone of removed) {
                this.scheduleDb(userId, projectId, (driver) => driver.deleteFile(userId, projectId, gone));
            }
            return { removed, previous };
        });
    }
    async moveFile(userId, projectId, from, to) {
        const source = normalizeProjectPath(from);
        const target = normalizeProjectPath(to);
        await this.requireMeta(userId, projectId);
        await this.withLock(userId, projectId, async () => {
            const fs = await this.fsFor(userId, projectId);
            await fs.move(source, target);
            const index = await this.loadIndex(userId, projectId, true);
            await this.touchMeta(userId, projectId, index);
            this.scheduleDb(userId, projectId, async (driver) => {
                await driver.deleteFile(userId, projectId, source);
                const moved = index.files.get(target);
                if (moved) {
                    const { content } = await fs.readText(target);
                    await driver.saveFile(userId, projectId, { path: target, content, size: moved.size });
                }
            });
        });
    }
    /**
     * Пересчитывает состав проекта после команд песочницы (они меняют файлы напрямую) и дублирует
     * изменённые файлы в БД. Возвращает изменения относительно предыдущего индекса.
     */
    async refresh(userId, projectId, quota) {
        await this.requireMeta(userId, projectId);
        return this.withLock(userId, projectId, async () => {
            const before = this.indexes.get(this.key(userId, projectId));
            const index = await this.loadIndex(userId, projectId, true);
            const created = [];
            const modified = [];
            const deleted = [];
            if (before) {
                for (const [filePath, entry] of index.files) {
                    const old = before.files.get(filePath);
                    if (!old)
                        created.push(filePath);
                    else if (old.size !== entry.size || old.mtimeMs !== entry.mtimeMs)
                        modified.push(filePath);
                }
                for (const filePath of before.files.keys()) {
                    if (!index.files.has(filePath))
                        deleted.push(filePath);
                }
            }
            const meta = await this.touchMeta(userId, projectId, index);
            const fs = await this.fsFor(userId, projectId);
            for (const filePath of [...created, ...modified]) {
                const entry = index.files.get(filePath);
                if (!entry)
                    continue;
                try {
                    const buffer = await fs.readBuffer(filePath, { maxBytes: 2_000_000 });
                    if (looksBinaryBuffer(buffer))
                        continue;
                    const content = buffer.toString('utf8');
                    this.scheduleDb(userId, projectId, (driver) => driver.saveFile(userId, projectId, { path: filePath, content, size: entry.size }));
                }
                catch {
                    // слишком большой или исчезнувший файл в БД не дублируется
                }
            }
            for (const filePath of deleted) {
                this.scheduleDb(userId, projectId, (driver) => driver.deleteFile(userId, projectId, filePath));
            }
            const overQuota = Boolean(quota && (index.files.size > quota.maxFiles || index.totalBytes > quota.maxProjectBytes));
            return { created, modified, deleted, meta, overQuota };
        });
    }
    // ───────────────────────── лента агента ─────────────────────────
    threadPath(userId, projectId) {
        return path.join(this.projectDir(userId, projectId), 'thread.json');
    }
    async writeThread(userId, projectId, thread) {
        const target = this.threadPath(userId, projectId);
        await mkdir(path.dirname(target), { recursive: true });
        const temporary = `${target}.tmp`;
        await writeFile(temporary, JSON.stringify(thread), 'utf8');
        await rename(temporary, target);
    }
    async getThread(userId, projectId) {
        await this.requireMeta(userId, projectId);
        try {
            const parsed = JSON.parse(await readFile(this.threadPath(userId, projectId), 'utf8'));
            return Array.isArray(parsed) ? parsed : [];
        }
        catch {
            return [];
        }
    }
    async appendThread(userId, projectId, items) {
        if (items.length === 0)
            return;
        await this.requireMeta(userId, projectId);
        await this.withLock(userId, projectId, async () => {
            const current = await this.getThread(userId, projectId);
            const next = [...current, ...items].slice(-MAX_THREAD_ITEMS);
            await this.writeThread(userId, projectId, next);
            this.scheduleDb(userId, projectId, (driver) => driver.saveThread(userId, projectId, next));
        });
    }
    async clearThread(userId, projectId) {
        await this.requireMeta(userId, projectId);
        await this.withLock(userId, projectId, async () => {
            await this.writeThread(userId, projectId, []);
            this.scheduleDb(userId, projectId, (driver) => driver.saveThread(userId, projectId, []));
        });
    }
}
