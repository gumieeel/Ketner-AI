import assert from 'node:assert/strict';
import test from 'node:test';
import { CAPABILITIES } from '../discovery/capabilities.js';
import { ACTIONS, actionRisk, isActionId } from '../platform/risk.js';
import {
  AUTOMATION_TEMPLATE_IDS,
  AUTOMATION_TEMPLATES,
  applyAutomationsPatch,
  automationApproval,
  automationAvailable,
  automationExternalServices,
  automationRisk,
  automationsOf,
  automationsView,
  leadNotifyChannels,
  newBotAutomations,
  type AutomationTemplate,
} from './automations.js';

test('каталог: три шаблона из BUILDER_V1 4.1, у каждого версия, событие, шаги из словаря risk.ts', () => {
  assert.deepEqual(
    [...AUTOMATION_TEMPLATE_IDS],
    ['lead_to_sheet', 'lead_to_manager', 'daily_lead_summary'],
  );
  for (const id of AUTOMATION_TEMPLATE_IDS) {
    const template = AUTOMATION_TEMPLATES[id];
    assert.equal(template.id, id);
    assert.ok(Number.isInteger(template.version) && template.version >= 1, id);
    assert.ok(template.actions.length > 0, id);
    for (const action of template.actions) assert.ok(isActionId(action), `${id}: ${action}`);
    assert.ok(template.title.ru && template.title.en && template.description.ru, id);
  }
  assert.deepEqual(AUTOMATION_TEMPLATES.lead_to_sheet.actions, ['sheet.append_row']);
  assert.deepEqual(AUTOMATION_TEMPLATES.lead_to_manager.actions, ['owner.notify']);
  assert.deepEqual(AUTOMATION_TEMPLATES.daily_lead_summary.actions, ['owner.notify']);
  assert.equal(AUTOMATION_TEMPLATES.daily_lead_summary.event, 'schedule.daily');
});

test('риск каждого шаблона — по risk.ts: все три low и включаются без одобрения', () => {
  for (const id of AUTOMATION_TEMPLATE_IDS) {
    const template = AUTOMATION_TEMPLATES[id];
    const expected = template.actions.map(actionRisk);
    assert.ok(expected.includes(automationRisk(template)), id);
    assert.equal(automationRisk(template), 'low', id);
    assert.equal(automationApproval(template), 'none', id);
  }
  // Внешняя запись одной обратимой строки и внутреннее уведомление владельцу — low.
  assert.equal(ACTIONS['sheet.append_row'].consequences.reach, 'external');
  assert.equal(ACTIONS['owner.notify'].consequences.reach, 'internal');
});

test('риск и одобрение выводятся из шагов, а не задаются шаблоном', () => {
  const crm: AutomationTemplate = {
    ...AUTOMATION_TEMPLATES.lead_to_sheet,
    actions: ['sheet.append_row', 'record.update_significant'],
  };
  assert.equal(automationRisk(crm), 'medium');
  assert.equal(automationApproval(crm), 'required', 'значимая внешняя запись — с подтверждением');
  assert.equal(
    automationApproval(crm, { standingPermissions: ['record.update_significant'] }),
    'none',
  );
  const bulk: AutomationTemplate = { ...crm, actions: ['message.bulk_send'] };
  assert.equal(automationRisk(bulk), 'high');
  assert.equal(
    automationApproval(bulk, { standingPermissions: ['message.bulk_send'] }),
    'required',
  );
  const refund: AutomationTemplate = { ...crm, actions: ['owner.notify', 'payment.refund'] };
  assert.equal(automationApproval(refund), 'forbidden');
});

test('подключения: внешний сервис (лимит тарифа) — только Google Таблицы; почта и Telegram — аккаунт', () => {
  assert.deepEqual(automationExternalServices(AUTOMATION_TEMPLATES.lead_to_sheet), [
    'google_sheets',
  ]);
  assert.deepEqual(automationExternalServices(AUTOMATION_TEMPLATES.lead_to_manager), []);
  assert.deepEqual(automationExternalServices(AUTOMATION_TEMPLATES.daily_lead_summary), []);
  assert.deepEqual(
    AUTOMATION_TEMPLATES.lead_to_manager.connections.map((c) => [c.id, c.kind]),
    [
      ['owner_email', 'account'],
      ['owner_telegram', 'account'],
    ],
  );
});

test('доступность — по каталогу возможностей: сводке нужен планировщик, его пока нет', () => {
  for (const id of AUTOMATION_TEMPLATE_IDS) {
    const template = AUTOMATION_TEMPLATES[id];
    assert.equal(
      automationAvailable(template),
      template.requires.every((cap) => CAPABILITIES[cap].availability !== 'unavailable'),
      id,
    );
    if (!automationAvailable(template)) assert.ok(template.unavailableNote?.ru, `${id}: причина`);
  }
  assert.equal(CAPABILITIES.scheduled_runs.availability, 'unavailable');
  assert.equal(automationAvailable(AUTOMATION_TEMPLATES.daily_lead_summary), false);
  assert.equal(automationAvailable(AUTOMATION_TEMPLATES.lead_to_sheet), true);
  assert.equal(automationAvailable(AUTOMATION_TEMPLATES.lead_to_manager), true);
});

test('переход от leadNotify: старое поле читается, новое — главнее', () => {
  // Бот до шага «заявка → менеджер»: таблица да, письмо да, Telegram нет.
  const legacy = automationsOf({});
  assert.equal(legacy.lead_to_sheet.enabled, true);
  assert.deepEqual(legacy.lead_to_manager, {
    enabled: true,
    version: 1,
    options: { email: true, telegram: false },
  });
  assert.equal(legacy.daily_lead_summary.enabled, false);

  // Бот из PR #80: каналы из leadNotify; оба выключены — шаблон выключен.
  assert.deepEqual(
    automationsOf({ leadNotify: { email: false, telegram: true } }).lead_to_manager,
    {
      enabled: true,
      version: 1,
      options: { email: false, telegram: true },
    },
  );
  assert.equal(
    automationsOf({ leadNotify: { email: false, telegram: false } }).lead_to_manager.enabled,
    false,
  );

  // Есть automations — leadNotify не читается.
  const both = {
    leadNotify: { email: true, telegram: true },
    automations: {
      lead_to_manager: { enabled: false, version: 1, options: { email: true, telegram: true } },
    },
  };
  assert.deepEqual(leadNotifyChannels(both), { email: false, telegram: false });

  // Новый бот.
  assert.deepEqual(leadNotifyChannels({ automations: newBotAutomations() }), {
    email: true,
    telegram: true,
  });
});

test('недоступный шаблон выключен, даже если в записи включён', () => {
  const resolved = automationsOf({
    automations: { daily_lead_summary: { enabled: true, version: 1 } },
  });
  assert.equal(resolved.daily_lead_summary.enabled, false);
});

test('запись: leadNotify из карточки переносится в automations, остальное сохраняется', () => {
  const result = applyAutomationsPatch(
    { leadNotify: { email: true, telegram: false } },
    { leadNotify: { email: false, telegram: true } },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.automations, {
    lead_to_sheet: { enabled: true, version: 1 },
    lead_to_manager: { enabled: true, version: 1, options: { email: false, telegram: true } },
  });
});

test('запись: выключить таблицу, сменить один канал — второй не меняется', () => {
  const result = applyAutomationsPatch(
    { automations: newBotAutomations() },
    {
      automations: {
        lead_to_sheet: { enabled: false },
        lead_to_manager: { options: { telegram: false } },
      },
    },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.automations.lead_to_sheet, { enabled: false, version: 1 });
  assert.deepEqual(result.automations.lead_to_manager, {
    enabled: true,
    version: 1,
    options: { email: true, telegram: false },
  });
});

test('запись: недоступный шаблон не включается; с одобрением — только с подтверждением', () => {
  const unavailable = applyAutomationsPatch(
    {},
    { automations: { daily_lead_summary: { enabled: true } } },
  );
  assert.deepEqual(unavailable, {
    ok: false,
    code: 'automation_unavailable',
    template: 'daily_lead_summary',
  });
  // Выключить недоступный можно.
  assert.equal(
    applyAutomationsPatch({}, { automations: { daily_lead_summary: { enabled: false } } }).ok,
    true,
  );

  // Владелец сам включил одобрение для уведомлений: включение — с подтверждением.
  const off = { leadNotify: { email: false, telegram: false } };
  const policy = { alwaysApprove: ['owner.notify'] };
  const refused = applyAutomationsPatch(
    off,
    { automations: { lead_to_manager: { enabled: true } } },
    policy,
  );
  assert.deepEqual(refused, {
    ok: false,
    code: 'automation_needs_confirmation',
    template: 'lead_to_manager',
  });
  const confirmed = applyAutomationsPatch(
    off,
    { automations: { lead_to_manager: { enabled: true, confirmed: true } } },
    policy,
  );
  assert.equal(confirmed.ok, true);
  // Уже включённый шаблон подтверждение не переспрашивает (меняются только каналы).
  const onlyOptions = applyAutomationsPatch(
    { automations: newBotAutomations() },
    { automations: { lead_to_manager: { enabled: true, options: { email: false } } } },
    policy,
  );
  assert.equal(onlyOptions.ok, true);
});

test('обзор: каталог с состоянием, риском, одобрением и подключениями', () => {
  const view = automationsView({ automations: newBotAutomations() });
  assert.deepEqual(
    view.map((item) => [item.id, item.enabled, item.available, item.risk, item.approval]),
    [
      ['lead_to_sheet', true, true, 'low', 'none'],
      ['lead_to_manager', true, true, 'low', 'none'],
      ['daily_lead_summary', false, false, 'low', 'none'],
    ],
  );
  assert.deepEqual(view[1]!.options, { email: true, telegram: true });
});
