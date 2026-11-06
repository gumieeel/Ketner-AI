import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { runMigrations } from '../db/migrate.js';
import { MIGRATIONS } from '../db/migration-list.js';
import { openTestSql } from '../testing/sql.js';
import { defaultConfig } from './service.js';
import { MemoryBuilderStore, PostgresBuilderStore, type BuilderStore } from './store.js';
import type { BotMessage, Solution, TestCase, TestRun } from './types.js';
import { isToolConfig } from './types.js';

const NOW = '2026-10-31T10:00:00.000Z';

function solution(id: string, ownerId: string): Solution {
  return {
    id,
    ownerId,
    type: 'assistant',
    template: 'personal_assistant',
    bot: null,
    status: 'draft',
    name: `Помощник ${id}`,
    currentVersion: 1,
    activeVersion: null,
    source: { analysisId: 'an-1', opportunityId: 'o-1', title: 'Возможность' },
    createdAt: NOW,
    updatedAt: NOW,
    version: 1,
  };
}

function testCase(id: string, solutionId: string, position: number): TestCase {
  return {
    id,
    solutionId,
    position,
    input: `Вопрос ${position}`,
    criteria: ['Вежливо'],
    createdAt: NOW,
    updatedAt: NOW,
  };
}

async function contract(store: BuilderStore): Promise<void> {
  await store.createSolution(
    solution('s1', 'alice'),
    { solutionId: 's1', number: 1, config: defaultConfig('Помощник', 'ru'), createdAt: NOW },
    [testCase('c1', 's1', 0)],
  );
  await store.createSolution(
    solution('s2', 'bob'),
    { solutionId: 's2', number: 1, config: defaultConfig('Чужой', 'ru'), createdAt: NOW },
    [],
  );

  // Владелец видит своё, чужое — нет.
  assert.equal((await store.getSolution('alice', 's1'))?.source?.opportunityId, 'o-1');
  // Шаблон решения сохраняется и читается как есть.
  assert.equal((await store.getSolution('alice', 's1'))?.template, 'personal_assistant');
  assert.equal((await store.listSolutions('alice'))[0]?.template, 'personal_assistant');
  assert.equal(await store.getSolution('alice', 's2'), null);
  assert.deepEqual(
    (await store.listSolutions('alice')).map((item) => item.id),
    ['s1'],
  );

  // Версии: только своему помощнику, номер не повторяется.
  assert.equal(
    await store.addVersion('alice', {
      solutionId: 's1',
      number: 2,
      config: { ...defaultConfig('Помощник', 'ru'), instructions: 'Кратко' },
      createdAt: NOW,
    }),
    true,
  );
  assert.equal(
    await store.addVersion('alice', {
      solutionId: 's1',
      number: 2,
      config: defaultConfig('x', 'ru'),
      createdAt: NOW,
    }),
    false,
  );
  assert.equal(
    await store.addVersion('bob', {
      solutionId: 's1',
      number: 3,
      config: defaultConfig('x', 'ru'),
      createdAt: NOW,
    }),
    false,
  );
  const second = (await store.getVersion('alice', 's1', 2))?.config;
  assert.ok(second && !isToolConfig(second));
  assert.equal(second.instructions, 'Кратко');
  assert.equal(await store.getVersion('bob', 's1', 2), null);
  assert.deepEqual(
    (await store.listVersions('alice', 's1')).map((item) => item.number),
    [2, 1],
  );

  // Запись помощника — с версией.
  const current = (await store.getSolution('alice', 's1')) as Solution;
  const updated = await store.updateSolution(
    { ...current, currentVersion: 2, status: 'active', activeVersion: 2 },
    current.version,
  );
  assert.equal(updated?.activeVersion, 2);
  assert.equal(await store.updateSolution({ ...current, name: 'x' }, current.version), null);
  assert.equal(await store.updateSolution({ ...current, ownerId: 'bob' }, updated!.version), null);

  // Кейсы.
  assert.equal(await store.saveCase('alice', testCase('c2', 's1', 1)), true);
  assert.equal(await store.saveCase('bob', testCase('c3', 's1', 2)), false);
  assert.equal(
    await store.saveCase('alice', { ...testCase('c1', 's1', 0), input: 'Изменённый' }),
    true,
  );
  assert.deepEqual(
    (await store.listCases('alice', 's1')).map((item) => item.input),
    ['Изменённый', 'Вопрос 1'],
  );
  assert.equal(await store.deleteCase('bob', 's1', 'c2'), false);
  assert.equal(await store.deleteCase('alice', 's1', 'c2'), true);

  // Прогоны.
  const run: TestRun = {
    id: 'r1',
    solutionId: 's1',
    ownerId: 'alice',
    versionNumber: 2,
    casesHash: 'h',
    status: 'running',
    results: [],
    createdAt: NOW,
    finishedAt: null,
    version: 1,
  };
  assert.equal(await store.createRun(run), true);
  assert.equal(await store.createRun({ ...run, id: 'r2', ownerId: 'bob' }), false);
  const done = await store.updateRun({ ...run, status: 'done', finishedAt: NOW }, 1);
  assert.equal(done?.status, 'done');
  assert.equal(await store.updateRun({ ...run, status: 'done' }, 1), null);
  assert.equal((await store.latestRun('alice', 's1'))?.id, 'r1');
  assert.equal(await store.getRun('bob', 'r1'), null);

  // Чат.
  assert.equal(
    await store.createThread({
      id: 't1',
      solutionId: 's1',
      ownerId: 'alice',
      title: 'Чат',
      createdAt: NOW,
      updatedAt: NOW,
    }),
    true,
  );
  assert.equal(
    await store.createThread({
      id: 't2',
      solutionId: 's1',
      ownerId: 'bob',
      title: 'Чужой',
      createdAt: NOW,
      updatedAt: NOW,
    }),
    false,
  );
  for (let index = 0; index < 3; index += 1) {
    await store.addMessage({
      id: `m${index}`,
      threadId: 't1',
      ownerId: 'alice',
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: `Сообщение ${index}`,
      model: index % 2 === 1 ? { id: 'ketner-pro', name: 'MiMo-V2.6 Pro' } : null,
      image: null,
      status: 'complete',
      createdAt: `2026-10-31T10:00:0${index}.000Z`,
    });
  }
  assert.equal(
    await store.addMessage({
      id: 'mx',
      threadId: 't1',
      ownerId: 'bob',
      role: 'user',
      content: 'Чужое',
      model: null,
      image: null,
      status: 'complete',
      createdAt: NOW,
    }),
    false,
  );
  const last = await store.listMessages('alice', 't1', 2);
  assert.deepEqual(
    last.map((item) => item.content),
    ['Сообщение 1', 'Сообщение 2'],
  );
  assert.equal(last[0].model?.name, 'MiMo-V2.6 Pro');
  assert.deepEqual(await store.listMessages('bob', 't1', 10), []);

  // Удаление — со всем содержимым; чужое не удаляется.
  assert.equal(await store.deleteSolution('bob', 's1'), false);
  assert.equal(await store.deleteSolution('alice', 's1'), true);
  assert.equal(await store.getThread('alice', 't1'), null);
  assert.equal(await store.getRun('alice', 'r1'), null);
  assert.deepEqual(await store.listCases('alice', 's1'), []);
}

function botSolution(id: string, ownerId: string, slug: string): Solution {
  return {
    ...solution(id, ownerId),
    type: 'customer_bot',
    template: 'customer_bot',
    name: `Бот ${id}`,
    bot: {
      slug,
      greeting: 'Здравствуйте!',
      quickReplies: ['Цены'],
      dailyCapCredits: 1000,
      corrections: [],
    },
  };
}

function botMessage(
  id: string,
  conversationId: string,
  role: BotMessage['role'],
  createdAt: string,
  creditsUsd = 0,
): BotMessage {
  return {
    id,
    conversationId,
    solutionId: 'b1',
    ownerId: 'alice',
    role,
    content: `${role} ${id}`,
    model: role === 'assistant' ? { id: 'auto', name: 'Auto' } : null,
    offerContact: role === 'assistant' && id.endsWith('x'),
    creditsUsd,
    status: 'complete',
    createdAt,
  };
}

async function botContract(store: BuilderStore): Promise<void> {
  await store.createSolution(
    botSolution('b1', 'alice', 'lisa-shop'),
    { solutionId: 'b1', number: 1, config: defaultConfig('Бот', 'ru'), createdAt: NOW },
    [],
  );
  // Адрес: найден без владельца, занят; помощник без бота адрес не занимает.
  assert.equal((await store.getSolutionBySlug('lisa-shop'))?.id, 'b1');
  assert.equal((await store.getSolutionBySlug('lisa-shop'))?.bot?.quickReplies[0], 'Цены');
  assert.equal(await store.getSolutionBySlug('nobody'), null);
  assert.equal(await store.slugTaken('lisa-shop'), true);
  assert.equal(await store.slugTaken('other'), false);
  // Второй бот с тем же адресом не записывается.
  await assert.rejects(
    store.createSolution(
      botSolution('b2', 'bob', 'lisa-shop'),
      { solutionId: 'b2', number: 1, config: defaultConfig('Бот', 'ru'), createdAt: NOW },
      [],
    ),
  );

  // Смена адреса и настроек — через обычное обновление с версией записи.
  const current = (await store.getSolution('alice', 'b1'))!;
  const renamed = await store.updateSolution(
    {
      ...current,
      bot: { ...current.bot!, slug: 'lisa', corrections: [{ question: 'q', answer: 'a' }] },
    },
    current.version,
  );
  assert.equal(renamed?.bot?.slug, 'lisa');
  assert.equal(await store.slugTaken('lisa-shop'), false);
  assert.deepEqual((await store.getSolution('alice', 'b1'))?.bot?.corrections, [
    { question: 'q', answer: 'a' },
  ]);

  // Диалоги и сообщения.
  await store.createConversation({
    id: 'c1',
    solutionId: 'b1',
    ownerId: 'alice',
    visitorId: 'v_visitor000001',
    messageCount: 0,
    createdAt: NOW,
    updatedAt: NOW,
  });
  await store.addBotMessage(botMessage('m1', 'c1', 'user', '2026-10-31T10:00:01.000Z'));
  await store.addBotMessage(
    botMessage('m2x', 'c1', 'assistant', '2026-10-31T10:00:02.000Z', 0.004),
  );
  await store.addBotMessage(botMessage('m3', 'c1', 'user', '2026-10-31T10:00:03.000Z'));
  await store.addBotMessage(botMessage('m4', 'c1', 'assistant', '2026-10-31T10:00:04.000Z', 0.002));
  assert.equal((await store.getConversation('b1', 'c1'))?.visitorId, 'v_visitor000001');
  assert.equal(await store.getConversation('other', 'c1'), null);
  const conversation = (await store.listConversations('alice', 'b1', 10))[0];
  assert.equal(conversation?.messageCount, 4);
  assert.equal(conversation?.updatedAt, '2026-10-31T10:00:04.000Z');
  assert.deepEqual(await store.listConversations('bob', 'b1', 10), []);
  const history = await store.botHistory('b1', 'c1', 2);
  assert.deepEqual(
    history.map((item) => item.id),
    ['m3', 'm4'],
  );
  const all = await store.listBotMessages('alice', 'b1', 'c1');
  assert.equal(all.length, 4);
  assert.equal(all[1]?.offerContact, true);
  assert.equal(all[1]?.model?.name, 'Auto');
  assert.deepEqual(await store.listBotMessages('bob', 'b1', 'c1'), []);
  const usage = await store.botUsageSince('b1', '2026-10-31T10:00:03.000Z');
  assert.equal(usage.replies, 1);
  assert.ok(Math.abs(usage.creditsUsd - 0.002) < 1e-9);
  const dayUsage = await store.botUsageSince('b1', '2026-10-31T00:00:00.000Z');
  assert.equal(dayUsage.replies, 2);
  assert.ok(Math.abs(dayUsage.creditsUsd - 0.006) < 1e-9);

  // Заявки: видит и меняет только владелец.
  await store.createLead({
    id: 'l1',
    solutionId: 'b1',
    ownerId: 'alice',
    conversationId: 'c1',
    name: 'Анна',
    contact: '+7 700 000 00 00',
    question: 'Есть ли доставка?',
    status: 'new',
    createdAt: NOW,
    updatedAt: NOW,
  });
  assert.equal(await store.countNewLeads('alice', 'b1'), 1);
  assert.equal((await store.listLeads('alice', 'b1', 10))[0]?.contact, '+7 700 000 00 00');
  assert.deepEqual(await store.listLeads('bob', 'b1', 10), []);
  assert.equal(await store.setLeadStatus('bob', 'b1', 'l1', 'done', NOW), null);
  assert.equal((await store.setLeadStatus('alice', 'b1', 'l1', 'done', NOW))?.status, 'done');
  assert.equal(await store.countNewLeads('alice', 'b1'), 0);

  // Удаление бота — с диалогами и заявками; адрес освобождается.
  assert.equal(await store.deleteSolution('alice', 'b1'), true);
  assert.equal(await store.getConversation('b1', 'c1'), null);
  assert.deepEqual(await store.listLeads('alice', 'b1', 10), []);
  assert.equal(await store.slugTaken('lisa'), false);
}

test('бот для клиентов в памяти: адрес, диалоги, расход, заявки', async () => {
  await botContract(new MemoryBuilderStore());
});

test('бот для клиентов в Postgres: та же логика', async (t) => {
  const sql = await openTestSql();
  if (!sql) {
    t.skip('нет PGlite и TEST_DATABASE_URL');
    return;
  }
  try {
    await runMigrations(sql.db, MIGRATIONS);
    await botContract(new PostgresBuilderStore(sql.runner));
  } finally {
    await sql.close();
  }
});

test('хранилище Builder в памяти: владелец, версии, кейсы, прогоны, чат, удаление', async () => {
  await contract(new MemoryBuilderStore());
});

test('хранилище Builder в Postgres: та же логика', async (t) => {
  const sql = await openTestSql();
  if (!sql) {
    t.skip('нет PGlite и TEST_DATABASE_URL');
    return;
  }
  try {
    await runMigrations(sql.db, MIGRATIONS);
    await contract(new PostgresBuilderStore(sql.runner));
  } finally {
    await sql.close();
  }
});

test('миграция 0007: существующие решения получают шаблон, тип проверяется базой', async (t) => {
  const sql = await openTestSql();
  if (!sql) {
    t.skip('нет PGlite и TEST_DATABASE_URL');
    return;
  }
  try {
    // Состояние базы до 0007 (как в production): решения обоих типов без шаблона.
    const before = MIGRATIONS.findIndex((migration) => migration.id === '0007_solution_templates');
    assert.ok(before > 0);
    await runMigrations(sql.db, MIGRATIONS.slice(0, before));
    for (const [id, type, slug] of [
      ['old-assistant', 'assistant', null],
      ['old-bot', 'customer_bot', 'old-bot'],
    ] as const) {
      await sql.runner.query(
        `INSERT INTO solutions (id, user_id, type, status, name, current_version, slug)
         VALUES ($1, 'alice', $2, 'draft', $1, 1, $3)`,
        [id, type, slug],
      );
    }

    const result = await runMigrations(sql.db, MIGRATIONS.slice(0, before + 1));
    assert.deepEqual(result.applied, ['0007_solution_templates']);

    const store = new PostgresBuilderStore(sql.runner);
    const assistant = await store.getSolution('alice', 'old-assistant');
    const bot = await store.getSolution('alice', 'old-bot');
    assert.equal(assistant?.type, 'assistant');
    assert.equal(assistant?.template, 'personal_assistant');
    assert.equal(bot?.type, 'customer_bot');
    assert.equal(bot?.template, 'customer_bot');

    // Новые виды разрешены, неизвестный тип и пустой шаблон — нет.
    await sql.runner.query(
      `INSERT INTO solutions (id, user_id, type, template, status, name, current_version)
       VALUES ('new-tool', 'alice', 'tool', 'future_tool', 'draft', 'Инструмент', 1)`,
    );
    await assert.rejects(
      sql.runner.query(
        `INSERT INTO solutions (id, user_id, type, template, status, name, current_version)
         VALUES ('bad-type', 'alice', 'chatbot', 'personal_assistant', 'draft', 'x', 1)`,
      ),
    );
    await assert.rejects(
      sql.runner.query(
        `INSERT INTO solutions (id, user_id, type, status, name, current_version)
         VALUES ('no-template', 'alice', 'assistant', 'draft', 'x', 1)`,
      ),
    );
    // Решение с шаблоном, которого нет в этой версии кода, читается как есть.
    assert.equal((await store.getSolution('alice', 'new-tool'))?.template, 'future_tool');
  } finally {
    await sql.close();
  }
});

/** INSERT кода до 0007 (main): без колонки template — так вставляет приложение после отката. */
const LEGACY_INSERT = `INSERT INTO solutions (id, user_id, type, status, name, current_version, active_version,
  source, version, created_at, updated_at, bot, slug)
  VALUES ($1, 'alice', $2, 'draft', $1, 1, NULL, 'null'::jsonb, 1, now(), now(), $3::text::jsonb, $4)`;

test('миграция 0011: код до 0007 вставляет помощника и бота без шаблона — шаблон из типа', async (t) => {
  const sql = await openTestSql();
  if (!sql) {
    t.skip('нет PGlite и TEST_DATABASE_URL');
    return;
  }
  try {
    const result = await runMigrations(sql.db, MIGRATIONS);
    assert.ok(result.applied.includes('0011_solution_template_legacy_insert'));
    const store = new PostgresBuilderStore(sql.runner);
    const templateOf = async (id: string) =>
      (
        await sql.runner.query<{ type: string; template: string }>(
          'SELECT type, template FROM solutions WHERE id = $1',
          [id],
        )
      )[0];

    // Код до 0007: помощник и бот без template.
    await sql.runner.query(LEGACY_INSERT, ['legacy-assistant', 'assistant', 'null', null]);
    await sql.runner.query(LEGACY_INSERT, [
      'legacy-bot',
      'customer_bot',
      JSON.stringify({ slug: 'legacy-bot' }),
      'legacy-bot',
    ]);
    assert.deepEqual(await templateOf('legacy-assistant'), {
      type: 'assistant',
      template: 'personal_assistant',
    });
    assert.deepEqual(await templateOf('legacy-bot'), {
      type: 'customer_bot',
      template: 'customer_bot',
    });
    // И нынешний код читает их как обычные решения.
    assert.equal(
      (await store.getSolution('alice', 'legacy-assistant'))?.template,
      'personal_assistant',
    );
    assert.equal((await store.getSolution('alice', 'legacy-bot'))?.template, 'customer_bot');

    // Явно указанный шаблон не трогается — даже непривычный для типа.
    await sql.runner.query(
      `INSERT INTO solutions (id, user_id, type, template, status, name, current_version)
       VALUES ('explicit', 'alice', 'assistant', 'future_assistant', 'draft', 'x', 1)`,
    );
    assert.equal((await templateOf('explicit'))?.template, 'future_assistant');

    // Инструмент, процесс без шаблона — отказ, а не «помощник»; неизвестный тип — отказ CHECK.
    for (const type of ['tool', 'workflow']) {
      await assert.rejects(
        sql.runner.query(LEGACY_INSERT, [`no-template-${type}`, type, 'null', null]),
        /null value|not-null|template/i,
        type,
      );
    }
    // Неизвестный тип без шаблона: триггер его не трогает — отказ (NOT NULL срабатывает раньше CHECK).
    await assert.rejects(
      sql.runner.query(LEGACY_INSERT, ['bad-type', 'chatbot', 'null', null]),
      /null value|not-null|check/i,
    );
    // Неизвестный тип даже с шаблоном — отказ CHECK.
    await assert.rejects(
      sql.runner.query(
        `INSERT INTO solutions (id, user_id, type, template, status, name, current_version)
         VALUES ('bad-type-2', 'alice', 'chatbot', 'personal_assistant', 'draft', 'x', 1)`,
      ),
      /solutions_type_check|check/i,
    );
    await assert.rejects(
      sql.runner.query(LEGACY_INSERT, ['null-type', null, 'null', null]),
      /null value|not-null|type/i,
    );
    // Обнулить шаблон у существующего решения нельзя (NOT NULL на месте, триггер — только INSERT).
    await assert.rejects(
      sql.runner.query(`UPDATE solutions SET template = NULL WHERE id = 'legacy-assistant'`),
    );
    const rows = await sql.runner.query<{ id: string }>('SELECT id FROM solutions ORDER BY id');
    assert.deepEqual(
      rows.map((row) => row.id),
      ['explicit', 'legacy-assistant', 'legacy-bot'],
    );

    // Новый учебный помощник через нынешний код — со своим явным шаблоном.
    await store.createSolution(
      {
        id: 'study',
        ownerId: 'alice',
        type: 'tool',
        template: 'study_assistant',
        bot: null,
        status: 'active',
        name: 'Учебный помощник',
        currentVersion: 1,
        activeVersion: 1,
        source: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        version: 1,
      },
      {
        solutionId: 'study',
        number: 1,
        config: { tool: 'study_assistant', language: 'ru', subject: '' },
        createdAt: new Date().toISOString(),
      },
      [],
    );
    assert.deepEqual(await templateOf('study'), { type: 'tool', template: 'study_assistant' });
  } finally {
    await sql.close();
  }
});

/** SQL процедуры отката из docs/operations.md — тест выполняет ровно то, что написано в инструкции. */
function rollbackSql(name: 'park' | 'unpark'): string {
  const doc = readFileSync(join(import.meta.dirname, '../../../../docs/operations.md'), 'utf8');
  const match = new RegExp(`<!-- rollback:${name} -->\\s*\`\`\`sql\\n([\\s\\S]*?)\`\`\``).exec(doc);
  assert.ok(match?.[1], `в docs/operations.md нет блока rollback:${name}`);
  return match[1];
}

test('откат кода: инструменты прячутся от старого кода и возвращаются без потерь', async (t) => {
  const sql = await openTestSql();
  if (!sql) {
    t.skip('нет PGlite и TEST_DATABASE_URL');
    return;
  }
  try {
    await runMigrations(sql.db, MIGRATIONS);
    const store = new PostgresBuilderStore(sql.runner);
    const at = new Date().toISOString();
    const add = (id: string, type: Solution['type'], template: string) =>
      store.createSolution(
        {
          id,
          ownerId: 'alice',
          type,
          template,
          bot: null,
          status: 'active',
          name: id,
          currentVersion: 1,
          activeVersion: 1,
          source: null,
          createdAt: at,
          updatedAt: at,
          version: 1,
        },
        {
          solutionId: id,
          number: 1,
          config:
            type === 'tool'
              ? { tool: 'study_assistant', language: 'ru', subject: '' }
              : defaultConfig(id, 'ru'),
          createdAt: at,
        },
        [],
      );
    await add('assistant', 'assistant', 'personal_assistant');
    await add('study', 'tool', 'study_assistant');
    await sql.runner.query(
      `INSERT INTO solution_materials (id, solution_id, user_id, name, format, size_bytes, char_count,
         outline, sections, content_hash)
       VALUES ('m1', 'study', 'alice', 'Биология.pdf', 'pdf', 10, 5, '[]'::jsonb,
         '[{"id":"s1","label":"Стр. 1","text":"Ядро"}]'::jsonb, 'h1')`,
    );
    // Запросы старого кода (main до 0007): поиск решений только по user_id.
    const legacyList = async () =>
      (
        await sql.runner.query<{ id: string }>(
          'SELECT id FROM solutions WHERE user_id = $1 ORDER BY id',
          ['alice'],
        )
      ).map((row) => row.id);
    assert.deepEqual(await legacyList(), ['assistant', 'study']);

    await sql.runner.query(rollbackSql('park'));
    await sql.runner.query(rollbackSql('park')); // повтор безопасен
    assert.deepEqual(await legacyList(), ['assistant'], 'старый код видит только помощника');
    assert.equal(
      (
        await sql.runner.query('SELECT id FROM solutions WHERE id = $1 AND user_id = $2', [
          'study',
          'alice',
        ])
      ).length,
      0,
    );
    assert.equal(await store.getSolution('alice', 'study'), null);

    await sql.runner.query(rollbackSql('unpark'));
    await sql.runner.query(rollbackSql('unpark')); // повтор безопасен
    assert.deepEqual(await legacyList(), ['assistant', 'study']);
    const study = await store.getSolution('alice', 'study');
    assert.equal(study?.template, 'study_assistant');
    assert.equal(study?.type, 'tool');
    const version = await store.getVersion('alice', 'study', 1);
    assert.ok(version && isToolConfig(version.config));
    const materials = await sql.runner.query<{ id: string }>(
      'SELECT id FROM solution_materials WHERE solution_id = $1',
      ['study'],
    );
    assert.deepEqual(
      materials.map((row) => row.id),
      ['m1'],
      'материалы не тронуты',
    );
    assert.equal((await store.getSolution('alice', 'assistant'))?.template, 'personal_assistant');
  } finally {
    await sql.close();
  }
});
