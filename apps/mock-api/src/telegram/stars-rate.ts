/**
 * Курс Telegram Stars к доллару и цены тарифов в звёздах.
 *
 * Официального API курса у Telegram нет: звёзды привязаны к доллару, и их рыночная цена — это
 * цена покупки на Fragment (около $0.015 за звезду). Сервис раз в час берёт курс, посчитанный по
 * сделкам на Fragment, проверяет, что он свежий и правдоподобный, и пересчитывает цены. Если
 * источник недоступен или устарел, используется STARS_USD_RATE (по умолчанию 0.015).
 */

export interface StarsRate {
  usdPerStar: number;
  source: 'fragment' | 'config';
  updatedAt: string;
}

const DEFAULT_FEED = 'https://bes-dev.github.io/telegram_stars_rates/api.json';
const REFRESH_MS = 60 * 60 * 1000;
/** Курс из источника старше этого считается устаревшим. */
const MAX_FEED_AGE_MS = 14 * 24 * 60 * 60 * 1000;
/** Границы правдоподобия: всё, что вне их, — сбой источника, а не курс. */
const MIN_RATE = 0.008;
const MAX_RATE = 0.03;

function configuredRate(): number {
  const raw = Number(process.env.STARS_USD_RATE);
  return Number.isFinite(raw) && raw >= MIN_RATE && raw <= MAX_RATE ? raw : 0.015;
}

export class StarsRateService {
  private current: StarsRate;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly options: {
      feedUrl?: string;
      fetchImpl?: typeof fetch;
      now?: () => number;
    } = {},
  ) {
    this.current = {
      usdPerStar: configuredRate(),
      source: 'config',
      updatedAt: new Date(this.now()).toISOString(),
    };
  }

  private now(): number {
    return this.options.now ? this.options.now() : Date.now();
  }

  get rate(): StarsRate {
    return { ...this.current };
  }

  /** Цена в звёздах для суммы в долларах: округление вверх до 10, чтобы цена читалась легко. */
  quote(priceUsd: number): number {
    if (!(priceUsd > 0)) return 0;
    return Math.max(10, Math.ceil(priceUsd / this.current.usdPerStar / 10) * 10);
  }

  /** Сколько долларов стоят звёзды по текущему курсу (для подсказки «≈ $9»). */
  toUsd(stars: number): number {
    return Math.round(stars * this.current.usdPerStar * 100) / 100;
  }

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
      if (Number.isFinite(rate) && rate >= MIN_RATE && rate <= MAX_RATE && fresh) {
        this.current = {
          usdPerStar: rate,
          source: 'fragment',
          updatedAt: new Date(stamp).toISOString(),
        };
        return this.rate;
      }
    } catch (error) {
      console.warn(
        '[stars-rate] источник курса недоступен, используем настройку:',
        (error as Error).message,
      );
    }
    this.current = {
      usdPerStar: configuredRate(),
      source: 'config',
      updatedAt: new Date(this.now()).toISOString(),
    };
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
