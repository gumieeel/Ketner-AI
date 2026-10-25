import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  agentToolDefinitions,
  executeTool,
  globToRegExp,
  type ToolContext,
} from './agent-tools.js';
import { countLineChanges, makePatch } from './line-diff.js';
import { ProjectStore } from './project-store.js';
import { LocalProcessSandbox } from './sandbox.js';

const QUOTA = { maxFiles: 50, maxFileBytes: 20_000, maxProjectBytes: 200_000 };

async function withCtx(
  run: (ctx: ToolContext, store: ProjectStore) => Promise<void>,
  overrides: Partial<ToolContext> = {},
): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), 'ketner-tools-'));
  try {
    const store = new ProjectStore({ rootDir: dir });
    const meta = await store.create('u1', { name: 'T' }, { maxProjects: 5, quota: QUOTA });
    const ctx: ToolContext = {
      userId: 'u1',
      projectId: meta.id,
      store,
      quota: QUOTA,
      sandbox: null,
      commandsAllowed: false,
      commandTimeoutMs: 10_000,
      allowNetwork: false,
      readPaths: new Set(),
      plan: [],
      ...overrides,
    };
    await run(ctx, store);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const call = (ctx: ToolContext, name: string, args: unknown) =>
  executeTool(name, JSON.stringify(args), ctx);

test('countLineChanges считает добавления и удаления', () => {
  assert.deepEqual(countLineChanges('a\nb\nc\n', 'a\nb\nc\n'), { additions: 0, deletions: 0 });
  assert.deepEqual(countLineChanges('', 'a\nb\n'), { additions: 2, deletions: 0 });
  assert.deepEqual(countLineChanges('a\nb\n', ''), { additions: 0, deletions: 2 });
  assert.deepEqual(countLineChanges('a\nb\nc\n', 'a\nX\nc\nd\n'), { additions: 2, deletions: 1 });
});

test('makePatch: блоки с контекстом, номера строк и ограничение длины', () => {
  assert.equal(makePatch('a\nb\n', 'a\nb\n'), '');
  const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
  const changed = [...lines];
  changed[9] = 'LINE TEN';
  const patch = makePatch(lines.join('\n') + '\n', changed.join('\n') + '\n');
  assert.equal(
    patch,
    ['@@ -8,5 +8,5 @@', ' line 8', ' line 9', '-line 10', '+LINE TEN', ' line 11', ' line 12'].join(
      '\n',
    ),
  );
  const created = makePatch('', 'x\ny\n');
  assert.equal(created, '@@ -1,0 +1,2 @@\n+x\n+y');
  const huge = makePatch('', Array.from({ length: 500 }, (_, i) => `row ${i}`).join('\n'), {
    maxChars: 300,
  });
  assert.ok(huge.length <= 330 && huge.endsWith('(patch truncated)'));
});

test('globToRegExp: *, **, ?, {a,b}', () => {
  assert.ok(globToRegExp('src/**/*.ts').test('src/a/b/c.ts'));
  assert.ok(globToRegExp('src/**/*.ts').test('src/c.ts'));
  assert.ok(!globToRegExp('src/*.ts').test('src/a/c.ts'));
  assert.ok(globToRegExp('*.md').test('docs/readme.md'));
  assert.ok(globToRegExp('*.{ts,tsx}').test('x/y.tsx'));
  assert.ok(!globToRegExp('*.{ts,tsx}').test('x/y.js'));
  assert.ok(globToRegExp('a?.txt').test('ab.txt'));
});

test('write_file → read_file с номерами строк и пагинацией', () =>
  withCtx(async (ctx) => {
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
    const written = await call(ctx, 'write_file', { path: 'src/big.txt', content: lines });
    assert.equal(written.ok, true);
    assert.equal(written.change?.action, 'create');
    assert.equal(written.change?.additions, 30);
    assert.match(written.change?.patch ?? '', /^@@ -1,0 \+1,30 @@\n\+line 1\n/);

    const part = await call(ctx, 'read_file', { path: 'src/big.txt', start_line: 5, end_line: 7 });
    assert.equal(part.ok, true);
    assert.match(part.output, /(^|\n)5\tline 5/);
    assert.match(part.output, /\n7\tline 7/);
    assert.match(part.output, /more lines/);
    assert.ok(ctx.readPaths.has('src/big.txt'));

    const over = await call(ctx, 'read_file', { path: 'src/big.txt', start_line: 99 });
    assert.equal(over.ok, false);
  }));

test('edit_file: точная замена, неоднозначность, ненайденный текст, replace_all', () =>
  withCtx(async (ctx, store) => {
    await call(ctx, 'write_file', {
      path: 'a.js',
      content: 'const a = 1;\nconst b = 1;\nconsole.log(a, b);\n',
    });

    const ambiguous = await call(ctx, 'edit_file', {
      path: 'a.js',
      old_string: '= 1;',
      new_string: '= 2;',
    });
    assert.equal(ambiguous.ok, false);
    assert.match(ambiguous.output, /occurs 2 times/);

    const missing = await call(ctx, 'edit_file', {
      path: 'a.js',
      old_string: 'const   a = 1',
      new_string: 'x',
    });
    assert.equal(missing.ok, false);
    assert.match(missing.output, /not found/);

    const one = await call(ctx, 'edit_file', {
      path: 'a.js',
      old_string: 'const a = 1;',
      new_string: 'const a = 10;',
    });
    assert.equal(one.ok, true);
    assert.deepEqual([one.change?.additions, one.change?.deletions], [1, 1]);
    assert.match(one.change?.patch ?? '', /-const a = 1;\n\+const a = 10;/);
    assert.match((await store.readText('u1', ctx.projectId, 'a.js')).content, /const a = 10;/);

    const all = await call(ctx, 'edit_file', {
      path: 'a.js',
      old_string: 'const',
      new_string: 'let',
      replace_all: true,
    });
    assert.equal(all.ok, true);
    assert.match(
      (await store.readText('u1', ctx.projectId, 'a.js')).content,
      /^let a = 10;\nlet b = 1;/,
    );

    const same = await call(ctx, 'edit_file', {
      path: 'a.js',
      old_string: 'let',
      new_string: 'let',
    });
    assert.equal(same.ok, false);
  }));

test('edit_file сохраняет CRLF-окончания', () =>
  withCtx(async (ctx, store) => {
    await call(ctx, 'write_file', { path: 'w.txt', content: 'one\r\ntwo\r\nthree\r\n' });
    const result = await call(ctx, 'edit_file', {
      path: 'w.txt',
      old_string: 'one\ntwo',
      new_string: 'uno\ndos',
    });
    assert.equal(result.ok, true);
    assert.equal(
      (await store.readText('u1', ctx.projectId, 'w.txt')).content,
      'uno\r\ndos\r\nthree\r\n',
    );
  }));

test('секретные файлы и .git закрыты для чтения и записи, .env.example разрешён', () =>
  withCtx(async (ctx, store) => {
    await store.writeText('u1', ctx.projectId, '.env', 'KEY=secret', QUOTA);
    assert.equal((await call(ctx, 'read_file', { path: '.env' })).ok, false);
    assert.equal((await call(ctx, 'write_file', { path: '.env', content: 'x' })).ok, false);
    assert.equal(
      (await call(ctx, 'edit_file', { path: '.env', old_string: 'KEY', new_string: 'K' })).ok,
      false,
    );
    assert.equal((await call(ctx, 'write_file', { path: '.git/config', content: 'x' })).ok, false);
    assert.equal(
      (await call(ctx, 'write_file', { path: '.env.example', content: 'KEY=' })).ok,
      true,
    );

    const search = await call(ctx, 'search_files', { pattern: 'secret' });
    assert.doesNotMatch(search.output, /\.env:/);
  }));

test('пути вне проекта отклоняются', () =>
  withCtx(async (ctx) => {
    for (const p of ['../x', '/etc/passwd', 'a/../../b']) {
      const result = await call(ctx, 'write_file', { path: p, content: 'x' });
      assert.equal(result.ok, false, p);
    }
    assert.equal((await call(ctx, 'read_file', { path: '../../etc/passwd' })).ok, false);
  }));

test('search_files: содержимое, glob, литерал и защита от тяжёлых регулярных выражений', () =>
  withCtx(async (ctx) => {
    await call(ctx, 'write_file', {
      path: 'src/a.ts',
      content: 'export const foo = 1;\n// TODO fix\n',
    });
    await call(ctx, 'write_file', { path: 'src/b.py', content: 'def foo():\n    pass\n' });
    await call(ctx, 'write_file', { path: 'notes.md', content: 'foo here\n' });

    const all = await call(ctx, 'search_files', { pattern: 'foo' });
    assert.match(all.output, /src\/a\.ts:1:/);
    assert.match(all.output, /src\/b\.py:1:/);
    assert.match(all.output, /notes\.md:1:/);

    const ts = await call(ctx, 'search_files', { pattern: 'foo', glob: '**/*.ts' });
    assert.match(ts.output, /a\.ts/);
    assert.doesNotMatch(ts.output, /b\.py/);

    const names = await call(ctx, 'search_files', { glob: '*.py' });
    assert.match(names.output, /src\/b\.py/);

    const literal = await call(ctx, 'search_files', { pattern: 'foo()', literal: true });
    assert.match(literal.output, /b\.py:1/);

    const none = await call(ctx, 'search_files', { pattern: 'nothing-like-this' });
    assert.equal(none.output, 'No matches.');

    const risky = await call(ctx, 'search_files', { pattern: '(a+)+$' });
    assert.equal(risky.ok, false);
    const broken = await call(ctx, 'search_files', { pattern: '([' });
    assert.equal(broken.ok, false);
    assert.equal((await call(ctx, 'search_files', {})).ok, false);
  }));

test('list_files: каталоги, рекурсия, ошибки', () =>
  withCtx(async (ctx) => {
    await call(ctx, 'write_file', { path: 'src/a.ts', content: 'a' });
    await call(ctx, 'write_file', { path: 'src/deep/b.ts', content: 'b' });
    await call(ctx, 'write_file', { path: 'README.md', content: 'r' });

    const root = await call(ctx, 'list_files', {});
    assert.match(root.output, /src\/ {2}\(2 files\)/);
    assert.match(root.output, /README\.md/);

    const rec = await call(ctx, 'list_files', { path: 'src', recursive: true });
    assert.match(rec.output, /src\/deep\/b\.ts/);

    assert.equal((await call(ctx, 'list_files', { path: 'nope' })).ok, false);
    assert.equal((await call(ctx, 'list_files', { path: 'README.md' })).ok, false);
  }));

test('move_file и delete_file меняют проект и описывают изменение', () =>
  withCtx(async (ctx, store) => {
    await call(ctx, 'write_file', { path: 'old/name.txt', content: 'x\ny\n' });
    const moved = await call(ctx, 'move_file', { from: 'old/name.txt', to: 'new/name.txt' });
    assert.equal(moved.ok, true);
    assert.equal(moved.change?.action, 'move');
    assert.equal(moved.change?.from, 'old/name.txt');
    assert.equal((await call(ctx, 'move_file', { from: 'old/name.txt', to: 'z.txt' })).ok, false);

    const deleted = await call(ctx, 'delete_file', { path: 'new/name.txt' });
    assert.equal(deleted.ok, true);
    assert.equal(deleted.change?.action, 'delete');
    assert.equal(deleted.change?.deletions, 2);
    assert.deepEqual(
      (await store.listFiles('u1', ctx.projectId)).map((f) => f.path),
      ['README.md'],
    );
    assert.equal((await call(ctx, 'delete_file', { path: 'new/name.txt' })).ok, false);
  }));

test('квоты проекта действуют и на агента', () =>
  withCtx(async (ctx) => {
    const big = await call(ctx, 'write_file', { path: 'big.txt', content: 'x'.repeat(30_000) });
    assert.equal(big.ok, false);
    assert.match(big.output, /^Error:/);
  }));

test('update_plan хранит список и ограничивает значения', () =>
  withCtx(async (ctx) => {
    const result = await call(ctx, 'update_plan', {
      items: [
        { text: 'one', status: 'done' },
        { text: 'two', status: 'weird' },
        { text: '  ', status: 'done' },
      ],
    });
    assert.equal(result.ok, true);
    assert.deepEqual(ctx.plan, [
      { text: 'one', status: 'done' },
      { text: 'two', status: 'pending' },
    ]);
    assert.equal((await call(ctx, 'update_plan', { items: 'x' })).ok, false);
  }));

test('некорректные аргументы и неизвестные инструменты дают понятную ошибку, а не исключение', () =>
  withCtx(async (ctx) => {
    const broken = await executeTool('read_file', '{"path": "a', ctx);
    assert.equal(broken.ok, false);
    assert.match(broken.output, /not valid JSON/);
    assert.equal((await executeTool('read_file', '[1]', ctx)).ok, false);
    const unknown = await call(ctx, 'format_disk', {});
    assert.equal(unknown.ok, false);
    assert.match(unknown.output, /Unknown tool/);
    assert.equal((await call(ctx, 'run_command', { command: 'ls' })).ok, false);
  }));

test('agentToolDefinitions: run_command только когда команды доступны', () => {
  const without = agentToolDefinitions({ commands: false, network: false }).map(
    (t) => t.function.name,
  );
  const withCmd = agentToolDefinitions({ commands: true, network: false }).map(
    (t) => t.function.name,
  );
  assert.ok(!without.includes('run_command'));
  assert.ok(withCmd.includes('run_command'));
  assert.equal(new Set(withCmd).size, withCmd.length);
});

test('run_command: вывод, обнаружение новых файлов и запрет без разрешения тарифа', () =>
  withCtx(
    async (ctx) => {
      const ok = await call(ctx, 'run_command', {
        command: 'echo hi > made.txt; echo done; exit 0',
      });
      assert.equal(ok.ok, true);
      assert.match(ok.output, /exit code 0/);
      assert.match(ok.output, /done/);
      assert.match(ok.output, /created: made\.txt/);

      const bad = await call(ctx, 'run_command', { command: 'echo oops; exit 2' });
      assert.equal(bad.ok, false);
      assert.match(bad.output, /exit code 2/);

      const slow = await call(ctx, 'run_command', { command: 'sleep 20', timeout_seconds: 1 });
      assert.equal(slow.ok, false);
      assert.match(slow.output, /timed out/);

      ctx.commandsAllowed = false;
      const denied = await call(ctx, 'run_command', { command: 'echo hi' });
      assert.equal(denied.ok, false);
      assert.match(denied.output, /not included in the current plan/);
    },
    { sandbox: new LocalProcessSandbox({ networkIsolation: false }), commandsAllowed: true },
  ));

test('run_command: файлы, раздувшие проект сверх квоты, удаляются', () =>
  withCtx(
    async (ctx, store) => {
      const result = await call(ctx, 'run_command', {
        command: 'head -c 150000 /dev/zero | tr "\\0" "a" > huge.txt; echo ok',
      });
      assert.match(result.output, /exceeded the plan quota/);
      const files = await store.listFiles('u1', ctx.projectId);
      assert.ok(!files.some((f) => f.path === 'huge.txt'));
    },
    {
      sandbox: new LocalProcessSandbox({ networkIsolation: false }),
      commandsAllowed: true,
      quota: { maxFiles: 50, maxFileBytes: 20_000, maxProjectBytes: 100_000 },
    },
  ));
