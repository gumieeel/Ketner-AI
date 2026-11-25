import assert from 'node:assert/strict';
import test from 'node:test';
import type { BotLead, Solution } from '../builder/types.js';
import { setProductSwitchForTests } from '../product-switches.js';
import {
  DRIVE_FILE,
  FAKE_GOOGLE_SETTINGS,
  createFakeGoogle,
  type FakeGoogle,
} from '../testing/fake-google.js';
import { createGoogleConnectionStore, type GoogleConnectionStore } from './connection-store.js';
import { RETRY_PAUSES_MS, MemoryDeliveryJournal } from './delivery-journal.js';
import { RECONCILE_RESOLVER, SheetsDelivery, TRASH_BEFORE_WRITE_MS } from './delivery.js';
import { brokenConnectionText } from './delivery-runtime.js';
import { LEAD_SHEET_COLUMNS } from './sheets.js';

setProductSwitchForTests('googleSheets', true);

const OWNER = 'owner-1';
const SHEET = 'sheet0-OriginalSheetId';

interface Harness {
  delivery: SheetsDelivery;
  journal: MemoryDeliveryJournal;
  connections: GoogleConnectionStore;
  google: FakeGoogle;
  logs: string[];
  notified: Array<[string, string]>;
  clock: { now: number };
  lead: (id: string, fields?: Partial<BotLead>) => Promise<BotLead>;
  leads: Map<string, BotLead>;
}

async function harness(
  options: {
    connect?: boolean;
    enabled?: boolean | ((userId?: string) => boolean);
    timeZone?: string;
    /** Тариф аккаунта активен (по умолчанию — да); объект, чтобы менять по ходу теста. */
    tier?: { active: boolean };
  } = {},
): Promise<Harness> {
  const clock = { now: Date.parse('2026-11-21T12:00:00Z') };
  const google = createFakeGoogle();
  const journal = new MemoryDeliveryJournal(() => clock.now);
  const connections = createGoogleConnectionStore({ secret: 'delivery-test' });
  const leads = new Map<string, BotLead>();
  const solution = { id: 'sol-1', ownerId: OWNER, name: 'Бот кофейни' } as Solution;
  const logs: string[] = [];
  const notified: Array<[string, string]> = [];
  const delivery = new SheetsDelivery({
    journal: () => journal,
    leads: () => ({
      getLead: async (ownerId, id) => {
        const lead = leads.get(id);
        return lead && lead.ownerId === ownerId ? lead : null;
      },
      getSolution: async (ownerId, id) =>
        id === solution.id && ownerId === OWNER ? solution : null,
    }),
    connections,
    settings: () => FAKE_GOOGLE_SETTINGS,
    enabled: (userId) =>
      typeof options.enabled === 'function' ? options.enabled(userId) : (options.enabled ?? true),
    siteUrl: () => 'https://ketner.org',
    timeZoneOf: () => options.timeZone ?? null,
    ...(options.tier ? { tierActive: () => options.tier!.active } : {}),
    notifyBroken: async (userId, status) => {
      notified.push([userId, status]);
    },
    fetchImpl: google.fetchImpl,
    now: () => clock.now,
    log: (line) => logs.push(line),
  });
  if (options.connect ?? true) {
    await connections.connect({
      userId: OWNER,
      googleSub: 'sub-1',
      googleEmail: 'owner@example.com',
      scopes: ['openid', DRIVE_FILE],
      refreshToken: '1//refresh-owner',
      spreadsheet: { id: SHEET, url: `https://docs.google.com/spreadsheets/d/${SHEET}/edit` },
    });
  }
  const lead = async (id: string, fields: Partial<BotLead> = {}) => {
    const value: BotLead = {
      id,
      solutionId: 'sol-1',
      ownerId: OWNER,
      conversationId: null,
      name: 'Анна',
      contact: '+7 900 000-00-00',
      question: 'Можно забронировать стол на завтра?',
      status: 'new',
      createdAt: '2026-11-21T11:59:30.000Z',
      updatedAt: '2026-11-21T11:59:30.000Z',
      ...fields,
    };
    leads.set(id, value);
    await delivery.onLeadCreated(value);
    return value;
  };
  return { delivery, journal, connections, google, logs, notified, clock, lead, leads };
}

const later = (h: Harness, ms: number) => {
  h.clock.now += ms;
};

test('новая заявка: строка в таблице (RAW, порядок колонок, ID заявки последней), отметка «в таблице»', async () => {
  const h = await harness();
  await h.lead('lead-1', {
    name: '=IMPORTXML("https://evil.example","//a")',
    contact: '+cmd|/C calc',
    question: '@SUM(A1:A9)',
  });
  assert.equal(h.google.appendRequests.length, 1);
  const request = h.google.appendRequests[0]!;
  const url = new URL(request.url);
  assert.equal(url.searchParams.get('valueInputOption'), 'RAW');
  assert.equal(url.searchParams.get('insertDataOption'), 'INSERT_ROWS');
  assert.match(url.pathname, new RegExp(`/spreadsheets/${SHEET}/values/`));
  assert.equal(request.authorization, 'Bearer ya29.refreshed-1');
  assert.deepEqual((request.body as { values: string[][] }).values, [
    [
      '2026-11-21 11:59 UTC',
      'Бот кофейни',
      // RAW и апостроф перед значением, похожим на формулу (выгрузка в CSV → Excel).
      `'=IMPORTXML("https://evil.example","//a")`,
      "'+cmd|/C calc",
      "'@SUM(A1:A9)",
      'https://ketner.org/solutions/sol-1',
      'lead-1',
    ],
  ]);
  assert.equal(LEAD_SHEET_COLUMNS.at(-1), 'ID заявки');
  assert.deepEqual(await h.delivery.states(OWNER, ['lead-1']), { 'lead-1': 'written' });
  const effect = await h.journal.latest(OWNER, 'lead-1');
  assert.deepEqual(effect?.resultMeta, { http: 200, rows: 1 });
  assert.ok(h.connections.get(OWNER)?.lastOkAt);
  // Ни данных заявки, ни токенов в логе.
  const log = h.logs.join('\n');
  for (const secret of ['Анна', 'IMPORTXML', 'refresh-owner', 'ya29'])
    assert.ok(!log.includes(secret));

  // Повтор события той же заявки второй строки не даёт.
  await h.delivery.onLeadCreated(h.leads.get('lead-1')!);
  assert.equal(h.google.appendRequests.length, 1);
  // Access-токен живёт в памяти: вторая заявка без нового обновления.
  await h.lead('lead-2');
  assert.equal(h.google.refreshCount, 1);
});

test('длинный вопрос обрезается до предела ячейки', async () => {
  const h = await harness();
  await h.lead('long', { question: 'я'.repeat(60_000) });
  const row = (h.google.appendRequests[0]!.body as { values: string[][] }).values[0]!;
  assert.equal(row[4]!.length, 50_000);
  assert.ok(row[4]!.endsWith('…'));
});

test('временный сбой: повтор через 1, 5, 30 минут; после 4 попыток — «не записано», кнопка даёт новый шаг', async () => {
  const h = await harness();
  h.google.appendStatus = 503;
  await h.lead('lead-1');
  assert.deepEqual(await h.delivery.states(OWNER, ['lead-1']), { 'lead-1': 'writing' });

  await h.delivery.sweep();
  assert.equal(h.google.appendRequests.length, 1, 'до паузы не повторяем');
  for (const pause of RETRY_PAUSES_MS) {
    later(h, pause + 1);
    await h.delivery.sweep();
  }
  assert.equal(h.google.appendRequests.length, 4);
  later(h, 60 * 60_000);
  await h.delivery.sweep();
  assert.equal(h.google.appendRequests.length, 4, 'пятой попытки нет');
  assert.deepEqual(await h.delivery.states(OWNER, ['lead-1']), { 'lead-1': 'failed' });
  assert.equal(await h.delivery.pending(OWNER), 1);

  h.google.appendStatus = 200;
  assert.equal(await h.delivery.retryLead(OWNER, 'lead-1'), 'retrying');
  assert.equal((await h.journal.latest(OWNER, 'lead-1'))?.stepKey, 'sheet_append_r1');
  assert.deepEqual(await h.delivery.states(OWNER, ['lead-1']), { 'lead-1': 'written' });
  assert.equal(await h.delivery.retryLead(OWNER, 'lead-1'), 'written');
  assert.equal(h.google.rows.get(SHEET)?.length, 1);
});

test('429 повторяется, 400 — нет (не временный сбой)', async () => {
  const h = await harness();
  h.google.appendStatus = 429;
  await h.lead('quota');
  h.google.appendStatus = 200;
  later(h, RETRY_PAUSES_MS[0] + 1);
  await h.delivery.sweep();
  assert.deepEqual(await h.delivery.states(OWNER, ['quota']), { quota: 'written' });

  h.google.appendStatus = 400;
  await h.lead('bad');
  later(h, 60 * 60_000);
  await h.delivery.sweep();
  assert.deepEqual(await h.delivery.states(OWNER, ['bad']), { bad: 'failed' });
});

test('неясный исход: сверка по «ID заявки» — нашла → в таблице, второй строки нет', async () => {
  const h = await harness();
  h.google.appendStatus = 'throw';
  h.google.appendWritesBeforeThrow = true;
  await h.lead('lead-1');
  assert.equal((await h.journal.latest(OWNER, 'lead-1'))?.status, 'unknown');
  assert.deepEqual(await h.delivery.states(OWNER, ['lead-1']), { 'lead-1': 'writing' });

  h.google.appendStatus = 200;
  await h.delivery.sweep();
  const effect = await h.journal.latest(OWNER, 'lead-1');
  assert.equal(effect?.status, 'committed');
  assert.equal(h.google.appendRequests.length, 1, 'вслепую не повторяли');
  assert.equal(h.google.rows.get(SHEET)?.length, 1);
  assert.equal(RECONCILE_RESOLVER, 'reconcile:sheet_id_column');
});

test('неясный исход: сверка не нашла → «не записано», затем обычный повтор после паузы', async () => {
  const h = await harness();
  h.google.appendStatus = 'throw';
  await h.lead('lead-1');
  h.google.appendStatus = 200;
  await h.delivery.sweep();
  const failed = await h.journal.latest(OWNER, 'lead-1');
  assert.equal(failed?.status, 'failed');
  assert.equal(failed?.resultMeta.code, 'not_written');
  later(h, RETRY_PAUSES_MS[0] + 1);
  await h.delivery.sweep();
  assert.equal((await h.journal.latest(OWNER, 'lead-1'))?.status, 'committed');
  assert.equal(h.google.rows.get(SHEET)?.length, 1);
});

test('сверка не удалась (сеть) — исход остаётся неясным до следующего обхода', async () => {
  const h = await harness();
  h.google.appendStatus = 'throw';
  await h.lead('lead-1');
  h.google.readStatus = 503;
  await h.delivery.sweep();
  assert.equal((await h.journal.latest(OWNER, 'lead-1'))?.status, 'unknown');
});

test('доступ отозван (invalid_grant): reconnect_required, одно уведомление, заявки ждут; после подключения — дописать', async () => {
  const h = await harness();
  h.google.refreshError = 'invalid_grant';
  await h.lead('lead-1');
  await h.lead('lead-2');
  assert.equal(h.connections.get(OWNER)?.status, 'reconnect_required');
  assert.equal(h.connections.get(OWNER)?.lastErrorCode, 'invalid_grant');
  assert.deepEqual(h.notified, [[OWNER, 'reconnect_required']], 'одно уведомление на поломку');
  assert.deepEqual(await h.delivery.states(OWNER, ['lead-1', 'lead-2']), {
    'lead-1': 'waiting',
    'lead-2': 'waiting',
  });
  later(h, 60 * 60_000);
  await h.delivery.sweep();
  assert.equal(h.google.appendRequests.length, 0, 'без подключения не пишем');
  assert.equal(await h.delivery.retryLead(OWNER, 'lead-1'), 'not_connected');

  // Владелец подключил Google снова — «дописать пропущенные».
  h.google.refreshError = null;
  await h.connections.connect({
    userId: OWNER,
    googleSub: 'sub-1',
    googleEmail: 'owner@example.com',
    scopes: [DRIVE_FILE],
    refreshToken: '1//refresh-new',
    spreadsheet: { id: SHEET, url: `https://docs.google.com/spreadsheets/d/${SHEET}/edit` },
  });
  h.delivery.forget(OWNER);
  assert.equal(await h.delivery.backfill(OWNER), 2);
  assert.deepEqual(await h.delivery.states(OWNER, ['lead-1', 'lead-2']), {
    'lead-1': 'written',
    'lead-2': 'written',
  });
  assert.equal(await h.delivery.pending(OWNER), 0);
});

test('403 от Google — reconnect_required без повторов', async () => {
  const h = await harness();
  h.google.appendStatus = 403;
  await h.lead('lead-1');
  assert.equal(h.connections.get(OWNER)?.status, 'reconnect_required');
  assert.deepEqual(await h.delivery.states(OWNER, ['lead-1']), { 'lead-1': 'waiting' });
  assert.deepEqual(h.notified, [[OWNER, 'reconnect_required']]);
});

test('таблица удалена (404) или в корзине: sheet_missing; новая таблица и «дописать пропущенные»', async () => {
  const h = await harness();
  h.google.appendStatus = 404;
  await h.lead('lead-1');
  assert.equal(h.connections.get(OWNER)?.status, 'sheet_missing');
  assert.deepEqual(h.notified, [[OWNER, 'sheet_missing']]);
  await h.lead('lead-2');
  assert.equal(h.google.appendRequests.length, 1, 'вторая заявка ждёт, не пишется');

  h.google.appendStatus = 200;
  const fresh = await h.delivery.newSheet(OWNER);
  assert.equal(fresh.status, 'connected');
  assert.notEqual(fresh.spreadsheetId, SHEET);
  assert.equal(await h.delivery.backfill(OWNER), 2);
  assert.equal(h.google.rows.get(fresh.spreadsheetId!)?.length, 2);

  // Корзина: Sheets пишет и туда, поэтому раз в сутки и после сбоя проверяем Drive.
  h.google.trashed = true;
  later(h, 25 * 60 * 60_000);
  await h.delivery.sweep();
  assert.equal(h.connections.get(OWNER)?.status, 'sheet_missing');
  assert.equal(h.connections.get(OWNER)?.lastErrorCode, 'trashed');
  assert.equal(h.notified.length, 2);
});

test('процесс умер после отправки (аренда истекла в dispatched) — неясный исход и сверка', async () => {
  const h = await harness();
  const { effect } = await h.journal.start({ userId: OWNER, solutionId: 'sol-1', leadId: 'x' });
  h.leads.set('x', { ...(await h.lead('x-tmp')), id: 'x' });
  await h.journal.dispatch(effect!);
  later(h, 3 * 60_000);
  await h.delivery.sweep();
  assert.equal((await h.journal.latest(OWNER, 'x'))?.status, 'unknown');
  await h.delivery.sweep();
  assert.equal((await h.journal.latest(OWNER, 'x'))?.status, 'failed', 'строки нет — не записано');
});

test('нет подключения, отключено или переключатель закрыт — заявка в таблицу не идёт', async () => {
  const none = await harness({ connect: false });
  await none.lead('lead-1');
  assert.equal(none.journal.executions.size, 0);

  const off = await harness();
  await off.connections.disconnect(OWNER);
  await off.lead('lead-1');
  assert.equal(off.journal.executions.size, 0);

  const closed = await harness({ enabled: false });
  await closed.lead('lead-1');
  assert.equal(closed.journal.executions.size, 0);
  assert.equal(await closed.delivery.sweep(), 0);
});

test('тексты уведомлений о поломке: без данных заявок, со ссылкой на кабинет', () => {
  const revoked = brokenConnectionText('reconnect_required', 'https://ketner.org/solutions');
  assert.match(revoked.text, /доступ к Google отозван/);
  assert.match(revoked.text, /https:\/\/ketner\.org\/solutions/);
  const missing = brokenConnectionText('sheet_missing', 'https://ketner.org/solutions');
  assert.match(missing.subject, /удалена/);
});

test('корзина замечается до записи (если прошлой проверке больше минуты): заявка ждёт, одно уведомление; «проверить снова» после восстановления', async () => {
  const h = await harness();
  await h.lead('lead-1');
  assert.equal(h.google.rows.get(SHEET)?.length, 1);

  // Владелец отправил таблицу в корзину; через минуту после прошлой проверки — новая проверка.
  h.google.trashed = true;
  later(h, TRASH_BEFORE_WRITE_MS + 1);
  await h.lead('lead-2');
  assert.equal(h.google.rows.get(SHEET)?.length, 1, 'в таблицу из корзины не пишем');
  assert.equal(h.connections.get(OWNER)?.status, 'sheet_missing');
  assert.equal(h.connections.get(OWNER)?.lastErrorCode, 'trashed');
  assert.deepEqual(h.notified, [[OWNER, 'sheet_missing']]);
  assert.deepEqual(await h.delivery.states(OWNER, ['lead-2']), { 'lead-2': 'waiting' });

  // Пока в корзине — «проверить снова» ничего не меняет.
  assert.equal((await h.delivery.recheck(OWNER))?.status, 'sheet_missing');

  // Восстановил: подключение снова к той же таблице, пропущенные дописываются туда же.
  h.google.trashed = false;
  const back = await h.delivery.recheck(OWNER);
  assert.equal(back?.status, 'connected');
  assert.equal(back?.spreadsheetId, SHEET);
  assert.equal(await h.delivery.backfill(OWNER), 1);
  assert.equal(h.google.rows.get(SHEET)?.length, 2);
  assert.equal(h.notified.length, 1);
});

test('окно проверки корзины — минута (в пилоте 10 минут: две заявки ушли в таблицу из корзины)', async () => {
  assert.equal(TRASH_BEFORE_WRITE_MS, 60_000);
  const h = await harness();
  await h.lead('lead-1');
  h.google.trashed = true;
  // Внутри минуты после проверки — запись без новой проверки (известная граница окна).
  later(h, 30_000);
  await h.lead('lead-2');
  assert.equal(h.google.rows.get(SHEET)?.length, 2);
  // Через минуту — проверка до записи: третья заявка в корзину не уходит.
  later(h, 31_000);
  await h.lead('lead-3');
  assert.equal(h.google.rows.get(SHEET)?.length, 2);
  assert.equal(h.connections.get(OWNER)?.status, 'sheet_missing');
});

test('не больше одного запроса к Drive на запись, в том числе когда запись не удалась', async () => {
  const h = await harness();
  // Каждая заявка — через минуту с лишним: одна проверка корзины на запись.
  for (const [index, id] of ['lead-1', 'lead-2', 'lead-3'].entries()) {
    const before = h.google.driveRequests;
    if (index > 0) later(h, TRASH_BEFORE_WRITE_MS + 1);
    await h.lead(id);
    assert.equal(h.google.driveRequests - before, 1, id);
  }
  // Запись отклонена (500): проверка перед записью уже была — второго запроса к Drive нет.
  later(h, TRASH_BEFORE_WRITE_MS + 1);
  h.google.appendStatus = 500;
  const before = h.google.driveRequests;
  await h.lead('lead-4');
  assert.equal(h.google.driveRequests - before, 1);
  // Заявки подряд внутри минуты — без запросов к Drive.
  h.google.appendStatus = 200;
  const burst = h.google.driveRequests;
  await h.lead('lead-5');
  await h.lead('lead-6');
  assert.equal(h.google.driveRequests, burst);
});

test('пилот: доставка только для аккаунтов, для которых Google Таблицы включены', async () => {
  const h = await harness({ enabled: (userId) => userId === undefined || userId === 'pilot-only' });
  await h.lead('lead-1');
  assert.equal(h.journal.executions.size, 0, 'владелец не в пилоте — в таблицу не пишем');

  // Шаг, оставшийся с прежнего включения, обход не трогает.
  await h.journal.start({ userId: OWNER, solutionId: 'sol-1', leadId: 'old' });
  later(h, 60 * 60_000);
  await h.delivery.sweep();
  assert.equal((await h.journal.latest(OWNER, 'old'))?.status, 'reserved');
  assert.equal(h.google.appendRequests.length, 0);
});

test('дата в строке — в часовом поясе владельца, если он известен', async () => {
  const h = await harness({ timeZone: 'Asia/Qyzylorda' });
  await h.lead('lead-tz', { createdAt: '2026-11-22T06:35:10.000Z' });
  const row = (h.google.appendRequests[0]!.body as { values: string[][] }).values[0]!;
  assert.equal(row[0], '2026-11-22 11:35');
});

test('тариф снят: запись ждёт (tier_inactive), Google не трогаем, обход не повторяет; продлили — дописывается', async () => {
  const tier = { active: true };
  const h = await harness({ tier });
  await h.lead('lead-1');
  assert.equal(h.google.rows.get(SHEET)?.length, 1);

  tier.active = false;
  const drive = h.google.driveRequests;
  await h.lead('lead-2');
  assert.deepEqual(await h.delivery.states(OWNER, ['lead-2']), { 'lead-2': 'waiting' });
  assert.equal((await h.journal.latest(OWNER, 'lead-2'))?.resultMeta.code, 'tier_inactive');
  assert.equal(h.google.rows.get(SHEET)?.length, 1, 'в таблицу не пишем');
  // Обход и «повторить» без тарифа ничего не делают, к Google не обращаются.
  later(h, 60 * 60_000);
  await h.delivery.sweep();
  assert.equal(await h.delivery.retryLead(OWNER, 'lead-2'), 'tier_inactive');
  assert.equal(await h.delivery.backfill(OWNER), 0);
  assert.equal(h.google.appendRequests.length, 1);
  assert.equal(h.google.driveRequests, drive, 'и проверки корзины нет');
  // Подключение не обрывается и уведомлений о поломке нет.
  assert.equal(h.connections.get(OWNER)?.status, 'connected');
  assert.deepEqual(h.notified, []);

  tier.active = true;
  assert.equal(await h.delivery.backfill(OWNER), 1);
  assert.equal(h.google.rows.get(SHEET)?.length, 2);
  assert.deepEqual(await h.delivery.states(OWNER, ['lead-2']), { 'lead-2': 'written' });
});
