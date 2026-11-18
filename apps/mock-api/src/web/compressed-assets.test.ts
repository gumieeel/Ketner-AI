import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import express from 'express';
import { ASSET_CACHE_CONTROL, compressedAssets, pickEncoding } from './compressed-assets.js';

const CSS = `.a{color:red}\n`.repeat(400);

async function start() {
  const dir = mkdtempSync(join(tmpdir(), 'ketner-assets-'));
  const assets = join(dir, 'assets');
  mkdirSync(assets);
  writeFileSync(join(assets, 'index-abc.css'), CSS);
  writeFileSync(join(assets, 'tiny-abc.js'), 'export {};');
  writeFileSync(join(dir, 'secret.css'), CSS);
  const app = express();
  app.use('/assets', compressedAssets(assets));
  app.use('/assets', express.static(assets));
  const server: Server = app.listen(0);
  const base = `http://localhost:${(server.address() as { port: number }).port}`;
  return { base, close: () => server.close() };
}

/** Сырой ответ без автоматической распаковки fetch. */
async function raw(url: string, encoding: string | null, method = 'GET') {
  const { request } = await import('node:http');
  return new Promise<{ status: number; headers: Record<string, unknown>; body: Buffer }>(
    (resolve, reject) => {
      const req = request(
        url,
        { method, headers: encoding ? { 'Accept-Encoding': encoding } : {} },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () =>
            resolve({
              status: res.statusCode ?? 0,
              headers: res.headers,
              body: Buffer.concat(chunks),
            }),
          );
        },
      );
      req.on('error', reject);
      req.end();
    },
  );
}

test('выбор сжатия: brotli лучше gzip, q=0 — отказ', () => {
  assert.equal(pickEncoding('gzip, deflate, br'), 'br');
  assert.equal(pickEncoding('gzip'), 'gzip');
  assert.equal(pickEncoding('br;q=0, gzip'), 'gzip');
  assert.equal(pickEncoding('identity'), null);
  assert.equal(pickEncoding(undefined), null);
});

test('стиль сборки отдаётся сжатым brotli или gzip, с годовым кэшем', async (t) => {
  const app = await start();
  t.after(() => app.close());

  const br = await raw(`${app.base}/assets/index-abc.css`, 'gzip, br');
  assert.equal(br.status, 200);
  assert.equal(br.headers['content-encoding'], 'br');
  assert.equal(br.headers['vary'], 'Accept-Encoding');
  assert.equal(br.headers['cache-control'], ASSET_CACHE_CONTROL);
  assert.match(String(br.headers['content-type']), /^text\/css/);
  assert.equal(brotliDecompressSync(br.body).toString(), CSS);
  assert.ok(br.body.length < CSS.length / 10, 'сжато');

  const gz = await raw(`${app.base}/assets/index-abc.css`, 'gzip');
  assert.equal(gz.headers['content-encoding'], 'gzip');
  assert.equal(gunzipSync(gz.body).toString(), CSS);

  const head = await raw(`${app.base}/assets/index-abc.css`, 'br', 'HEAD');
  assert.equal(head.status, 200);
  assert.equal(head.body.length, 0);
});

test('без сжатия в запросе, маленький файл и выход за каталог — как раньше, без сжатия', async (t) => {
  const app = await start();
  t.after(() => app.close());

  const plain = await raw(`${app.base}/assets/index-abc.css`, null);
  assert.equal(plain.status, 200);
  assert.equal(plain.headers['content-encoding'], undefined);
  assert.equal(plain.body.toString(), CSS);

  const tiny = await raw(`${app.base}/assets/tiny-abc.js`, 'br');
  assert.equal(tiny.headers['content-encoding'], undefined);
  assert.equal(tiny.body.toString(), 'export {};');

  const outside = await raw(`${app.base}/assets/..%2Fsecret.css`, 'br');
  assert.notEqual(outside.headers['content-encoding'], 'br');
  assert.notEqual(outside.body.toString(), CSS);

  const missing = await raw(`${app.base}/assets/nope.css`, 'br');
  assert.equal(missing.status, 404);
});
