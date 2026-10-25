import assert from 'node:assert/strict';
import test from 'node:test';
import { strToU8, zipSync } from 'fflate';
import {
  createZipWriter,
  downloadGithubZip,
  extractZipText,
  GithubImportError,
  parseGithubUrl,
} from './archive.js';

const LIMITS = { maxFiles: 50, maxFileBytes: 1_000, maxTotalBytes: 5_000 };

test('parseGithubUrl принимает только github.com и безопасные имена', () => {
  assert.deepEqual(parseGithubUrl('https://github.com/acme/app'), { owner: 'acme', repo: 'app' });
  assert.deepEqual(parseGithubUrl('github.com/acme/app.git'), { owner: 'acme', repo: 'app' });
  assert.deepEqual(parseGithubUrl('acme/app'), { owner: 'acme', repo: 'app' });
  assert.deepEqual(parseGithubUrl('https://github.com/acme/app/tree/dev/src'), {
    owner: 'acme',
    repo: 'app',
    ref: 'dev',
  });
  for (const bad of [
    'https://evil.com/acme/app',
    'http://github.com/acme/app',
    'https://github.com.evil.com/acme/app',
    'https://user:pw@github.com/acme/app',
    'https://github.com/acme',
    'https://github.com/acme/..',
    '',
    'file:///etc/passwd',
  ]) {
    assert.equal(parseGithubUrl(bad), null, bad);
  }
});

test('extractZipText: убирает общий каталог, фильтрует секреты, зависимости, двоичные и большие файлы', () => {
  const archive = zipSync({
    'repo-abc123/src/index.js': strToU8('console.log(1)'),
    'repo-abc123/README.md': strToU8('# hi'),
    'repo-abc123/.env': strToU8('KEY=secret'),
    'repo-abc123/.env.example': strToU8('KEY='),
    'repo-abc123/node_modules/x/index.js': strToU8('x'),
    'repo-abc123/.git/config': strToU8('x'),
    'repo-abc123/logo.png': new Uint8Array([137, 80, 78, 71, 0, 0, 0, 1]),
    'repo-abc123/big.txt': strToU8('a'.repeat(2_000)),
    'repo-abc123/latin.txt': new Uint8Array([0xff, 0xfe, 0xfd, 0x41]),
  });
  const { files, skipped } = extractZipText(archive, LIMITS);
  assert.deepEqual(files.map((f) => f.path).sort(), ['.env.example', 'README.md', 'src/index.js']);
  const reasons = Object.fromEntries(skipped.map((s) => [s.path, s.reason]));
  assert.match(reasons['.env'], /секрет/);
  assert.match(reasons['node_modules/x/index.js'], /зависимости/);
  assert.match(reasons['big.txt'], /лимит/);
  assert.match(reasons['logo.png'], /двоичный/);
  assert.match(reasons['latin.txt'], /UTF-8/);
  assert.ok(!('.git/config' in reasons));
});

test('extractZipText: лимит числа файлов и общего размера, опасные пути', () => {
  const many: Record<string, Uint8Array> = {};
  for (let i = 0; i < 10; i += 1) many[`f${i}.txt`] = strToU8('x'.repeat(100));
  const limited = extractZipText(zipSync(many), {
    maxFiles: 3,
    maxFileBytes: 1_000,
    maxTotalBytes: 100_000,
  });
  assert.equal(limited.files.length, 3);
  assert.equal(limited.skipped.length, 7);

  const total = extractZipText(zipSync(many), {
    maxFiles: 100,
    maxFileBytes: 1_000,
    maxTotalBytes: 450,
  });
  assert.equal(total.files.length, 4);

  const traversal = extractZipText(
    zipSync({ 'a/../../etc/passwd': strToU8('x'), 'ok.txt': strToU8('ok') }),
    LIMITS,
  );
  assert.deepEqual(
    traversal.files.map((f) => f.path),
    ['ok.txt'],
  );
});

test('createZipWriter собирает читаемый архив', () => {
  const chunks: Uint8Array[] = [];
  const writer = createZipWriter((chunk) => chunks.push(chunk));
  writer.add('a.txt', strToU8('hello'));
  writer.add('dir/b.txt', strToU8('world'));
  writer.end();
  const merged = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.length;
  }
  const { files } = extractZipText(merged, LIMITS);
  assert.deepEqual(files.map((f) => [f.path, f.content]).sort(), [
    ['a.txt', 'hello'],
    ['dir/b.txt', 'world'],
  ]);
});

test('downloadGithubZip: размер ограничен, 404 даёт понятную ошибку', async () => {
  const body = zipSync({ 'r/a.txt': strToU8('a') });
  const ok = await downloadGithubZip(
    { owner: 'a', repo: 'b' },
    { maxBytes: 10_000, fetchImpl: (async () => new Response(body)) as typeof fetch },
  );
  assert.equal(ok.length, body.length);

  await assert.rejects(
    downloadGithubZip(
      { owner: 'a', repo: 'b' },
      { maxBytes: 10, fetchImpl: (async () => new Response(body)) as typeof fetch },
    ),
    (error: unknown) => error instanceof GithubImportError && error.code === 'too_large',
  );
  await assert.rejects(
    downloadGithubZip(
      { owner: 'a', repo: 'b' },
      {
        maxBytes: 10_000,
        fetchImpl: (async () => new Response('', { status: 404 })) as typeof fetch,
      },
    ),
    (error: unknown) => error instanceof GithubImportError && error.code === 'not_found',
  );
  await assert.rejects(
    downloadGithubZip(
      { owner: 'a', repo: 'b' },
      {
        maxBytes: 10_000,
        fetchImpl: (async () => {
          throw new Error('network');
        }) as typeof fetch,
      },
    ),
    (error: unknown) => error instanceof GithubImportError && error.code === 'unavailable',
  );
});
