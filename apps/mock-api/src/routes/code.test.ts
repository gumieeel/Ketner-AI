import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import express from 'express';
import { strToU8, zipSync } from 'fflate';
import { ProjectStore } from '../code/project-store.js';
import { extractZipText } from '../code/archive.js';
import type { AgentEvent, AgentRunner } from '../code/agent-runner.js';
import { LocalProcessSandbox } from '../code/sandbox.js';
import { UsageStore } from '../store/usage-store.js';
import type { User } from '../types.js';
import { createCodeRouter } from './code.js';

interface Env {
  baseUrl: string;
  store: ProjectStore;
  call: (userId: string, plan: string, method: string, url: string, body?: unknown) => Promise<Response>;
}

async function withServer(
  options: {
    runner?: AgentRunner;
    allowAnonymous?: boolean;
    fetchImpl?: typeof fetch;
    sandbox?: LocalProcessSandbox | null;
  },
  run: (env: Env) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), 'ketner-code-routes-'));
  const store = new ProjectStore({ rootDir: path.join(dir, 'projects') });
  const app = express();
  app.use(express.json({ limit: '50mb' }));
  app.use((request, _response, next) => {
    const id = request.header('x-test-user');
    if (id) request.user = { id, email: `${id}@example.com`, plan: (request.header('x-test-plan') ?? 'free') as User['plan'] } as User;
    next();
  });
  app.use(
    '/api/code',
    createCodeRouter({
      userId: 'demo-user',
      store,
      usageStore: new UsageStore(path.join(dir, 'usage.json')),
      sandbox: options.sandbox ?? null,
      runner: options.runner,
      allowAnonymous: options.allowAnonymous ?? false,
      fetchImpl: options.fetchImpl,
    }),
  );
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    await run({
      baseUrl,
      store,
      call: (userId, plan, method, url, body) =>
        fetch(`${baseUrl}/api/code${url}`, {
          method,
          headers: { 'x-test-user': userId, 'x-test-plan': plan, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
          body: body !== undefined ? JSON.stringify(body) : undefined,
        }),
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
}

async function json<T = any>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

test('без входа API проекта отвечает 401, анонимный режим включается только явно', async () => {
  await withServer({}, async ({ baseUrl }) => {
    assert.equal((await fetch(`${baseUrl}/api/code/projects`)).status, 401);
  });
  await withServer({ allowAnonymous: true }, async ({ baseUrl }) => {
    assert.equal((await fetch(`${baseUrl}/api/code/projects`)).status, 200);
  });
});

test('capabilities отражает тариф: команды недоступны на Free и при выключенной песочнице', async () => {
  await withServer({}, async ({ call }) => {
    const free = await json(await call('a', 'free', 'GET', '/capabilities'));
    assert.equal(free.plan, 'free');
    assert.equal(free.limits.maxProjects, 1);
    assert.deepEqual([free.commands.available, free.commands.reason], [false, 'plan']);
    const pro = await json(await call('a', 'pro', 'GET', '/capabilities'));
    assert.deepEqual([pro.commands.available, pro.commands.reason], [false, 'server_disabled']);
    assert.ok(pro.models.some((m: { id: string; locked: boolean }) => m.id === 'claude-opus-5.5' && m.locked === false));
    assert.ok(free.models.some((m: { id: string; locked: boolean }) => m.id === 'claude-opus-5.5' && m.locked === true));
  });
  await withServer({ sandbox: new LocalProcessSandbox({ networkIsolation: false }) }, async ({ call }) => {
    const pro = await json(await call('a', 'pro', 'GET', '/capabilities'));
    assert.equal(pro.commands.available, true);
  });
});

test('проекты: создание, список, переименование, удаление, лимит тарифа и изоляция пользователей', async () => {
  await withServer({}, async ({ call }) => {
    const created = await call('alice', 'free', 'POST', '/projects', { name: 'Первый', template: 'node' });
    assert.equal(created.status, 201);
    const project = (await json(created)).project;
    assert.ok(project.fileCount >= 4);
    assert.equal(project.userId, undefined, 'владелец наружу не отдаётся');

    const second = await call('alice', 'free', 'POST', '/projects', { name: 'Второй' });
    assert.equal(second.status, 413);
    assert.equal((await json(second)).error.code, 'quota_exceeded');

    assert.equal((await call('alice', 'free', 'POST', '/projects', { name: 'x', template: 'nope' })).status, 400);

    const renamed = await json(await call('alice', 'free', 'PATCH', `/projects/${project.id}`, { name: 'Новое имя' }));
    assert.equal(renamed.project.name, 'Новое имя');

    assert.equal((await call('bob', 'free', 'GET', `/projects/${project.id}`)).status, 404);
    assert.equal((await call('bob', 'free', 'DELETE', `/projects/${project.id}`)).status, 404);
    assert.deepEqual((await json(await call('bob', 'free', 'GET', '/projects'))).projects, []);
    assert.equal((await json(await call('alice', 'free', 'GET', '/projects'))).projects.length, 1);

    assert.equal((await call('alice', 'free', 'DELETE', `/projects/${project.id}`)).status, 204);
    assert.equal((await call('alice', 'free', 'GET', `/projects/${project.id}`)).status, 404);
  });
});

test('файлы: чтение, запись, перемещение, удаление и защита путей', async () => {
  await withServer({}, async ({ call, store }) => {
    const { project } = await json(await call('alice', 'free', 'POST', '/projects', { name: 'P' }));
    const id = project.id;

    const put = await call('alice', 'free', 'PUT', `/projects/${id}/file`, { path: 'src/a.ts', content: 'export const a = 1;\n' });
    assert.equal(put.status, 201);
    assert.equal((await json(put)).file.language, 'typescript');

    const read = await json(await call('alice', 'free', 'GET', `/projects/${id}/file?path=src/a.ts`));
    assert.equal(read.content, 'export const a = 1;\n');

    const list = await json(await call('alice', 'free', 'GET', `/projects/${id}/files`));
    assert.ok(list.files.some((f: { path: string }) => f.path === 'src/a.ts'));

    assert.equal((await call('alice', 'free', 'POST', `/projects/${id}/move`, { from: 'src/a.ts', to: 'src/b.ts' })).status, 204);
    assert.equal((await call('alice', 'free', 'GET', `/projects/${id}/file?path=src/a.ts`)).status, 404);
    const removed = await json(await call('alice', 'free', 'DELETE', `/projects/${id}/file?path=src/b.ts`));
    assert.deepEqual(removed.removed, ['src/b.ts']);

    for (const bad of ['../secret', '/etc/passwd', 'a/../../b']) {
      const r = await call('alice', 'free', 'PUT', `/projects/${id}/file`, { path: bad, content: 'x' });
      assert.equal(r.status, 400, bad);
    }
    assert.equal((await call('alice', 'free', 'PUT', `/projects/${id}/file`, { path: '.git/config', content: 'x' })).status, 403);
    assert.equal((await call('alice', 'free', 'PUT', `/projects/${id}/file`, { path: 'a.txt' })).status, 400);

    const tooBig = await call('alice', 'free', 'PUT', `/projects/${id}/file`, { path: 'big.txt', content: 'x'.repeat(250_000) });
    assert.equal(tooBig.status, 413);

    await store.fsFor('alice', id).then((fs) => fs.write('bin.dat', Buffer.from([1, 2, 0, 3])));
    assert.equal((await call('alice', 'free', 'GET', `/projects/${id}/file?path=bin.dat`)).status, 415);
    assert.equal((await call('bob', 'free', 'GET', `/projects/${id}/files`)).status, 404);
  });
});

test('импорт: секреты и зависимости пропускаются, остальное записывается', async () => {
  await withServer({}, async ({ call }) => {
    const { project } = await json(await call('alice', 'plus', 'POST', '/projects', { name: 'Imp' }));
    const response = await json(
      await call('alice', 'plus', 'POST', `/projects/${project.id}/import`, {
        files: [
          { path: 'src/main.py', content: 'print(1)\n' },
          { path: '.env', content: 'KEY=secret' },
          { path: 'config/.env.production', content: 'KEY=secret' },
          { path: '.env.example', content: 'KEY=' },
          { path: 'node_modules/x/i.js', content: 'x' },
          { path: '../evil', content: 'x' },
        ],
      }),
    );
    assert.equal(response.written, 2);
    assert.equal(response.skippedCount, 4);
    const files = (await json(await call('alice', 'plus', 'GET', `/projects/${project.id}/files`))).files.map((f: { path: string }) => f.path);
    assert.ok(files.includes('src/main.py') && files.includes('.env.example'));
    assert.ok(!files.includes('.env') && !files.some((p: string) => p.includes('node_modules')));

    assert.equal((await call('alice', 'plus', 'POST', `/projects/${project.id}/import`, { files: [] })).status, 400);
  });
});

test('экспорт отдаёт ZIP со всеми файлами проекта', async () => {
  await withServer({}, async ({ call }) => {
    const { project } = await json(await call('alice', 'free', 'POST', '/projects', { name: 'Мой проект', template: 'python' }));
    await call('alice', 'free', 'PUT', `/projects/${project.id}/file`, { path: 'docs/note.md', content: 'привет' });
    const response = await call('alice', 'free', 'GET', `/projects/${project.id}/export.zip`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/zip');
    assert.match(response.headers.get('content-disposition') ?? '', /attachment; filename="[A-Za-z0-9._-]+\.zip"/);
    const archive = new Uint8Array(await response.arrayBuffer());
    const { files } = extractZipText(archive, { maxFiles: 100, maxFileBytes: 100_000, maxTotalBytes: 1_000_000 });
    assert.ok(files.some((f) => f.path === 'docs/note.md' && f.content === 'привет'));
    assert.ok(files.some((f) => f.path === 'README.md'));
  });
});

test('импорт из GitHub: проверка адреса, лимиты и создание проекта', async () => {
  const archive = zipSync({
    'repo-abc/README.md': strToU8('# hi'),
    'repo-abc/src/app.js': strToU8('console.log(1)'),
    'repo-abc/.env': strToU8('SECRET=1'),
  });
  let requested = '';
  const fetchImpl = (async (url: string) => {
    requested = String(url);
    return new Response(archive);
  }) as unknown as typeof fetch;

  await withServer({ fetchImpl }, async ({ call }) => {
    const bad = await call('alice', 'plus', 'POST', '/projects/import-github', { url: 'https://evil.example.com/a/b' });
    assert.equal(bad.status, 400);
    assert.equal(requested, '', 'на посторонний адрес запрос не уходит');

    const ok = await call('alice', 'plus', 'POST', '/projects/import-github', { url: 'https://github.com/acme/widgets' });
    assert.equal(ok.status, 201);
    const body = await json(ok);
    assert.equal(requested, 'https://api.github.com/repos/acme/widgets/zipball');
    assert.equal(body.project.name, 'widgets');
    assert.equal(body.project.source.type, 'github');
    assert.equal(body.written, 2);
    assert.equal(body.skippedCount, 1);
  });

  await withServer({ fetchImpl: (async () => new Response('', { status: 404 })) as typeof fetch }, async ({ call }) => {
    const missing = await call('alice', 'plus', 'POST', '/projects/import-github', { url: 'acme/private' });
    assert.equal(missing.status, 404);
    assert.equal((await json(missing)).error.code, 'github_not_found');
    assert.deepEqual((await json(await call('alice', 'plus', 'GET', '/projects'))).projects, []);
  });
});

function fakeRunner(script: (input: Parameters<AgentRunner['run']>[0], emit: (e: AgentEvent) => void) => Promise<void>): AgentRunner {
  return {
    run: async (input: Parameters<AgentRunner['run']>[0], emit: (e: AgentEvent) => void) => {
      await script(input, emit);
      return { runId: 'r1', status: 'completed', steps: 1, costUsd: 0, modelId: 'ketner-mini' };
    },
  } as unknown as AgentRunner;
}

async function readEvents(response: Response): Promise<Array<{ event: string; data: any }>> {
  const text = await response.text();
  return text
    .split('\n\n')
    .filter((block) => block.startsWith('event:'))
    .map((block) => {
      const [eventLine, dataLine] = block.split('\n');
      return { event: eventLine.slice(7), data: JSON.parse(dataLine.slice(6)) };
    });
}

test('запуск агента: SSE-события, параметры из тарифа и запрет второго запуска в проекте', async () => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let seen: Parameters<AgentRunner['run']>[0] | undefined;
  const runner = fakeRunner(async (input, emit) => {
    seen = input;
    emit({ type: 'run_start', runId: 'r1', modelId: 'ketner-mini', modelName: 'Ketner Mini', maxSteps: 8, budgetUsd: 0.02, commands: false, routingReason: null });
    if (input.task === 'wait') await gate;
    emit({ type: 'delta', step: 1, content: 'готово' });
    emit({ type: 'done', runId: 'r1', status: 'completed', steps: 1, costUsd: 0, modelId: 'ketner-mini' });
  });

  await withServer({ runner }, async ({ call }) => {
    const { project } = await json(await call('alice', 'plus', 'POST', '/projects', { name: 'R' }));
    const url = `/projects/${project.id}/run`;

    assert.equal((await call('alice', 'plus', 'POST', url, { task: '   ' })).status, 400);
    assert.equal((await call('bob', 'plus', 'POST', url, { task: 'x' })).status, 404);

    const first = call('alice', 'plus', 'POST', url, { task: 'wait', modelId: 'gpt-6.1-sol', language: 'en' });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const second = await call('alice', 'plus', 'POST', url, { task: 'another' });
    assert.equal(second.status, 409);
    assert.equal((await json(second)).error.code, 'run_in_progress');
    assert.equal((await json(await call('alice', 'plus', 'GET', `/projects/${project.id}`))).running, true);
    release();

    const response = await first;
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /text\/event-stream/);
    const events = await readEvents(response);
    assert.deepEqual(events.map((e) => e.event), ['run_start', 'delta', 'done']);
    assert.equal(seen?.plan, 'plus');
    assert.equal(seen?.userId, 'alice');
    assert.equal(seen?.modelId, 'gpt-6.1-sol');
    assert.equal(seen?.language, 'en');

    // после завершения запуск снова возможен
    const again = await call('alice', 'plus', 'POST', url, { task: 'again' });
    assert.equal(again.status, 200);
    await again.text();
  });
});

test('кнопка «Стоп» прерывает запуск, закрытие соединения тоже', async () => {
  let aborted = 0;
  const runner = fakeRunner(async (input, emit) => {
    emit({ type: 'run_start', runId: 'r1', modelId: 'ketner-mini', modelName: 'Ketner Mini', maxSteps: 8, budgetUsd: 0.02, commands: false, routingReason: null });
    await new Promise<void>((resolve) => input.signal.addEventListener('abort', () => resolve(), { once: true }));
    aborted += 1;
    emit({ type: 'done', runId: 'r1', status: 'cancelled', steps: 1, costUsd: 0, modelId: 'ketner-mini' });
  });

  await withServer({ runner }, async ({ call }) => {
    const { project } = await json(await call('alice', 'plus', 'POST', '/projects', { name: 'R' }));
    const url = `/projects/${project.id}/run`;

    const running = call('alice', 'plus', 'POST', url, { task: 'long' });
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal((await call('bob', 'plus', 'POST', `/projects/${project.id}/stop`)).status, 404);
    assert.equal((await call('alice', 'plus', 'POST', `/projects/${project.id}/stop`)).status, 204);
    const events = await readEvents(await running);
    assert.equal(events.at(-1)?.data.status, 'cancelled');
    assert.equal(aborted, 1);

    const controller = new AbortController();
    const second = fetch(`${(await call('alice', 'plus', 'GET', '/capabilities')).url.replace('/capabilities', '')}${url.replace('/api/code', '')}`, {
      method: 'POST',
      headers: { 'x-test-user': 'alice', 'x-test-plan': 'plus', 'Content-Type': 'application/json' },
      body: JSON.stringify({ task: 'long again' }),
      signal: controller.signal,
    }).catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 100));
    controller.abort();
    await second;
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(aborted, 2, 'обрыв соединения останавливает запуск');
  });
});

test('лента: чтение и очистка', async () => {
  await withServer({}, async ({ call, store }) => {
    const { project } = await json(await call('alice', 'free', 'POST', '/projects', { name: 'T' }));
    await store.appendThread('alice', project.id, [{ id: '1', kind: 'user', text: 'привет', createdAt: new Date().toISOString() }]);
    const thread = await json(await call('alice', 'free', 'GET', `/projects/${project.id}/thread`));
    assert.equal(thread.items.length, 1);
    assert.equal((await call('bob', 'free', 'GET', `/projects/${project.id}/thread`)).status, 404);
    assert.equal((await call('alice', 'free', 'DELETE', `/projects/${project.id}/thread`)).status, 204);
    assert.deepEqual((await json(await call('alice', 'free', 'GET', `/projects/${project.id}/thread`))).items, []);
  });
});
