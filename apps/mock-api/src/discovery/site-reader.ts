/**
 * Чтение сайта по ссылке из описания задачи (docs/AUTOMATION_PLAN.md, этап A).
 *
 * Сервер сам открывает главную страницу и передаёт модели её текст (название, описание, видимый
 * текст), чтобы человеку не пришлось пересказывать свой бизнес. Защита от запросов во внутреннюю
 * сеть (SSRF): только http(s) на портах 80 и 443; адрес проверяется при каждом соединении (lookup
 * сокета, а не отдельный DNS-запрос заранее — так нельзя подменить адрес между проверкой и
 * запросом); внутренние, служебные и зарезервированные адреса запрещены; не больше 3 переадресаций,
 * каждая проверяется заново; ответ — не больше 1,5 МБ и 8 секунд.
 *
 * Текст сайта — данные, а не инструкции: в промпте он лежит внутри <site_data>, как текст человека.
 */

import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

export type SiteResult =
  | { ok: true; url: string; title: string; description: string; text: string }
  | { ok: false; url: string; reason: SiteFailure };

export type SiteFailure =
  'blocked' | 'unreachable' | 'not_html' | 'too_large' | 'empty' | 'http_error';

export interface SiteReaderOptions {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  /** Сколько символов текста отдавать модели. */
  maxChars?: number;
  /** Только для тестов: разрешить локальные адреса и любой порт. */
  allowPrivate?: boolean;
}

const DEFAULTS = { timeoutMs: 8_000, maxBytes: 1_500_000, maxRedirects: 3, maxChars: 6_000 };

/** Адрес нельзя открывать с сервера: внутренняя сеть, сам сервер, служебные диапазоны. */
export function isBlockedAddress(address: string): boolean {
  if (net.isIPv4(address)) {
    const [a = 0, b = 0, c = 0] = address.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0 && c === 0) ||
      (a === 192 && b === 0 && c === 2) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113) ||
      a >= 224
    );
  }
  if (net.isIPv6(address)) {
    const lower = address.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (mapped) return isBlockedAddress(mapped[1]!);
    return (
      lower === '::' ||
      lower === '::1' ||
      lower.startsWith('fc') ||
      lower.startsWith('fd') ||
      /^fe[89ab]/.test(lower) ||
      lower.startsWith('ff') ||
      lower.startsWith('2001:db8') ||
      lower.startsWith('64:ff9b')
    );
  }
  return true;
}

type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

/** lookup сокета: адрес проверяется в момент соединения. */
function safeLookup(allowPrivate: boolean) {
  return (hostname: string, options: object, callback: LookupCallback) => {
    dnsLookup(hostname, { ...options, all: true }, (error, addresses) => {
      if (error) return callback(error, '');
      const list = addresses as LookupAddress[];
      if (
        !allowPrivate &&
        (list.length === 0 || list.some((item) => isBlockedAddress(item.address)))
      ) {
        const blocked = new Error('blocked address') as NodeJS.ErrnoException;
        blocked.code = 'EBLOCKED';
        return callback(blocked, '');
      }
      if ((options as { all?: boolean }).all) return callback(null, list);
      const first = list[0]!;
      callback(null, first.address, first.family);
    });
  };
}

interface RawResponse {
  status: number;
  location: string | null;
  contentType: string;
  body: Buffer | null;
  tooLarge: boolean;
}

function request(url: URL, options: Required<SiteReaderOptions>): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http;
    const req = client.request(
      url,
      {
        method: 'GET',
        lookup: safeLookup(options.allowPrivate) as never,
        timeout: options.timeoutMs,
        headers: {
          'User-Agent': 'KetnerBot/1.0 (+https://ketner.org)',
          Accept: 'text/html,application/xhtml+xml,text/plain;q=0.8',
          'Accept-Encoding': 'identity',
          'Accept-Language': 'ru,en;q=0.8',
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const contentType = String(res.headers['content-type'] ?? '');
        const location = typeof res.headers.location === 'string' ? res.headers.location : null;
        if (status >= 300 && status < 400) {
          res.resume();
          resolve({ status, location, contentType, body: null, tooLarge: false });
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > options.maxBytes) {
            req.destroy();
            resolve({ status, location, contentType, body: null, tooLarge: true });
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () =>
          resolve({ status, location, contentType, body: Buffer.concat(chunks), tooLarge: false }),
        );
        res.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

function allowedUrl(url: URL, anyPort: boolean): boolean {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (url.username || url.password) return false;
  return anyPort || url.port === '' || url.port === '80' || url.port === '443';
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  laquo: '«',
  raquo: '»',
  mdash: '—',
  ndash: '–',
  hellip: '…',
};

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === '#') {
      const point =
        code[1]?.toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(point) && point > 0 && point < 0x110000
        ? String.fromCodePoint(point)
        : '';
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

const clean = (value: string) => decodeEntities(value).replace(/\s+/g, ' ').trim();

function meta(html: string, name: string): string {
  const pattern = new RegExp(
    `<meta[^>]+(?:name|property)=["']${name}["'][^>]*content=["']([^"']*)["']|<meta[^>]+content=["']([^"']*)["'][^>]*(?:name|property)=["']${name}["']`,
    'i',
  );
  const match = pattern.exec(html);
  return clean(match?.[1] ?? match?.[2] ?? '');
}

/** Название, описание и видимый текст страницы — без скриптов, стилей и разметки. */
export function extractPage(html: string, maxChars: number) {
  const title = clean(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '');
  const description = meta(html, 'description') || meta(html, 'og:description');
  const body = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|template|iframe|head)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(
      /<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article|\/header|\/footer)\b[^>]*>/gi,
      '\n',
    )
    .replace(/<[^>]+>/g, ' ');
  const text = decodeEntities(body)
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
  return {
    title: title.slice(0, 200),
    description: description.slice(0, 400),
    text: text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text,
  };
}

function decode(body: Buffer, contentType: string): string {
  const head = body.subarray(0, 2048).toString('latin1');
  const charset = (
    /charset=["']?([\w-]+)/i.exec(contentType)?.[1] ??
    /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1] ??
    'utf-8'
  ).toLowerCase();
  try {
    return new TextDecoder(charset).decode(body);
  } catch {
    return new TextDecoder('utf-8').decode(body);
  }
}

export async function readSite(
  address: string,
  overrides: SiteReaderOptions = {},
): Promise<SiteResult> {
  const options = { ...DEFAULTS, allowPrivate: false, ...overrides };
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return { ok: false, url: address, reason: 'unreachable' };
  }
  for (let hop = 0; hop <= options.maxRedirects; hop += 1) {
    if (!allowedUrl(url, options.allowPrivate))
      return { ok: false, url: url.toString(), reason: 'blocked' };
    if (
      !options.allowPrivate &&
      net.isIP(url.hostname.replace(/^\[|\]$/g, '')) &&
      isBlockedAddress(url.hostname.replace(/^\[|\]$/g, ''))
    ) {
      return { ok: false, url: url.toString(), reason: 'blocked' };
    }
    let response: RawResponse;
    try {
      response = await request(url, options);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      return {
        ok: false,
        url: url.toString(),
        reason: code === 'EBLOCKED' ? 'blocked' : 'unreachable',
      };
    }
    if (response.status >= 300 && response.status < 400) {
      if (!response.location) return { ok: false, url: url.toString(), reason: 'http_error' };
      try {
        url = new URL(response.location, url);
      } catch {
        return { ok: false, url: url.toString(), reason: 'http_error' };
      }
      continue;
    }
    if (response.tooLarge) return { ok: false, url: url.toString(), reason: 'too_large' };
    if (response.status < 200 || response.status >= 300 || !response.body) {
      return { ok: false, url: url.toString(), reason: 'http_error' };
    }
    if (!/text\/html|application\/xhtml|text\/plain/i.test(response.contentType)) {
      return { ok: false, url: url.toString(), reason: 'not_html' };
    }
    const page = extractPage(decode(response.body, response.contentType), options.maxChars);
    if (!page.title && !page.description && page.text.length < 40) {
      return { ok: false, url: url.toString(), reason: 'empty' };
    }
    return { ok: true, url: url.toString(), ...page };
  }
  return { ok: false, url: url.toString(), reason: 'http_error' };
}
