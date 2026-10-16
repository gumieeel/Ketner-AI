/**
 * Курс Telegram Stars к доллару и цены в звёздах.
 *
 * Цена в звёздах считается по официальной цене звёзд в Telegram (services/pricing.ts →
 * STARS_OFFICIAL_USD_PER_STAR: 1 000 ⭐ = $19.99): так тариф за звёзды стоит столько же, сколько
 * пользователь заплатит Telegram за эти звёзды, и это видно рядом с ценой («≈ $25»). Курс можно
 * переопределить переменной STARS_USD_RATE (например, если Telegram изменит прайс).
 *
 * Рыночный курс (сделки на Fragment) раз в час подтягивается только для сравнения: на Fragment и у
 * перекупщиков звёзды дешевле официальных, и если считать цену по нему, звёзд выходит больше, а
 * тариф в звёздах — дороже тарифа картой.
 */

import { STARS_OFFICIAL_USD_PER_STAR } from '../services/pricing.js';

export interface StarsRate {
  /** Курс, по которому считается цена в звёздах, $ за звезду. */
  usdPerStar: number;
  /** official — официальная цена Telegram; config — переопределена STARS_USD_RATE. */
  source: 'official' | 'config';
  updatedAt: string;
  /** Рыночный курс Fragment для сравнения (null — источник недоступен или устарел). */
  market: { usdPerStar: number; updatedAt: string } | null;
}

const DEFAULT_FEED = 'https://bes-dev.github.io/telegram_stars_rates/api.json';
const REFRESH_MS = 60 * 60 * 1000;
/** Курс из источника старше этого считается устаревшим. */
const MAX_FEED_AGE_MS = 14 * 24 * 60 * 60 * 1000;
/** Границы правдоподобия: всё, что вне их, — сбой источника или опечатка в настройке. */
export const MIN_STARS_RATE = 0.008;
export const MAX_STARS_RATE = 0.03;

function plausible(rate: number): boolean {
  return Number.isFinite(rate) && rate >= MIN_STARS_RATE && rate <= MAX_STARS_RATE;
}

function configuredRate(): { usdPerStar: number; source: StarsRate['source'] } {
  const raw = Number(process.env.STARS_USD_RATE);
  return process.env.STARS_USD_RATE && plausible(raw)
    ? { usdPerStar: raw, source: 'config' }
    : { usdPerStar: STARS_OFFICIAL_USD_PER_STAR, source: 'official' };
}

export class StarsRateService {
  private readonly pricing: { usdPerStar: number; source: StarsRate['source'] };
  private readonly createdAt: string;
  private market: StarsRate['market'] = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly options: {
      /** Курс цены (для тестов); по умолчанию — официальный или STARS_USD_RATE. */
      usdPerStar?: number;
      feedUrl?: string;
      fetchImpl?: typeof fetch;
      now?: () => number;
    } = {},
  ) {
    this.pricing =
      options.usdPerStar !== undefined && plausible(options.usdPerStar)
        ? { usdPerStar: options.usdPerStar, source: 'config' }
        : configuredRate();
    this.createdAt = new Date(this.now()).toISOString();
  }

  private now(): number {
    return this.options.now ? this.options.now() : Date.now();
  }

  get rate(): StarsRate {
    return {
      ...this.pricing,
      updatedAt: this.createdAt,
      market: this.market ? { ...this.market } : null,
    };
  }

  /** Цена в звёздах для суммы в долларах: округление вверх до 10, чтобы цена читалась легко. */
  quote(priceUsd: number): number {
    if (!(priceUsd > 0)) return 0;
    return Math.max(10, Math.ceil(priceUsd / this.pricing.usdPerStar / 10) * 10);
  }

  /** Сколько долларов стоят звёзды по курсу цены (для подсказки «≈ $25»). */
  toUsd(stars: number): number {
    return Math.round(stars * this.pricing.usdPerStar * 100) / 100;
  }

  /** Подтянуть рыночный курс Fragment для сравнения. На цену в звёздах он не влияет. */
  async refresh(): Promise<StarsRate> {
    const feedUrl = this.options.feedUrl ?? process.env.STARS_RATE_FEED_URL ?? DEFAULT_FEED;
    try {
      const response = await (this.options.fetchImpl ?? fetch)(feedUrl, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as {
        usdt_per_star?: unknown;
        last_updated?: unknown;
        timestamp?: unknown;
      };
      const rate = Number(data.usdt_per_star);
      const stamp = Date.parse(String(data.last_updated ?? data.timestamp ?? ''));
      const fresh = Number.isFinite(stamp) && this.now() - stamp <= MAX_FEED_AGE_MS;
      this.market =
        plausible(rate) && fresh
          ? { usdPerStar: rate, updatedAt: new Date(stamp).toISOString() }
          : null;
    } catch (error) {
      this.market = null;
      console.warn('[stars-rate] рыночный курс недоступен:', (error as Error).message);
    }
    return this.rate;
  }

  start(): void {
    if (this.timer) return;
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), REFRESH_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

export const starsRateService = new StarsRateService();
