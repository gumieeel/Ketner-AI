import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  buildDockerArgs,
  detectNetworkIsolation,
  buildSandboxEnv,
  createSandbox,
  DEFAULT_DOCKER_CONFIG,
  LocalProcessSandbox,
  OutputCollector,
} from './sandbox.js';

async function withDir<T>(run: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), 'ketner-sbx-'));
  try {
    return await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const BASE = { timeoutMs: 10_000, maxOutputBytes: 4_000, network: true } as const;

test('OutputCollector держит начало и конец, середину вырезает', () => {
  const collector = new OutputCollector(100);
  collector.push('A'.repeat(500));
  collector.push('B'.repeat(500));
  collector.push('КОНЕЦ');
  const text = collector.toString();
  assert.equal(collector.truncated, true);
  assert.ok(text.startsWith('AAAA'));
  assert.ok(text.endsWith('КОНЕЦ'));
  assert.match(text, /вырезано \d+ симв/);
  assert.ok(text.length < 300);

  const small = new OutputCollector(100);
  small.push('коротко');
  assert.equal(small.toString(), 'коротко');
  assert.equal(small.truncated, false);
});

test('локальный раннер: вывод, код возврата и рабочая директория', () =>
  withDir(async (dir) => {
    await writeFile(path.join(dir, 'hello.txt'), 'привет');
    const sandbox = new LocalProcessSandbox({ networkIsolation: false });
    const ok = await sandbox.run({ ...BASE, cwd: dir, command: 'cat hello.txt && echo "-err" >&2 && pwd' });
    assert.equal(ok.exitCode, 0);
    assert.match(ok.output, /привет/);
    assert.match(ok.output, /-err/);
    assert.ok(ok.output.includes(path.basename(dir)));
    assert.equal(ok.timedOut, false);

    const failed = await sandbox.run({ ...BASE, cwd: dir, command: 'echo before; exit 3' });
    assert.equal(failed.exitCode, 3);
    assert.match(failed.output, /before/);
  }));

test('локальный раннер не видит секреты окружения сервера', () =>
  withDir(async (dir) => {
    process.env.OPENROUTER_API_KEY = 'sk-or-super-secret';
    process.env.STRIPE_SECRET_KEY = 'sk_live_secret';
    try {
      const sandbox = new LocalProcessSandbox({ networkIsolation: false });
      const result = await sandbox.run({ ...BASE, cwd: dir, command: 'env' });
      assert.doesNotMatch(result.output, /sk-or-super-secret/);
      assert.doesNotMatch(result.output, /sk_live_secret/);
      assert.doesNotMatch(result.output, /OPENROUTER|STRIPE/);
      assert.match(result.output, /CI=1/);
    } finally {
      delete process.env.OPENROUTER_API_KEY;
      delete process.env.STRIPE_SECRET_KEY;
    }
  }));

test('локальный раннер: таймаут убивает всю группу процессов, включая фоновые', () =>
  withDir(async (dir) => {
    const sandbox = new LocalProcessSandbox({ networkIsolation: false });
    const marker = path.join(dir, 'survivor.txt');
    const started = Date.now();
    const result = await sandbox.run({
      ...BASE,
      cwd: dir,
      timeoutMs: 700,
      // фоновый «ребёнок» должен умереть вместе с группой и не успеть записать файл
      command: `(sleep 2; echo alive > ${JSON.stringify(marker)}) & sleep 30`,
    });
    assert.equal(result.timedOut, true);
    assert.ok(Date.now() - started < 5_000, 'команда не должна ждать 30 секунд');
    await new Promise((resolve) => setTimeout(resolve, 2_500));
    await assert.rejects(readFile(marker, 'utf8'), 'фоновый процесс пережил запуск');
  }));

test('локальный раннер: отмена по сигналу', () =>
  withDir(async (dir) => {
    const sandbox = new LocalProcessSandbox({ networkIsolation: false });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 300);
    const result = await sandbox.run({ ...BASE, cwd: dir, command: 'sleep 30', signal: controller.signal });
    assert.equal(result.cancelled, true);
    assert.ok(result.durationMs < 5_000);
  }));

test('локальный раннер: большой вывод обрезается по лимиту', () =>
  withDir(async (dir) => {
    const sandbox = new LocalProcessSandbox({ networkIsolation: false });
    const result = await sandbox.run({
      ...BASE,
      cwd: dir,
      maxOutputBytes: 1_000,
      command: 'i=0; while [ $i -lt 3000 ]; do echo "строка номер $i"; i=$((i+1)); done; echo ФИНИШ',
    });
    assert.equal(result.truncated, true);
    assert.ok(result.output.length < 1_400);
    assert.match(result.output, /ФИНИШ/);
    assert.match(result.output, /строка номер 0/);
  }));

test(
  'локальный раннер: при network=false сетевых интерфейсов, кроме lo, нет (если система умеет unshare)',
  { skip: !detectNetworkIsolation() && 'unshare -rn недоступен в этой системе' },
  () =>
    withDir(async (dir) => {
      const sandbox = new LocalProcessSandbox();
      assert.equal(sandbox.canBlockNetwork, true);
      const offline = await sandbox.run({ ...BASE, cwd: dir, network: false, command: "tail -n +3 /proc/net/dev | cut -d: -f1 | tr -d ' '" });
      assert.deepEqual(offline.output.trim().split('\n').filter(Boolean), ['lo']);
    }),
);

test('buildSandboxEnv содержит только безопасный минимум', () => {
  const env = buildSandboxEnv('/tmp/h');
  assert.equal(env.HOME, '/tmp/h');
  assert.deepEqual(
    Object.keys(env).filter((key) => /KEY|SECRET|TOKEN|PASSWORD|DATABASE/i.test(key)),
    [],
  );
});

test('buildDockerArgs: без сети, без привилегий, с лимитами и монтированием только проекта', () => {
  const args = buildDockerArgs(
    { cwd: '/data/projects/u/p/files', command: 'npm test', timeoutMs: 1, maxOutputBytes: 1, network: false },
    'ketner-abc',
    { ...DEFAULT_DOCKER_CONFIG, user: '1000:1000' },
  );
  const joined = args.join(' ');
  assert.match(joined, /--network none/);
  assert.match(joined, /--cap-drop ALL/);
  assert.match(joined, /no-new-privileges/);
  assert.match(joined, /--pids-limit 256/);
  assert.match(joined, /--memory 768m/);
  assert.match(joined, /-v \/data\/projects\/u\/p\/files:\/work/);
  assert.match(joined, /--user 1000:1000/);
  assert.equal(args.filter((a) => a === '-v').length, 1, 'монтируется только каталог проекта');
  assert.ok(!joined.includes('--privileged'));
  assert.ok(!joined.includes('docker.sock'));
  assert.equal(args[args.length - 1].endsWith('npm test'), true);

  const withNet = buildDockerArgs(
    { cwd: '/x', command: 'npm i', timeoutMs: 1, maxOutputBytes: 1, network: true },
    'n',
    DEFAULT_DOCKER_CONFIG,
  );
  assert.match(withNet.join(' '), /--network bridge/);
});

test('createSandbox: по умолчанию выключена, local не включается в production без явного разрешения', () => {
  const warn = console.warn;
  console.warn = () => undefined;
  try {
    assert.equal(createSandbox({ mode: 'off', isProduction: false, allowLocalInProduction: false }), null);
    assert.equal(createSandbox({ mode: 'local', isProduction: true, allowLocalInProduction: false }), null);
    assert.equal(createSandbox({ mode: 'local', isProduction: true, allowLocalInProduction: true })?.kind, 'local');
    assert.equal(createSandbox({ mode: 'local', isProduction: false, allowLocalInProduction: false })?.isolated, false);
    const docker = createSandbox({ mode: 'docker', isProduction: true, allowLocalInProduction: false });
    assert.equal(docker?.kind, 'docker');
    assert.equal(docker?.isolated, true);
  } finally {
    console.warn = warn;
  }
});
