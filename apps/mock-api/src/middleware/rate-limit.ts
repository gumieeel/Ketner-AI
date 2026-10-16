import { BlockList, isIP } from 'node:net';
import type { Request } from 'express';

/**
 * Диапазоны Cloudflare (https://www.cloudflare.com/ips/). Заголовку CF-Connecting-IP верим только
 * когда соединение действительно пришло с адреса Cloudflare: иначе, обратившись к серверу напрямую
 * (адрес *.onrender.com), его подставил бы кто угодно и обходил лимиты по IP.
 */
const CLOUDFLARE_V4 = [
  '173.245.48.0/20',
  '103.21.244.0/22',
  '103.22.200.0/22',
  '103.31.4.0/22',
  '141.101.64.0/18',
  '108.162.192.0/18',
  '190.93.240.0/20',
  '188.114.96.0/20',
  '197.234.240.0/22',
  '198.41.128.0/17',
  '162.158.0.0/15',
  '104.16.0.0/13',
  '104.24.0.0/14',
  '172.64.0.0/13',
  '131.0.72.0/22',
];
const CLOUDFLARE_V6 = [
  '2400:cb00::/32',
  '2606:4700::/32',
  '2803:f800::/32',
  '2405:b500::/32',
  '2405:8100::/32',
  '2a06:98c0::/29',
  '2c0f:f248::/32',
];

const cloudflare = new BlockList();
for (const range of CLOUDFLARE_V4) {
  const [net, prefix] = range.split('/');
  cloudflare.addSubnet(net, Number(prefix), 'ipv4');
}
for (const range of CLOUDFLARE_V6) {
  const [net, prefix] = range.split('/');
  cloudflare.addSubnet(net, Number(prefix), 'ipv6');
}

function normalizeIp(raw: string | undefined): string {
  if (!raw) return 'unknown';
  const value = raw.trim();
  return value.startsWith('::ffff:') && isIP(value.slice(7)) === 4 ? value.slice(7) : value;
}

export function isCloudflareIp(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return cloudflare.check(ip, 'ipv4');
  if (family === 6) return cloudflare.check(ip, 'ipv6');
  return false;
}

/**
 * Настоящий адрес клиента для лимитов. `request.ip` уже учитывает `trust proxy` (балансировщик
 * Render); если это адрес Cloudflare — берём CF-Connecting-IP, который Cloudflare ставит сам.
 */
export function clientIp(request: Request): string {
  const ip = normalizeIp(request.ip ?? request.socket?.remoteAddress);
  if (isCloudflareIp(ip)) {
    const header = request.headers['cf-connecting-ip'];
    const forwarded = normalizeIp(Array.isArray(header) ? header[0] : header);
    if (isIP(forwarded)) return forwarded;
  }
  return ip;
}

/**
 * Скользящее окно в памяти процесса. Для одного инстанса этого достаточно; при нескольких
 * инстансах лимит действует на каждый отдельно (пропорционально мягче), но не отключается.
 */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly windowMs: number,
    private readonly max: number,
    private readonly now: () => number = Date.now,
  ) {}

  private recent(key: string): number[] {
    const since = this.now() - this.windowMs;
    const list = (this.hits.get(key) ?? []).filter((time) => time > since);
    if (list.length === 0) this.hits.delete(key);
    else this.hits.set(key, list);
    return list;
  }

  /** Лимит уже исчерпан (без учёта текущего запроса). */
  isLimited(key: string): boolean {
    return this.recent(key).length >= this.max;
  }

  /** Засчитать попытку. */
  record(key: string): void {
    const list = this.recent(key);
    list.push(this.now());
    this.hits.set(key, list);
    if (this.hits.size > 50_000) this.sweep();
  }

  /** Засчитать и сказать, превышен ли лимит этим запросом. */
  hit(key: string): boolean {
    if (this.isLimited(key)) return true;
    this.record(key);
    return false;
  }

  reset(key: string): void {
    this.hits.delete(key);
  }

  /** Через сколько секунд освободится место в окне. */
  retryAfterSec(key: string): number {
    const list = this.recent(key);
    if (list.length < this.max) return 0;
    return Math.max(1, Math.ceil((list[0] + this.windowMs - this.now()) / 1000));
  }

  private sweep(): void {
    for (const key of [...this.hits.keys()]) this.recent(key);
  }
}
