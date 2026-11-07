import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_CATALOG,
  DEFAULT_PRICING_CONFIG,
  catalogItemSchema,
  type PricingConfig,
} from './catalog.js';
import {
  combinedEstimate,
  deriveWorkItems,
  estimate,
  validateComplexity,
  type OpportunityInput,
} from './engine.js';
import { ceilTo, mulDiv } from './money.js';
import { monthlyCosts } from './usage.js';

const known = { monthlyRequests: 600, missing: [] };

/** Простые числа, чтобы расчёт проверялся вручную. */
const CONFIG: PricingConfig = {
  ...DEFAULT_PRICING_CONFIG,
  billableHourlyRateKzt: 10_000,
  complexityMultipliers: { simple: 1, medium: 1.5, complex: 2.2 },
  riskReservePercent: 10,
  testingPercent: 0,
  uncertaintyPercentPerUnknown: 10,
  uncertaintyMaxPercent: 30,
  minimumImplementationPriceKzt: 0,
  roundingIncrementKzt: 1,
  workingHoursPerDay: 6,
  customerFeedbackDays: [0, 0],
};

const opp = (
  id: string,
  work: OpportunityInput['workItems'],
  extra: Partial<OpportunityInput> = {},
) =>
  ({
    id,
    title: id,
    solutionType: 'assistant',
    workItems: work,
    unknowns: [],
    assumptions: [],
    derived: false,
    ...extra,
  }) satisfies OpportunityInput;

const sheets = {
  capability: 'google_sheets_integration',
  quantity: 1,
  complexity: 'simple' as const,
  reason: '',
};

test('money: mulDiv точен и округляет половину вверх, ceilTo — вверх', () => {
  assert.equal(mulDiv(150, 10_000, 100), 15_000);
  assert.equal(mulDiv(1, 1, 2), 1);
  assert.equal(mulDiv(1, 1, 3), 0);
  assert.equal(mulDiv(9_000_000_000, 9_000, 1_000), 81_000_000_000);
  assert.equal(ceilTo(60_001, 5_000), 65_000);
  assert.equal(ceilTo(60_000, 5_000), 60_000);
  assert.throws(() => mulDiv(0.5, 1, 1));
});

test('каталог по умолчанию проходит схему', () => {
  for (const item of DEFAULT_CATALOG) assert.ok(catalogItemSchema.safeParse(item).success, item.id);
});

test('простая смета: часы × ставка, проект один раз, резерв только к ожидаемой и максимуму', () => {
  const result = estimate([opp('a', [sheets])], DEFAULT_CATALOG, CONFIG, known);
  // Таблицы 2/4/6 ч + подготовка 2/3/5 + запуск 2/3/6 = 6/10/17 ч.
  assert.deepEqual(result.hours, { min: 600, expected: 1000, max: 1700 });
  assert.deepEqual(result.laborKzt, { min: 60_000, expected: 100_000, max: 170_000 });
  assert.deepEqual(result.riskReserveKzt, { min: 0, expected: 10_000, max: 17_000 });
  assert.deepEqual(result.priceKzt, { min: 60_000, expected: 110_000, max: 187_000 });
  assert.equal(result.confidence, 'high');
  assert.equal(result.requiresManualReview, false);
});

test('сложность: множитель и приведение ярлыка модели в диапазон каталога', () => {
  const sheetsItem = DEFAULT_CATALOG.find((item) => item.id === 'google_sheets_integration')!;
  assert.equal(validateComplexity(sheetsItem, 'complex'), 'medium');
  assert.equal(validateComplexity(sheetsItem, null), 'simple');
  const medium = estimate(
    [opp('a', [{ ...sheets, complexity: 'medium' }])],
    DEFAULT_CATALOG,
    CONFIG,
    known,
  );
  const line = medium.lines.find((item) => item.capabilityId === 'google_sheets_integration')!;
  assert.deepEqual(line.hours, { min: 300, expected: 600, max: 900 });
  const complex = estimate(
    [
      opp('a', [
        { capability: 'ai_message_processing', quantity: 1, complexity: 'complex', reason: '' },
      ]),
    ],
    DEFAULT_CATALOG,
    CONFIG,
    known,
  );
  const ai = complex.lines.find((item) => item.capabilityId === 'ai_message_processing')!;
  assert.deepEqual(ai.hours, { min: 880, expected: 1320, max: 2200 });
});

test('количество ограничено каталогом, тестирование — процент от работ', () => {
  const result = estimate(
    [opp('a', [{ ...sheets, quantity: 50 }])],
    DEFAULT_CATALOG,
    { ...CONFIG, testingPercent: 10 },
    known,
  );
  const line = result.lines.find((item) => item.capabilityId === 'google_sheets_integration')!;
  assert.equal(line.quantity, 3);
  assert.deepEqual(result.testingHours, { min: 60, expected: 120, max: 180 });
});

test('общая смета не считает общие работы дважды и показывает экономию', () => {
  const a = opp('a', [
    sheets,
    { capability: 'telegram_integration', quantity: 1, complexity: 'medium', reason: '' },
  ]);
  const b = opp('b', [
    sheets,
    { capability: 'report_generation', quantity: 1, complexity: 'simple', reason: '' },
  ]);
  const one = estimate([a], DEFAULT_CATALOG, CONFIG, known);
  const two = estimate([b], DEFAULT_CATALOG, CONFIG, known);
  const both = combinedEstimate([a, b], [one, two], DEFAULT_CATALOG, CONFIG, known);
  assert.equal(
    both.lines.filter((line) => line.capabilityId === 'google_sheets_integration').length,
    1,
  );
  assert.equal(both.lines.filter((line) => line.projectTask).length, 2);
  const sheetsLine = both.lines.find((line) => line.capabilityId === 'google_sheets_integration')!;
  assert.deepEqual(sheetsLine.sharedBy, ['a', 'b']);
  assert.ok(both.sharedSavingsKzt! > 0);
  assert.equal(
    both.sharedSavingsKzt,
    one.priceKzt!.expected + two.priceKzt!.expected - both.priceKzt!.expected,
  );
});

test('неподдерживаемая и неизвестная работа: без цены за неё, низкая уверенность, проверка', () => {
  const result = estimate(
    [
      opp('a', [
        sheets,
        { capability: 'one_c_integration', quantity: 1, complexity: 'complex', reason: '' },
        { capability: 'teleport', quantity: 1, complexity: 'simple', reason: 'выдумка' },
      ]),
    ],
    DEFAULT_CATALOG,
    CONFIG,
    known,
  );
  assert.equal(
    result.lines.some((line) => line.capabilityId === 'one_c_integration'),
    false,
  );
  assert.deepEqual(
    result.excluded.map((item) => [item.capabilityId, item.reason]),
    [
      ['one_c_integration', 'not_offered'],
      ['teleport', 'unknown_capability'],
    ],
  );
  assert.equal(result.confidence, 'low');
  assert.equal(result.requiresManualReview, true);
  assert.ok(result.priceKzt);
});

test('нет ни одной работы из каталога — цены нет, нужна техническая проверка', () => {
  const result = estimate(
    [opp('a', [{ capability: 'kaspi_integration', quantity: 1, complexity: null, reason: '' }])],
    DEFAULT_CATALOG,
    CONFIG,
    known,
  );
  assert.equal(result.priceKzt, null);
  assert.equal(result.lines.length, 0);
  assert.equal(result.technicalVerificationRequired, true);
});

test('неизвестные и ручная проверка расширяют только максимум, с потолком', () => {
  const base = estimate([opp('a', [sheets])], DEFAULT_CATALOG, CONFIG, known);
  const unsure = estimate(
    [opp('a', [sheets], { unknowns: ['где каталог', 'сколько заказов'] })],
    DEFAULT_CATALOG,
    CONFIG,
    known,
  );
  assert.equal(unsure.uncertaintyBp, 2_000);
  assert.equal(unsure.hours.expected, base.hours.expected);
  assert.equal(unsure.hours.max, mulDiv(base.hours.max, 12_000, 10_000));
  assert.equal(unsure.confidence, 'medium');
  const many = estimate(
    [opp('a', [sheets], { unknowns: ['1', '2', '3', '4', '5'] })],
    DEFAULT_CATALOG,
    CONFIG,
    known,
  );
  assert.equal(many.uncertaintyBp, 3_000);
  assert.equal(many.confidence, 'low');
  const whatsapp = estimate(
    [
      opp('a', [
        { capability: 'whatsapp_business_integration', quantity: 1, complexity: null, reason: '' },
      ]),
    ],
    DEFAULT_CATALOG,
    CONFIG,
    known,
  );
  assert.equal(whatsapp.requiresManualReview, true);
  assert.equal(whatsapp.duration.externalApproval, true);
  assert.deepEqual(whatsapp.unknownDirectCosts, ['Подключение WhatsApp Business']);
});

test('минимальная цена и округление вверх', () => {
  const result = estimate([opp('a', [sheets])], DEFAULT_CATALOG, DEFAULT_PRICING_CONFIG, known);
  assert.ok(result.priceKzt!.min >= DEFAULT_PRICING_CONFIG.minimumImplementationPriceKzt);
  for (const value of Object.values(result.priceKzt!)) assert.equal(value % 5_000, 0);
  assert.ok(result.priceKzt!.min <= result.priceKzt!.expected);
  assert.ok(result.priceKzt!.expected <= result.priceKzt!.max);
});

test('сроки: часы / мощность в день + ответы клиента + внешнее одобрение', () => {
  const result = estimate(
    [opp('a', [sheets])],
    DEFAULT_CATALOG,
    { ...CONFIG, customerFeedbackDays: [1, 3] },
    known,
  );
  // 6 ч / 6 = 1 день + 1 + ожидание таблиц 0; 17 ч / 6 → 3 дня + 3 + 1 (доступ к таблице).
  assert.deepEqual(result.duration, {
    workingDaysMin: 2,
    workingDaysMax: 7,
    externalApproval: true,
  });
});

test('выведенные из требований работы: низкая уверенность', () => {
  const work = deriveWorkItems(['text_generation', 'crm', 'image_generation']);
  assert.deepEqual(
    work.map((item) => item.capability),
    ['ai_message_processing', 'crm_integration'],
  );
  const result = estimate([opp('a', work, { derived: true })], DEFAULT_CATALOG, CONFIG, known);
  assert.equal(result.confidence, 'low');
  assert.equal(result.technicalVerificationRequired, true);
});

test('ежемесячные расходы: подписка, прогноз ИИ по цене реестра, неизвестный объём', () => {
  const result = estimate(
    [
      opp('a', [
        { capability: 'ai_message_processing', quantity: 1, complexity: null, reason: '' },
      ]),
    ],
    DEFAULT_CATALOG,
    CONFIG,
    known,
  );
  const withRate = monthlyCosts(result.lines, 600, { ...CONFIG, usdToKztRate: 500 });
  assert.equal(withRate.recurring[0]!.kind, 'subscription');
  assert.equal(withRate.recurring[0]!.amount.kzt, 7_500);
  assert.equal(withRate.usage.status, 'forecast');
  assert.ok(withRate.usage.aiMicroUsd!.min <= withRate.usage.aiMicroUsd!.expected);
  assert.ok(withRate.usage.aiMicroUsd!.expected <= withRate.usage.aiMicroUsd!.max);
  assert.ok(withRate.usage.aiKzt!.expected > 0);
  const noRate = monthlyCosts(result.lines, 600, CONFIG);
  assert.equal(noRate.recurring[0]!.amount.kzt, null);
  assert.equal(noRate.usage.aiKzt, null);
  const unknown = monthlyCosts(result.lines, null, CONFIG);
  assert.equal(unknown.usage.status, 'volume_unknown');
  assert.equal(unknown.usage.aiMicroUsd, null);
  const noAi = monthlyCosts(
    estimate([opp('a', [sheets])], DEFAULT_CATALOG, CONFIG, known).lines,
    null,
    CONFIG,
  );
  assert.equal(noAi.usage.status, 'not_applicable');
});
