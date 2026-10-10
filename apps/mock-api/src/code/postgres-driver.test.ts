import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createPostgresProjectDriver, ensureCodeSchema, type SqlRunner } from './postgres-driver.js';
import { ProjectStore } from './project-store.js';

/**
 * Настоящий SQL проверяется на PGlite (PostgreSQL в WebAssembly). Пакет не входит в зависимости
 * проекта: тест пропускается, если его нет. Локально: PGLITE_MODULE=/путь/к/@electric-sql/pglite
 */
async function openPglite(): Promise<{ runner: SqlRunner; close: () => Promise<void> } | null> {
  try {
    const specifier = process.env.PGLITE_MODULE ?? '@electric-sql/pglite';
    const mod = (await import(specifier)) as { PGlite: new () => { query: (t: string, p?: unknown[]) => Promise<{ rows: unknown[] }>; close: () => Promise<void> } };
    const db = new mod.PGlite();
    return {
      runner: { query: async <T,>(text: string, params?: unknown[]) => (await db.query(text, params)).rows as T[] },
      close: () => db.close(),
    };
  } catch {
    return null;
  }
}

const QUOTA = { maxFiles: 100, maxFileBytes: 100_000, maxProjectBytes: 1_000_000 };
const LIMITS = { maxProjects: 5, quota: QUOTA };

test('PostgreSQL: проект целиком переживает потерю диска и изолирован по владельцу', async (t) => {
  const pg = await openPglite();
  if (!pg) {
    t.skip('PGlite не установлен');
    return;
  }
  const dir = await mkdtemp(path.join(tmpdir(), 'ketner-pg-'));
  try {
    await ensureCodeSchema(pg.runner);
    await ensureCodeSchema(pg.runner); // повторный вызов безопасен

    const driver = createPostgresProjectDriver(pg.runner);
    const first = new ProjectStore({ rootDir: path.join(dir, 'a'), driver });
    const meta = await first.create('alice', { name: 'Проект', template: 'node' }, LIMITS);
    await first.writeText('alice', meta.id, 'src/with-nul.txt', 'a\u0000b', QUOTA);
    await first.writeText('alice', meta.id, 'docs/удалить.md', 'x', QUOTA);
    await first.deletePath('alice', meta.id, 'docs/удалить.md');
    await first.appendThread('alice', meta.id, [{ id: '1', kind: 'user', text: 'привет', createdAt: new Date().toISOString() }]);
    await first.flush();

    // «новый сервер»: пустой диск, та же БД
    const second = new ProjectStore({ rootDir: path.join(dir, 'b'), driver });
    const listed = await second.list('alice');
    assert.equal(listed.length, 1);
    assert.equal(listed[0].name, 'Проект');
    const restored = await second.get('alice', meta.id);
    assert.ok(restored);
    const files = (await second.listFiles('alice', meta.id)).map((f) => f.path);
    assert.ok(files.includes('package.json') && files.includes('src/with-nul.txt'));
    assert.ok(!files.includes('docs/удалить.md'), 'удалённый файл не воскресает');
    assert.match((await second.readText('alice', meta.id, 'package.json')).content, /"type": "module"/);
    assert.equal((await second.getThread('alice', meta.id))[0]?.kind, 'user');

    // чужой пользователь ничего не видит и ничего не записывает
    const stranger = new ProjectStore({ rootDir: path.join(dir, 'c'), driver });
    assert.deepEqual(await stranger.list('mallory'), []);
    assert.equal(await stranger.get('mallory', meta.id), null);
    await driver.saveFile('mallory', meta.id, { path: 'evil.txt', content: 'x', size: 1 });
    await driver.deleteFile('mallory', meta.id, 'package.json');
    await driver.deleteProject('mallory', meta.id);
    const check = await driver.loadProject('alice', meta.id);
    assert.ok(check?.files.some((f) => f.path === 'package.json'));
    assert.ok(!check?.files.some((f) => f.path === 'evil.txt'));

    // удаление проекта убирает и файлы
    await second.remove('alice', meta.id);
    await second.flush();
    assert.equal(await driver.loadProject('alice', meta.id), null);
    const left = await pg.runner.query<{ n: number }>('SELECT count(*)::int AS n FROM code_project_files');
    assert.equal(left[0].n, 0);
  } finally {
    await pg.close();
    await rm(dir, { recursive: true, force: true });
  }
});
