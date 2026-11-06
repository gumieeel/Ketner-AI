import assert from 'node:assert/strict';
import { setRolloutForTests } from './rollout.js';
import { AUTOMATION_PLAN } from '../billing/automation-subscription.js';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { IMAGE_MODELS, imageDailyLimit } from '../images/models.js';
import { CODE_LIMITS } from './code-limits.js';
import { modelRegistry } from '../ai/model-registry.js';
import { TRIAL_DAYS, typicalRequestCredits } from './credits.js';
import { PLAN_ENTITLEMENTS, TRIAL_CREDITS } from './entitlement.js';
import { packListStars } from './margin.js';
import { draftQuote } from '../builder/service.js';
import { ANALYSIS_STAGES, estimateStages, type AnalysisMode } from '../discovery/model-policy.js';
import { realModelName } from '../discovery/service.js';
import { PLATFORM_LIMITS } from './discovery-limits.js';
import {
  CREDIT_PACKS,
  CREDIT_PACK_VALID_DAYS,
  CRYPTO_PACK_BONUS_RATE,
  packCryptoBonusCredits,
} from './pricing.js';

/**
 * Сайт показывает лимиты и пакеты кредитов до оплаты (apps/web/.../plan-facts.json). Если число на
 * сайте разойдётся с тем, что сервер действительно применяет, человек заплатит за одно, а получит
 * другое. Тест держит их одинаковыми, включая примеры «на сколько запросов хватит кредитов».
 */

interface Example {
  model: string;
  name: string;
  requestCredits: number;
  requests: number;
}

interface LevelFacts {
  messagesPerDay: number;
  requestsPerMinute: number;
  requestsPerHour: number;
  tokensPerHour: number;
  tokensPerDay: number;
  concurrency: number;
  maxAnswerTokens: number;
  imagesPerDay: Record<string, number>;
  codeRunsPerDay: number;
  codeRunBudgetUsd: number;
  api: boolean;
}

interface Facts {
  trial: { credits: number; days: number; examples: Example[] };
  packValidDays: number;
  cryptoBonusRate: number;
  /** Цена обычного запроса к моделям из таблицы на главной, кредиты. */
  modelPrices: Record<string, number>;
  levels: { free: LevelFacts; credits: LevelFacts };
  packs: Array<{
    id: string;
    priceUsd: number;
    credits: number;
    cryptoBonusCredits: number;
    stars: number;
    examples: Example[];
  }>;
  platform: {
    limits: unknown;
    prices: Record<string, unknown>;
  };
}

const factsPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../web/src/features/billing/plan-facts.json',
);

function checkExamples(label: string, credits: number, examples: Example[]): void {
  assert.ok(examples.length > 0, `${label}: примеры запросов есть`);
  for (const example of examples) {
    const model = modelRegistry.get(example.model);
    assert.ok(model, `${label}: нет модели ${example.model}`);
    const price = typicalRequestCredits(model, 'standard');
    assert.equal(example.name, model.name, `${label}: название ${example.model}`);
    assert.equal(example.requestCredits, price, `${label}: цена запроса ${example.model}`);
    assert.equal(
      example.requests,
      Math.floor(credits / price),
      `${label}: запросов ${example.model} на ${credits} кредитов`,
    );
  }
}

test('лимиты и пакеты кредитов на сайте совпадают с сервером', (t) => {
  if (!existsSync(factsPath)) {
    t.skip('исходники сайта недоступны в этом окружении');
    return;
  }
  const facts = JSON.parse(readFileSync(factsPath, 'utf8')) as Facts;

  // Пробные кредиты
  assert.equal(facts.trial.credits, TRIAL_CREDITS, 'пробные кредиты');
  assert.equal(facts.trial.days, TRIAL_DAYS, 'срок пробных кредитов');
  checkExamples('trial', TRIAL_CREDITS, facts.trial.examples);
  const astra = facts.trial.examples.find((e) => e.model === 'gpt-6-astra');
  assert.equal(astra?.requests, 1, 'пробных кредитов хватает ровно на один запрос GPT-6 Astra');

  // Цены запросов в таблице моделей на главной
  for (const [id, price] of Object.entries(facts.modelPrices)) {
    const model = modelRegistry.get(id);
    assert.ok(model, `modelPrices: нет модели ${id}`);
    assert.equal(price, typicalRequestCredits(model, 'standard'), `modelPrices: цена ${id}`);
  }

  // Условия пакетов
  assert.equal(facts.packValidDays, CREDIT_PACK_VALID_DAYS, 'срок кредитов пакета');
  assert.equal(facts.cryptoBonusRate, CRYPTO_PACK_BONUS_RATE, 'бонус за крипту');

  // Технические лимиты: Free — до первой покупки, credits — пока остались купленные кредиты
  for (const [level, code] of [
    ['free', 'free'],
    ['credits', 'ultra'],
  ] as const) {
    const site = facts.levels[level];
    const server = PLAN_ENTITLEMENTS[level];
    assert.equal(site.messagesPerDay, server.requestsPerDay, `${level}: сообщений в сутки`);
    assert.equal(site.requestsPerMinute, server.requestsPerMinute, `${level}: запросов в минуту`);
    assert.equal(site.requestsPerHour, server.requestsPerHour, `${level}: запросов в час`);
    assert.equal(site.tokensPerHour, server.tokensPerHour, `${level}: токенов в час`);
    assert.equal(site.tokensPerDay, server.tokensPerDay, `${level}: токенов в сутки`);
    assert.equal(site.concurrency, server.maxConcurrency, `${level}: параллельных запросов`);
    assert.equal(site.maxAnswerTokens, server.maxTokens, `${level}: потолок ответа`);
    assert.equal(site.codeRunsPerDay, CODE_LIMITS[code].runsPerDay, `${level}: запусков Code`);
    assert.equal(
      site.codeRunBudgetUsd,
      CODE_LIMITS[code].maxRunCostUsd,
      `${level}: бюджет запуска`,
    );
    assert.equal(site.api, level === 'credits', `${level}: API-ключи — после покупки`);

    const siteImages = Object.entries(site.imagesPerDay).sort();
    const serverImages = IMAGE_MODELS.map(
      (model) => [model.id, imageDailyLimit(model, level)] as const,
    )
      .filter(([, limit]) => limit > 0)
      .sort();
    assert.deepEqual(siteImages, serverImages, `${level}: картинки в сутки`);
  }

  // Пакеты: те же id, цены, кредиты, цена в звёздах и бонус за крипту, что выставляет сервер
  assert.deepEqual(
    facts.packs.map((pack) => pack.id),
    CREDIT_PACKS.map((pack) => pack.id),
    'набор пакетов',
  );
  for (const pack of CREDIT_PACKS) {
    const site = facts.packs.find((p) => p.id === pack.id)!;
    assert.equal(site.priceUsd, pack.priceUsd, `${pack.id}: цена`);
    assert.equal(site.credits, pack.credits, `${pack.id}: кредитов`);
    assert.equal(site.cryptoBonusCredits, packCryptoBonusCredits(pack), `${pack.id}: бонус`);
    assert.equal(site.stars, packListStars(pack), `${pack.id}: звёзд`);
    checkExamples(pack.id, pack.credits, site.examples);
  }
});

test('лимиты и цены платформы решений на сайте совпадают с сервером', (t) => {
  if (!existsSync(factsPath)) {
    t.skip('исходники сайта недоступны в этом окружении');
    return;
  }
  // Сайт показывает цены production: учебный помощник выключен (STUDY_ASSISTANT_ENABLED).
  setRolloutForTests({ studyAssistant: false });
  t.after(() => setRolloutForTests(null));
  const facts = JSON.parse(readFileSync(factsPath, 'utf8')) as Facts;
  assert.deepEqual(facts.platform.limits, PLATFORM_LIMITS, 'лимиты: services/discovery-limits.ts');

  const quote = (
    mode: AnalysisMode,
    stages: readonly ('context' | 'discovery' | 'plan')[],
    modelId: string,
  ) => {
    const estimate = estimateStages(mode, stages, 'ru');
    return {
      model: realModelName(modelId),
      typicalCredits: estimate.typicalCredits,
      maxCredits: estimate.maxCredits,
    };
  };
  const draft = draftQuote('ru');
  assert.deepEqual(facts.platform.prices, {
    freeModel: realModelName('ketner-mini'),
    analysisPaid: quote('paid', ANALYSIS_STAGES, 'ketner-pro'),
    analysisDeep: quote('deep', ANALYSIS_STAGES, 'claude-sonnet-5.5'),
    planPaid: quote('paid', ['plan'], 'ketner-pro'),
    planDeep: quote('deep', ['plan'], 'claude-sonnet-5.5'),
    assistantDraft: {
      model: draft.model,
      typicalCredits: draft.typicalCredits,
      maxCredits: draft.maxCredits,
    },
  });
});

test('цена планов на сайте не зависит от включения учебного помощника', (t) => {
  if (!existsSync(factsPath)) {
    t.skip('исходники сайта недоступны в этом окружении');
    return;
  }
  const facts = JSON.parse(readFileSync(factsPath, 'utf8')) as Facts;
  t.after(() => setRolloutForTests(null));
  for (const studyAssistant of [false, true]) {
    setRolloutForTests({ studyAssistant });
    for (const [key, mode, modelId] of [
      ['planPaid', 'paid', 'ketner-pro'],
      ['planDeep', 'deep', 'claude-sonnet-5.5'],
    ] as const) {
      const estimate = estimateStages(mode, ['plan'], 'ru');
      assert.deepEqual(
        facts.platform.prices[key],
        {
          model: realModelName(modelId),
          typicalCredits: estimate.typicalCredits,
          maxCredits: estimate.maxCredits,
        },
        `${key}, учебный помощник ${studyAssistant ? 'включён' : 'выключен'}`,
      );
    }
  }
});

test('подписка «Автоматизации» на сайте совпадает с сервером', (t) => {
  if (!existsSync(factsPath)) {
    t.skip('исходники сайта недоступны в этом окружении');
    return;
  }
  const facts = JSON.parse(readFileSync(factsPath, 'utf8')) as { automation: unknown };
  assert.deepEqual(facts.automation, AUTOMATION_PLAN, 'billing/automation-subscription.ts');
});
