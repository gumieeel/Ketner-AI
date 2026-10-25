import { Router, type Request, type Response } from 'express';
import { config } from '../config.js';
import { defaultCircuitBreaker, type CircuitBreaker } from '../ai/circuit-breaker.js';

/**
 * Публичный статус сервиса: `GET /api/status` для страницы /status.
 *
 * Проверки дешёвые и кэшируются на 30 секунд, чтобы страница статуса не нагружала базу и
 * OpenRouter. Наружу уходят только состояния компонентов: ни балансов, ни адресов, ни текста
 * ошибок. Балансы и метрики остаются в админке.
 */

export type ComponentState = 'operational' | 'degraded' | 'outage' | 'unavailable';

export interface StatusComponent {
  id: 'site' | 'database' | 'models' | 'images' | 'payments' | 'telegram';
  state: ComponentState;
  /** Короткое пояснение для людей, без внутренних подробностей. */
  note?: string;
}

export interface StatusReport {
  state: Exclude<ComponentState, 'unavailable'>;
  checkedAt: string;
  components: StatusComponent[];
}

export interface StatusDeps {
  /** true — база отвечает, false — не отвечает, null — база не настроена. */
  checkDatabase?: () => Promise<boolean | null>;
  /** Ключ OpenRouter: ok, отказ (ключ или баланс), сетевая ошибка, ключ не задан. */
  checkModels?: () => Promise<'ok' | 'rejected' | 'unreachable' | 'unconfigured'>;
  breaker?: Pick<CircuitBreaker, 'getAllStatuses'>;
  features?: { images: boolean; crypto: boolean; telegram: boolean };
  now?: () => number;
  cacheMs?: number;
}

const TIMEOUT_MS = 4000;

async function defaultCheckDatabase(): Promise<boolean | null> {
  if (!config.databaseUrl) return null;
  const { queryClient } = await import('../db/client.js');
  try {
    await Promise.race([
      queryClient`select 1`,
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS)),
    ]);
    return true;
  } catch {
    return false;
  }
}

async function defaultCheckModels(): Promise<'ok' | 'rejected' | 'unreachable' | 'unconfigured'> {
  if (!config.openRouterApiKey) return 'unconfigured';
  try {
    // GET /key ничего не стоит и показывает, принимает ли OpenRouter наш ключ.
    const response = await fetch(`${config.openRouterBaseUrl.replace(/\/$/, '')}/key`, {
      headers: { Authorization: `Bearer ${config.openRouterApiKey}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return response.ok ? 'ok' : 'rejected';
  } catch {
    return 'unreachable';
  }
}

const RANK: Record<ComponentState, number> = {
  operational: 0,
  unavailable: 0,
  degraded: 1,
  outage: 2,
};

/** Общее состояние — по самому плохому из основных компонентов (сайт, база, модели). */
export function overallState(components: StatusComponent[]): StatusReport['state'] {
  const core = components.filter((c) => ['site', 'database', 'models'].includes(c.id));
  const worst = core.reduce((max, c) => Math.max(max, RANK[c.state]), 0);
  return worst === 2 ? 'outage' : worst === 1 ? 'degraded' : 'operational';
}

export function createStatusRouter(deps: StatusDeps = {}): Router {
  const router = Router();
  const now = deps.now ?? Date.now;
  const cacheMs = deps.cacheMs ?? 30_000;
  const checkDatabase = deps.checkDatabase ?? defaultCheckDatabase;
  const checkModels = deps.checkModels ?? defaultCheckModels;
  const breaker = deps.breaker ?? defaultCircuitBreaker;
  const features = deps.features ?? {
    images: Boolean(config.images.cloudflareAccountId && config.images.cloudflareApiToken),
    crypto: Boolean(config.cryptoCloudApiKey && config.cryptoCloudShopId),
    telegram: Boolean(config.telegramBotToken),
  };

  let cached: { at: number; report: StatusReport } | null = null;
  let pending: Promise<StatusReport> | null = null;

  const build = async (): Promise<StatusReport> => {
    const [database, models] = await Promise.all([checkDatabase(), checkModels()]);
    // Предохранитель открыт — модель временно отвечает запасной (ключи «openrouter:<модель>»).
    const trippedModels = breaker
      .getAllStatuses()
      .filter((s) => s.state === 'open' && s.provider.includes(':')).length;

    const components: StatusComponent[] = [{ id: 'site', state: 'operational' }];

    components.push(
      database === null
        ? {
            id: 'database',
            state: 'degraded',
            note: 'Временное хранилище: история может не сохраниться',
          }
        : database
          ? { id: 'database', state: 'operational' }
          : { id: 'database', state: 'outage', note: 'База данных не отвечает' },
    );

    if (models === 'ok') {
      components.push(
        trippedModels > 0
          ? {
              id: 'models',
              state: 'degraded',
              note: `Часть моделей (${trippedModels}) временно отвечает через запасные`,
            }
          : { id: 'models', state: 'operational' },
      );
    } else if (models === 'unreachable') {
      components.push({
        id: 'models',
        state: 'degraded',
        note: 'Поставщик моделей отвечает с ошибками',
      });
    } else {
      components.push({
        id: 'models',
        state: 'outage',
        note: 'Поставщик моделей не принимает запросы',
      });
    }

    components.push(
      features.images
        ? models === 'rejected' || models === 'unconfigured'
          ? // Подсказки переводятся и проверяются моделью через того же поставщика.
            { id: 'images', state: 'degraded', note: 'Не работает проверка подсказок' }
          : { id: 'images', state: 'operational' }
        : { id: 'images', state: 'unavailable', note: 'Генерация картинок отключена' },
    );
    components.push(
      features.crypto || features.telegram
        ? { id: 'payments', state: 'operational' }
        : { id: 'payments', state: 'unavailable', note: 'Приём оплаты отключён' },
    );
    components.push(
      features.telegram
        ? { id: 'telegram', state: 'operational' }
        : { id: 'telegram', state: 'unavailable', note: 'Бот отключён' },
    );

    return {
      state: overallState(components),
      checkedAt: new Date(now()).toISOString(),
      components,
    };
  };

  router.get('/status', async (_request: Request, response: Response) => {
    if (!cached || now() - cached.at >= cacheMs) {
      // Одновременные запросы ждут одну проверку, а не запускают свои.
      pending ??= build().finally(() => {
        pending = null;
      });
      const report = await pending;
      cached = { at: now(), report };
    }
    response.setHeader('Cache-Control', 'no-store');
    response.json(cached.report);
  });

  return router;
}
