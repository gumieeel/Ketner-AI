import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CodeError, normalizeProjectPath } from './path-safety.js';
import { ProjectStore, type ProjectDbDriver } from './project-store.js';
import type { ProjectMeta, ThreadItem } from './types.js';

const QUOTA = { maxFiles: 20, maxFileBytes: 2_000, maxProjectBytes: 10_000 };
const LIMITS = { maxProjects: 3, quota: QUOTA };

async function withStore<T>(run: (store: ProjectStore, dir: string) => Promise<T>, driver?: ProjectDbDriver): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), 'ketner-code-'));
  try {
    return await run(new ProjectStore({ rootDir: dir, driver }), dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function codeError(promise: Promise<unknown>): Promise<CodeError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof CodeError, `ожидалась CodeError, получено: ${String(error)}`);
    return error;
  }
  assert.fail('ожидалась ошибка');
}

test('normalizeProjectPath: нормализует и отклоняет опасные пути', () => {
  assert.equal(normalizeProjectPath('./src\\a.ts'), 'src/a.ts');
  assert.equal(normalizeProjectPath('a//b/./c.txt'), 'a/b/c.txt');
  for (const bad of ['', '   ', '/etc/passwd', 'C:\\Windows', '../x', 'a/../../x', '~/x', 'a\u0000b', '.']) {
    assert.throws(() => normalizeProjectPath(bad), CodeError, `путь «${bad}» должен быть отклонён`);
  }
  assert.throws(() => normalizeProjectPath(42 as unknown as string), CodeError);
  assert.throws(() => normalizeProjectPath('a'.repeat(400)), CodeError);
});

test('создание из шаблона кладёт файлы на диск и считает метаданные', () =>
  withStore(async (store) => {
    const meta = await store.create('u1', { name: 'Demo', template: 'node' }, LIMITS);
    assert.equal(meta.name, 'Demo');
    assert.equal(meta.source.type, 'template');
    assert.ok(meta.fileCount >= 4);
    const files = await store.listFiles('u1', meta.id);
    assert.ok(files.some((f) => f.path === 'package.json'));
    const pkg = await store.readText('u1', meta.id, 'package.json');
    assert.match(pkg.content, /"type": "module"/);
    assert.equal(
      (await store.get('u1', meta.id))?.totalBytes,
      files.reduce((sum, f) => sum + f.size, 0),
    );
  }));

test('проект виден только владельцу', () =>
  withStore(async (store) => {
    const meta = await store.create('u1', { name: 'Private' }, LIMITS);
    assert.equal(await store.get('u2', meta.id), null);
    assert.equal((await store.list('u2')).length, 0);
    assert.equal((await codeError(store.readText('u2', meta.id, 'README.md'))).code, 'not_found');
    assert.equal((await codeError(store.writeText('u2', meta.id, 'x.txt', 'x', QUOTA))).code, 'not_found');
    assert.equal((await store.list('u1')).length, 1);
  }));

test('лимит числа проектов и пустое имя', () =>
  withStore(async (store) => {
    for (let i = 0; i < 3; i += 1) await store.create('u1', { name: `P${i}` }, LIMITS);
    assert.equal((await codeError(store.create('u1', { name: 'P4' }, LIMITS))).code, 'quota_exceeded');
    assert.equal((await codeError(store.create('u2', { name: '   ' }, LIMITS))).code, 'invalid_request');
  }));

test('запись: пути за пределами проекта и .git запрещены', () =>
  withStore(async (store, root) => {
    const meta = await store.create('u1', { name: 'P' }, LIMITS);
    for (const bad of ['../escape.txt', '/abs.txt', 'a/../../b.txt']) {
      assert.equal((await codeError(store.writeText('u1', meta.id, bad, 'x', QUOTA))).code, 'invalid_path');
    }
    assert.equal((await codeError(store.writeText('u1', meta.id, '.git/hooks/pre-commit', 'x', QUOTA))).code, 'forbidden_path');
    // ничего не появилось рядом с проектом
    const { readdir } = await import('node:fs/promises');
    assert.deepEqual((await readdir(root)).filter((n) => n.includes('escape')), []);
  }));

test('символическая ссылка внутри проекта не даёт читать и писать за его пределами', () =>
  withStore(async (store, root) => {
    const meta = await store.create('u1', { name: 'P' }, LIMITS);
    const secretFile = path.join(root, 'outside-secret.txt');
    await writeFile(secretFile, 'TOP SECRET');
    const fs = await store.fsFor('u1', meta.id);
    await symlink(secretFile, path.join(fs.root, 'link.txt'));
    await mkdir(path.join(root, 'outside-dir'));
    await symlink(path.join(root, 'outside-dir'), path.join(fs.root, 'dirlink'));

    assert.equal((await codeError(store.readText('u1', meta.id, 'link.txt'))).code, 'forbidden_path');
    assert.equal((await codeError(store.writeText('u1', meta.id, 'link.txt', 'pwn', QUOTA))).code, 'forbidden_path');
    assert.equal((await codeError(store.writeText('u1', meta.id, 'dirlink/new.txt', 'pwn', QUOTA))).code, 'forbidden_path');
    assert.equal((await codeError(store.deletePath('u1', meta.id, 'link.txt'))).code, 'forbidden_path');

    const { readFile, stat } = await import('node:fs/promises');
    assert.equal(await readFile(secretFile, 'utf8'), 'TOP SECRET');
    await assert.rejects(stat(path.join(root, 'outside-dir', 'new.txt')));
    // и в списке файлов ссылок нет
    assert.ok(!(await fs.list()).some((e) => e.path === 'link.txt' || e.path.startsWith('dirlink')));
  }));

test('квоты: размер файла, число файлов, размер проекта', () =>
  withStore(async (store) => {
    const meta = await store.create('u1', { name: 'P' }, { maxProjects: 3, quota: { ...QUOTA, maxFiles: 3, maxProjectBytes: 3_000 } });
    const quota = { maxFiles: 3, maxFileBytes: 1_500, maxProjectBytes: 3_000 };
    assert.equal((await codeError(store.writeText('u1', meta.id, 'big.txt', 'x'.repeat(1_600), quota))).code, 'file_too_large');
    await store.writeText('u1', meta.id, 'a.txt', 'a'.repeat(1_400), quota);
    await store.writeText('u1', meta.id, 'b.txt', 'b'.repeat(1_400), quota);
    // README + a + b = 3 файла, ещё один нельзя
    assert.equal((await codeError(store.writeText('u1', meta.id, 'c.txt', 'c', quota))).code, 'quota_exceeded');
    // перезапись существующего допустима, если проект остаётся в пределах
    await store.writeText('u1', meta.id, 'a.txt', 'short', quota);
    const files = await store.listFiles('u1', meta.id);
    assert.equal(files.length, 3);
    // суммарный размер: a=5, b=1400, README~30; увеличить b до 1500 нельзя только если сумма > 3000 — здесь можно
    await store.writeText('u1', meta.id, 'b.txt', 'b'.repeat(1_500), quota);
    assert.equal((await codeError(store.writeText('u1', meta.id, 'a.txt', 'a'.repeat(1_500), { ...quota, maxProjectBytes: 1_550 }))).code, 'quota_exceeded');
  }));

test('importFiles пропускает опасное и служебное, остальное пишет', () =>
  withStore(async (store) => {
    const meta = await store.create('u1', { name: 'P' }, LIMITS);
    const result = await store.importFiles(
      'u1',
      meta.id,
      [
        { path: 'src/a.ts', content: 'export const a = 1;\n' },
        { path: '../evil.ts', content: 'x' },
        { path: 'node_modules/pkg/index.js', content: 'x' },
        { path: '.git/config', content: 'x' },
        { path: 'big.txt', content: 'x'.repeat(5_000) },
      ],
      QUOTA,
    );
    assert.equal(result.written, 1);
    assert.equal(result.skipped.length, 4);
    assert.ok(result.skipped.some((s) => s.path === '../evil.ts'));
    assert.ok((await store.listFiles('u1', meta.id)).some((f) => f.path === 'src/a.ts'));
  }));

test('deletePath удаляет каталог целиком и обновляет счётчики', () =>
  withStore(async (store) => {
    const meta = await store.create('u1', { name: 'P' }, LIMITS);
    await store.writeText('u1', meta.id, 'dir/a.txt', 'a', QUOTA);
    await store.writeText('u1', meta.id, 'dir/sub/b.txt', 'b', QUOTA);
    const before = (await store.get('u1', meta.id))!;
    const result = await store.deletePath('u1', meta.id, 'dir');
    assert.deepEqual(result.removed.sort(), ['dir/a.txt', 'dir/sub/b.txt']);
    const after = (await store.get('u1', meta.id))!;
    assert.equal(after.fileCount, before.fileCount - 2);
    assert.equal((await codeError(store.deletePath('u1', meta.id, 'dir'))).code, 'not_found');
  }));

test('moveFile переименовывает и не затирает существующий файл', () =>
  withStore(async (store) => {
    const meta = await store.create('u1', { name: 'P' }, LIMITS);
    await store.writeText('u1', meta.id, 'a.txt', 'A', QUOTA);
    await store.writeText('u1', meta.id, 'b.txt', 'B', QUOTA);
    assert.equal((await codeError(store.moveFile('u1', meta.id, 'a.txt', 'b.txt'))).code, 'already_exists');
    await store.moveFile('u1', meta.id, 'a.txt', 'src/c.txt');
    assert.equal((await store.readText('u1', meta.id, 'src/c.txt')).content, 'A');
    assert.equal((await codeError(store.readText('u1', meta.id, 'a.txt'))).code, 'not_found');
  }));

test('refresh находит файлы, изменённые командами напрямую на диске', () =>
  withStore(async (store) => {
    const meta = await store.create('u1', { name: 'P' }, LIMITS);
    await store.writeText('u1', meta.id, 'keep.txt', 'k', QUOTA);
    await store.writeText('u1', meta.id, 'gone.txt', 'g', QUOTA);
    await store.listFiles('u1', meta.id);
    const fs = await store.fsFor('u1', meta.id);
    await fs.write('new.txt', 'created by command');
    await fs.write('keep.txt', 'changed by command!!');
    await fs.remove('gone.txt');
    await mkdir(path.join(fs.root, 'node_modules', 'x'), { recursive: true });
    await writeFile(path.join(fs.root, 'node_modules', 'x', 'i.js'), 'ignored');
    const change = await store.refresh('u1', meta.id, QUOTA);
    assert.deepEqual(change.created, ['new.txt']);
    assert.deepEqual(change.modified, ['keep.txt']);
    assert.deepEqual(change.deleted, ['gone.txt']);
    assert.equal(change.overQuota, false);
    assert.ok(!(await store.listFiles('u1', meta.id)).some((f) => f.path.startsWith('node_modules')));
  }));

test('лента: добавление, ограничение длины, очистка', () =>
  withStore(async (store) => {
    const meta = await store.create('u1', { name: 'P' }, LIMITS);
    const item = (n: number): ThreadItem => ({ id: String(n), kind: 'user', text: `m${n}`, createdAt: new Date().toISOString() });
    await store.appendThread('u1', meta.id, [item(1), item(2)]);
    assert.equal((await store.getThread('u1', meta.id)).length, 2);
    await store.appendThread('u1', meta.id, Array.from({ length: 700 }, (_, i) => item(i + 10)));
    const thread = await store.getThread('u1', meta.id);
    assert.equal(thread.length, 600);
    assert.equal((thread[thread.length - 1] as { text: string }).text, 'm709');
    await store.clearThread('u1', meta.id);
    assert.equal((await store.getThread('u1', meta.id)).length, 0);
  }));

/** Простой драйвер в памяти: проверяет, что хранилище дублирует данные и умеет поднимать проект. */
function memoryDriver() {
  const projects = new Map<string, ProjectMeta>();
  const threads = new Map<string, ThreadItem[]>();
  const files = new Map<string, Map<string, string>>();
  const driver: ProjectDbDriver = {
    async listProjects(userId) {
      return [...projects.values()].filter((p) => p.userId === userId);
    },
    async loadProject(userId, projectId) {
      const meta = projects.get(projectId);
      if (!meta || meta.userId !== userId) return null;
      return {
        meta,
        thread: threads.get(projectId) ?? [],
        files: [...(files.get(projectId) ?? new Map()).entries()].map(([p, content]) => ({ path: p, content })),
      };
    },
    async saveProject(meta) {
      projects.set(meta.id, meta);
    },
    async saveThread(_u, projectId, thread) {
      threads.set(projectId, thread);
    },
    async deleteProject(_u, projectId) {
      projects.delete(projectId);
      files.delete(projectId);
    },
    async saveFile(_u, projectId, file) {
      if (!files.has(projectId)) files.set(projectId, new Map());
      files.get(projectId)!.set(file.path, file.content);
    },
    async deleteFile(_u, projectId, filePath) {
      files.get(projectId)?.delete(filePath);
    },
  };
  return { driver, projects, files, threads };
}

test('драйвер БД: изменения дублируются, а проект переживает потерю диска', async () => {
  const db = memoryDriver();
  let projectId = '';
  await withStore(async (store) => {
    const meta = await store.create('u1', { name: 'Durable', template: 'python' }, LIMITS);
    projectId = meta.id;
    await store.writeText('u1', meta.id, 'notes/todo.md', '- сделать\n', QUOTA);
    await store.appendThread('u1', meta.id, [{ id: 't', kind: 'user', text: 'привет', createdAt: new Date().toISOString() }]);
    await store.deletePath('u1', meta.id, 'test_main.py');
    await store.flush();
    assert.equal(db.projects.get(meta.id)?.name, 'Durable');
    assert.equal(db.files.get(meta.id)?.get('notes/todo.md'), '- сделать\n');
    assert.ok(!db.files.get(meta.id)?.has('test_main.py'));
    assert.equal(db.threads.get(meta.id)?.length, 1);
  }, db.driver);

  // «Новый деплой»: пустой диск, тот же драйвер.
  await withStore(async (fresh) => {
    const list = await fresh.list('u1');
    assert.equal(list.length, 1, 'проект виден в списке из БД');
    const restored = await fresh.get('u1', projectId);
    assert.equal(restored?.name, 'Durable');
    assert.equal((await fresh.readText('u1', projectId, 'notes/todo.md')).content, '- сделать\n');
    assert.ok((await fresh.listFiles('u1', projectId)).some((f) => f.path === 'main.py'));
    assert.equal((await fresh.getThread('u1', projectId)).length, 1);
    assert.equal(await fresh.get('u2', projectId), null, 'чужой пользователь не получает проект из БД');
  }, db.driver);
});
