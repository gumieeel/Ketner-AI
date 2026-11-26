import assert from 'node:assert/strict';
import test from 'node:test';
import { checkSolutionSpec, solutionSpecSchema } from '../platform/solution-spec.js';
import { AUTOMATION_TEMPLATES, newBotAutomations, type BotAutomations } from './automations.js';
import { botSolutionSpec } from './bot-spec.js';
import { diagramFromSpec, type Diagram, type DiagramConnections } from './diagram.js';
import type { BotSettings } from './types.js';

const BASE: BotSettings = {
  slug: 'lisa',
  greeting: '',
  quickReplies: [],
  dailyCapCredits: 1000,
  corrections: [],
};

const bot = (automations: BotAutomations) => ({
  name: 'Лиса',
  source: null,
  bot: { ...BASE, automations },
});

const only = (...ids: Array<'lead_to_sheet' | 'lead_to_manager'>): BotAutomations => ({
  lead_to_sheet: { enabled: ids.includes('lead_to_sheet'), version: 1 },
  lead_to_manager: {
    enabled: ids.includes('lead_to_manager'),
    version: 1,
    options: { email: true, telegram: true },
  },
});

const ALL_OK: DiagramConnections = {
  google_sheets: 'connected',
  owner_email: 'connected',
  owner_telegram: 'connected',
};

/** Снимок: узлы «id@колонка.строка», связи «откуда>куда». */
function shape(diagram: Diagram) {
  return {
    nodes: diagram.nodes.map((node) => `${node.id}@${node.level}.${node.row}`),
    edges: diagram.edges.map((edge) => `${edge.from}>${edge.to}`),
  };
}

test('спецификация бота проходит схему и проверки словаря при любых переключателях', () => {
  for (const automations of [
    only(),
    only('lead_to_sheet'),
    only('lead_to_manager'),
    newBotAutomations(),
  ]) {
    const spec = botSolutionSpec(bot(automations));
    const parsed = solutionSpecSchema.safeParse(spec);
    assert.ok(parsed.success, JSON.stringify(parsed.error?.issues));
    assert.deepEqual(checkSolutionSpec(spec), []);
  }
  assert.equal(botSolutionSpec(bot(only())).strategy, 'agent');
  assert.equal(botSolutionSpec(bot(newBotAutomations())).strategy, 'agent_calls_workflow');
  // Таблица — внешний сервис клиента; уведомления — нет.
  assert.deepEqual(botSolutionSpec(bot(only('lead_to_sheet'))).integrations, [
    {
      capability: 'spreadsheets_sync',
      purpose: 'Строки заявок в Google Таблицу владельца',
      connectedBy: 'customer',
    },
  ]);
  assert.deepEqual(botSolutionSpec(bot(only('lead_to_manager'))).integrations, []);
});

test('снимок: бот без автоматизаций', () => {
  assert.deepEqual(shape(diagramFromSpec(botSolutionSpec(bot(only())), ALL_OK, 'ru')), {
    nodes: ['trigger@0.0', 'agent:bot@1.0'],
    edges: ['trigger>agent:bot'],
  });
});

test('снимок: «заявка → таблица»', () => {
  const diagram = diagramFromSpec(botSolutionSpec(bot(only('lead_to_sheet'))), ALL_OK, 'ru');
  assert.deepEqual(shape(diagram), {
    nodes: [
      'trigger@0.0',
      'agent:bot@1.0',
      'event:lead.created@2.0',
      'step:lead_to_sheet:step-1@3.0',
      'service:spreadsheets_sync@4.0',
    ],
    edges: [
      'trigger>agent:bot',
      'agent:bot>event:lead.created',
      'event:lead.created>step:lead_to_sheet:step-1',
      'step:lead_to_sheet:step-1>service:spreadsheets_sync',
    ],
  });
  const step = diagram.nodes.find((node) => node.kind === 'step')!;
  assert.equal(step.label, 'Строка в таблицу');
  assert.equal(step.risk, 'low');
  const service = diagram.nodes.find((node) => node.kind === 'service')!;
  assert.deepEqual(
    [service.label, service.state, service.stateLabel],
    ['Google Таблица', 'ok', 'подключена'],
  );
});

test('снимок: «заявка → менеджер» — без внешнего сервиса, состояние каналов на шаге', () => {
  const diagram = diagramFromSpec(botSolutionSpec(bot(only('lead_to_manager'))), ALL_OK, 'ru');
  assert.deepEqual(shape(diagram), {
    nodes: [
      'trigger@0.0',
      'agent:bot@1.0',
      'event:lead.created@2.0',
      'step:lead_to_manager:step-1@3.0',
    ],
    edges: [
      'trigger>agent:bot',
      'agent:bot>event:lead.created',
      'event:lead.created>step:lead_to_manager:step-1',
    ],
  });
  const step = diagram.nodes.find((node) => node.kind === 'step')!;
  assert.deepEqual(
    [step.label, step.risk, step.state, step.stateLabel],
    ['Уведомление вам', 'low', 'ok', 'почта, Telegram'],
  );
});

test('снимок: новый бот — одно событие «заявка», два шага в одной колонке', () => {
  const diagram = diagramFromSpec(botSolutionSpec(bot(newBotAutomations())), ALL_OK, 'ru');
  assert.deepEqual(shape(diagram), {
    nodes: [
      'trigger@0.0',
      'agent:bot@1.0',
      'event:lead.created@2.0',
      'step:lead_to_sheet:step-1@3.0',
      'service:spreadsheets_sync@4.0',
      'step:lead_to_manager:step-1@3.1',
    ],
    edges: [
      'trigger>agent:bot',
      'agent:bot>event:lead.created',
      'event:lead.created>step:lead_to_sheet:step-1',
      'step:lead_to_sheet:step-1>service:spreadsheets_sync',
      'event:lead.created>step:lead_to_manager:step-1',
    ],
  });
  assert.deepEqual(diagram.description, [
    'Клиент пишет агенту → Агент «Лиса»',
    'Агент «Лиса» → Новая заявка',
    'Новая заявка → Строка в таблицу (риск низкий); Уведомление вам (почта, Telegram, риск низкий)',
    'Строка в таблицу (риск низкий) → Google Таблица (подключена)',
  ]);
});

test('снимок: «сводка за день» — расписание само начинает процесс (когда появится планировщик)', () => {
  // Сводка сейчас недоступна, и спецификация бота её не включает. Схему проверяем на спецификации
  // с этим процессом, как её построит мастер, когда планировщик появится.
  const spec = botSolutionSpec(bot(only()));
  const summary = AUTOMATION_TEMPLATES.daily_lead_summary;
  spec.strategy = 'agent_calls_workflow';
  spec.permissions.push('owner.notify');
  spec.components.workflows = [
    {
      key: 'daily_lead_summary',
      purpose: summary.description.ru,
      trigger: { kind: 'schedule', description: 'Раз в сутки' },
      steps: [
        { key: 'step-1', action: 'owner.notify', description: 'Сводка', onError: 'continue' },
      ],
      logicOrigin: 'catalog_template',
      template: { id: 'daily_lead_summary', version: 1 },
      instantiation: 'per_customer',
    },
  ];
  assert.ok(solutionSpecSchema.safeParse(spec).success);
  const diagram = diagramFromSpec(spec, ALL_OK, 'en');
  assert.deepEqual(shape(diagram), {
    nodes: [
      'trigger@0.0',
      'agent:bot@1.0',
      'event:schedule.daily@0.1',
      'step:daily_lead_summary:step-1@1.1',
    ],
    edges: ['trigger>agent:bot', 'event:schedule.daily>step:daily_lead_summary:step-1'],
  });
  assert.deepEqual(
    diagram.nodes.map((node) => node.label),
    ['A customer writes to the agent', 'Agent "Лиса"', 'Once a day', 'Lead summary'],
  );
});

test('состояния подключений: пауза по тарифу, поломка, нет каналов, Telegram не привязан', () => {
  const spec = botSolutionSpec(bot(newBotAutomations()));
  const at = (connections: DiagramConnections, id: string) =>
    diagramFromSpec(spec, connections, 'ru').nodes.find((node) => node.id === id)!;

  const paused = at({ ...ALL_OK, google_sheets: 'tier_inactive' }, 'service:spreadsheets_sync');
  assert.deepEqual([paused.state, paused.stateLabel], ['paused', 'пауза: тариф не активен']);
  const broken = at(
    { ...ALL_OK, google_sheets: 'reconnect_required' },
    'service:spreadsheets_sync',
  );
  assert.equal(broken.state, 'attention');
  const missing = at({}, 'service:spreadsheets_sync');
  assert.deepEqual([missing.state, missing.stateLabel], ['off', 'не подключена']);

  const manager = 'step:lead_to_manager:step-1';
  const notLinked = at({ ...ALL_OK, owner_telegram: 'not_connected' }, manager);
  assert.deepEqual([notLinked.state, notLinked.stateLabel], ['ok', 'почта; Telegram не привязан']);
  const telegramOff = at({ ...ALL_OK, owner_telegram: 'off' }, manager);
  assert.equal(telegramOff.stateLabel, 'почта');
  const none = at({ owner_email: 'off', owner_telegram: 'not_connected' }, manager);
  assert.deepEqual([none.state, none.stateLabel], ['attention', 'ни один канал не работает']);
  // Пауза тарифа уведомления не останавливает.
  assert.equal(at({ ...ALL_OK, google_sheets: 'tier_inactive' }, manager).state, 'ok');
});

test('раскладка детерминированная: та же спецификация — та же схема', () => {
  const spec = botSolutionSpec(bot(newBotAutomations()));
  assert.deepEqual(diagramFromSpec(spec, ALL_OK, 'ru'), diagramFromSpec(spec, ALL_OK, 'ru'));
});
