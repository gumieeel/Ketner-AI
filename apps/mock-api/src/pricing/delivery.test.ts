import assert from 'node:assert/strict';
import test from 'node:test';
import { TIERS } from '../services/tiers.js';
import { DEFAULT_CATALOG, DEFAULT_PRICING_CONFIG } from './catalog.js';
import {
  KNOWLEDGE_LIMIT_CHARS,
  catalogInForce,
  deliveryOf,
  priceListFit,
  type DeliveryContext,
} from './delivery.js';
import { estimate, type OpportunityInput } from './engine.js';
import type { StoredEstimate } from './types.js';
import { monthlyCosts } from './usage.js';
import { publicEstimate } from './views.js';

const signals = { monthlyRequests: 600, missing: [] };
const unknownSize: DeliveryContext = { catalogPositions: null, monthlyRequests: 600 };

const work = (...ids: string[]): OpportunityInput['workItems'] =>
  ids.map((capability) => ({ capability, quantity: 1, complexity: null, reason: '' }));

function priced(ids: string[], catalog = catalogInForce(DEFAULT_CATALOG)) {
  return estimate(
    [
      {
        id: 'o1',
        title: 'o1',
        solutionType: 'assistant',
        workItems: work(...ids),
        unknowns: [],
        assumptions: [],
        derived: false,
      },
    ],
    catalog,
    DEFAULT_PRICING_CONFIG,
    signals,
  );
}

function stored(ids: string[]): StoredEstimate {
  const result = priced(ids);
  return {
    id: 'e1',
    analysisId: 'a1',
    generation: 1,
    scope: 'opportunity',
    scopeKey: 'opp:o1',
    opportunityIds: ['o1'],
    pricingVersion: 1,
    fingerprint: 'f',
    opportunityTitles: { o1: 'o1' },
    result,
    monthly: monthlyCosts(result.lines, 600, DEFAULT_PRICING_CONFIG),
    createdAt: '2026-11-16T00:00:00.000Z',
  };
}

test('сам или команда: всё из Ketner — сам; интеграция или обработка заказов — команда', () => {
  const bot = deliveryOf(
    priced(['ai_message_processing', 'website_chat_widget', 'customer_lead_collection']),
    unknownSize,
  );
  assert.equal(bot.kind, 'self_service');
  assert.equal(bot.paidTierRequired, false);
  assert.deepEqual(bot.teamWork, []);

  const sheets = deliveryOf(priced(['ai_message_processing', 'google_sheets_integration']), {
    ...unknownSize,
  });
  assert.equal(sheets.kind, 'team');
  assert.equal(sheets.paidTierRequired, true);
  assert.deepEqual(sheets.teamWork, ['Запись в Google Таблицы']);

  const orders = deliveryOf(priced(['ai_message_processing', 'order_processing']), unknownSize);
  assert.equal(orders.kind, 'team');

  // Работы, придуманной моделью, в каталоге нет — это не «сам», а проверка командой.
  assert.equal(deliveryOf(priced(['ai_message_processing', 'teleport']), unknownSize).kind, 'team');
  // Ни одной работы из каталога — тоже не «сам».
  assert.equal(deliveryOf(priced([]), unknownSize).kind, 'team');
});

test('WhatsApp, Instagram, 1С, Kaspi — «запланировано»: без цены и без оценки команды', () => {
  for (const id of [
    'whatsapp_business_integration',
    'instagram_direct_integration',
    'one_c_integration',
    'kaspi_integration',
  ]) {
    const result = priced(['ai_message_processing', id]);
    const delivery = deliveryOf(result, unknownSize);
    assert.equal(delivery.kind, 'planned', id);
    assert.equal(delivery.tier, null, id);
    assert.equal(delivery.plannedWork.length, 1, id);
  }
  // Даже если в сохранённой версии каталога WhatsApp ещё «делает команда».
  const stale = DEFAULT_CATALOG.map((item) =>
    item.id === 'whatsapp_business_integration' ? { ...item, status: 'custom' as const } : item,
  );
  assert.equal(
    catalogInForce(stale).find((item) => item.id === 'whatsapp_business_integration')!.status,
    'planned',
  );
  // Старая сохранённая смета, где WhatsApp посчитан, тоже «запланировано».
  const old = priced(['ai_message_processing', 'whatsapp_business_integration'], stale);
  assert.ok(old.priceKzt, 'в старой смете цена была');
  assert.equal(deliveryOf(old, unknownSize).kind, 'planned');
});

test('прайс-лист в знаниях помощника: сам — только если помещается в лимит знаний', () => {
  assert.equal(KNOWLEDGE_LIMIT_CHARS, 8_000);
  const fit = priceListFit(100);
  assert.equal(fit.status, 'fits');
  assert.equal(fit.maxPositions, 100);
  assert.equal(priceListFit(101).status, 'too_large');
  assert.equal(priceListFit(null).status, 'unknown');
  assert.equal(priceListFit(0).status, 'unknown');

  const ids = ['ai_message_processing', 'product_catalog_processing', 'website_chat_widget'];
  const small = deliveryOf(priced(ids), { catalogPositions: 40, monthlyRequests: 600 });
  assert.equal(small.kind, 'self_service');
  assert.equal(small.priceList?.status, 'fits');

  const large = deliveryOf(priced(ids), { catalogPositions: 1_200, monthlyRequests: 600 });
  assert.equal(large.kind, 'team');
  assert.equal(large.priceList?.status, 'too_large');
  assert.deepEqual(large.teamWork, ['Подготовка каталога товаров и услуг']);

  // Размер не назван: карточка «сам» с условием лимита (его показывает сайт).
  const unknown = deliveryOf(priced(ids), unknownSize);
  assert.equal(unknown.kind, 'self_service');
  assert.equal(unknown.priceList?.status, 'unknown');

  // Прайс-лист рядом с интеграцией — работа команды целиком.
  assert.equal(
    deliveryOf(priced([...ids, 'google_sheets_integration']), {
      catalogPositions: 40,
      monthlyRequests: 600,
    }).kind,
    'team',
  );
});

test('тариф — из services/tiers.ts: по обращениям и внешним сервисам', () => {
  const bot = ['ai_message_processing', 'website_chat_widget'];
  const start = deliveryOf(priced(bot), { catalogPositions: null, monthlyRequests: 600 });
  assert.deepEqual(start.tier, {
    id: 'start',
    name: TIERS[0]!.name,
    priceUsd: TIERS[0]!.priceUsd,
    monthlyRequests: TIERS[0]!.monthlyRequests,
  });
  assert.equal(
    deliveryOf(priced(bot), { catalogPositions: null, monthlyRequests: 4_000 }).tier?.id,
    'growth',
  );
  const unknownVolume = deliveryOf(priced(bot), { catalogPositions: null, monthlyRequests: null });
  assert.equal(unknownVolume.tier?.id, 'start');
  assert.equal(unknownVolume.volumeKnown, false);
  // Один внешний сервис — Start (с 23.11.2026 в Start 1 сервис); два — Growth.
  const sheets = deliveryOf(priced(['ai_message_processing', 'google_sheets_integration']), {
    catalogPositions: null,
    monthlyRequests: 100,
  });
  assert.equal(sheets.tier?.id, 'start');
  const twoServices = deliveryOf(
    priced(['ai_message_processing', 'google_sheets_integration', 'crm_integration']),
    { catalogPositions: null, monthlyRequests: 100 },
  );
  assert.equal(twoServices.tier?.id, 'growth');
  // Каналы — не внешние сервисы: бот в Telegram вместе с таблицей остаётся на Start.
  const channels = deliveryOf(
    priced(['ai_message_processing', 'telegram_integration', 'google_sheets_integration']),
    { catalogPositions: null, monthlyRequests: 100 },
  );
  assert.equal(channels.kind, 'team');
  assert.equal(channels.tier?.id, 'start');
  // Больше Scale — индивидуальные условия.
  assert.equal(
    deliveryOf(priced(bot), { catalogPositions: null, monthlyRequests: 1_000_000 }).tier,
    null,
  );
});

test('карточка «сам»: без цены в тенге и без сроков; «команда» — с ценой; сметы выключены — без сроков', () => {
  const self = publicEstimate(stored(['ai_message_processing', 'website_chat_widget']), true);
  assert.equal(self.delivery.kind, 'self_service');
  assert.equal(self.priceKzt, null);
  assert.equal(self.workingDays, null);
  assert.equal(self.sharedSavingsKzt, null);
  assert.equal(JSON.stringify(self).includes('₸'), false);

  const team = publicEstimate(stored(['ai_message_processing', 'google_sheets_integration']), true);
  assert.equal(team.delivery.kind, 'team');
  assert.ok(team.priceKzt && team.priceKzt.min > 0);
  assert.ok(team.workingDays);

  // Выключатель смет администратора прячет и цену, и сроки.
  const off = publicEstimate(stored(['ai_message_processing', 'google_sheets_integration']), false);
  assert.equal(off.priceKzt, null);
  assert.equal(off.workingDays, null);
  assert.equal(off.pricingDisabled, true);

  const planned = publicEstimate(
    stored(['ai_message_processing', 'whatsapp_business_integration']),
    true,
  );
  assert.equal(planned.delivery.kind, 'planned');
  assert.equal(planned.priceKzt, null);
  assert.equal(planned.workingDays, null);
});

test('прежняя подписка $15 / 7 500 кредитов не показывается и в старых сметах', () => {
  const old = stored(['ai_message_processing', 'website_chat_widget']);
  old.monthly.recurring = [
    { kind: 'subscription', amount: { usdCents: 1_500, kzt: 7_500 } },
    { kind: 'support', amount: { kzt: 20_000, usdCents: null } },
  ];
  const view = publicEstimate(old, true);
  assert.deepEqual(
    view.monthly.recurring.map((cost) => cost.kind),
    ['support'],
  );
  assert.equal(JSON.stringify(view).includes('7500'), false);
});
