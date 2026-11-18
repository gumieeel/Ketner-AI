/**
 * Файлы сборки сайта (/assets/*.js, *.css) сжатыми: brotli или gzip — по Accept-Encoding.
 *
 * Без сжатия стиль (≈130 КБ) и скрипты (≈0,5 МБ) шли по сети целиком: стиль блокирует первую
 * отрисовку, и на медленном мобильном интернете первый экран оставался пустым несколько секунд,
 * хотя разметка уже была в HTML. Файлы в /assets/ с хешем в имени не меняются, поэтому каждый
 * сжимается один раз и хранится в памяти. Без новых зависимостей: только node:zlib.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import type { NextFunction, Request, Response } from 'express';

const TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
};

/** Меньше этого сжатие не окупается. */
const MIN_BYTES = 1024;

type Encoding = 'br' | 'gzip';

/** Какое сжатие принимает браузер: brotli лучше, gzip — запасной. */
export function pickEncoding(header: string | undefined): Encoding | null {
  if (!header) return null;
  const accepted = header
    .split(',')
    .map((part) => part.trim().split(';'))
    .filter(([, quality]) => !quality || !/^q=0(\.0*)?$/.test(quality.trim()))
    .map(([name]) => name!.trim().toLowerCase());
  if (accepted.includes('br')) return 'br';
  if (accepted.includes('gzip')) return 'gzip';
  return null;
}

export const ASSET_CACHE_CONTROL = 'public, max-age=31536000, immutable';

export function compressedAssets(assetsDir: string) {
  const root = path.resolve(assetsDir);
  const cache = new Map<string, Promise<Buffer | null>>();

  const compressed = (file: string, encoding: Encoding): Promise<Buffer | null> => {
    const key = `${encoding}:${file}`;
    let entry = cache.get(key);
    if (!entry) {
      entry = readFile(file).then(
        (body) =>
          body.length < MIN_BYTES
            ? null
            : encoding === 'br'
              ? brotliCompressSync(body, {
                  params: {
                    [constants.BROTLI_PARAM_QUALITY]: 11,
                    [constants.BROTLI_PARAM_SIZE_HINT]: body.length,
                  },
                })
              : gzipSync(body, { level: 9 }),
        () => null,
      );
      cache.set(key, entry);
    }
    return entry;
  };

  return async (request: Request, response: Response, next: NextFunction): Promise<void> => {
    if (request.method !== 'GET' && request.method !== 'HEAD') return next();
    const type = TYPES[path.extname(request.path)];
    const encoding = pickEncoding(request.headers['accept-encoding']);
    if (!type || !encoding) return next();
    // Только файлы внутри каталога сборки: «..» и абсолютные пути отсекаются.
    const file = path.resolve(root, `.${decodeURIComponent(request.path)}`);
    if (!file.startsWith(root + path.sep)) return next();
    const body = await compressed(file, encoding);
    if (!body) return next();
    response.setHeader('Content-Type', type);
    response.setHeader('Content-Encoding', encoding);
    response.setHeader('Vary', 'Accept-Encoding');
    response.setHeader('Cache-Control', ASSET_CACHE_CONTROL);
    response.setHeader('Content-Length', String(body.length));
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    response.end(body);
  };
}
