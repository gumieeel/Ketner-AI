import assert from 'node:assert/strict';
import test from 'node:test';
import { newBotAutomations } from '../builder/automations.js';
import { botSolutionSpec } from '../builder/bot-spec.js';
import { diagramFromSpec } from '../builder/diagram.js';
import { TEMPLATES } from '../builder/templates.js';
import { RECIPES } from './analysis-map.js';
import { CAPABILITIES } from './capabilities.js';

test('решение владельца 25.11: «ИИ-агент для клиентов» в каталогах, которые видит владелец', () => {
  assert.deepEqual(RECIPES.customer_bot.label, {
    ru: 'ИИ-агент для клиентов',
    en: 'AI agent for customers',
  });
  assert.deepEqual(TEMPLATES.customer_bot.label, {
    ru: 'ИИ-агент для клиентов',
    en: 'AI agent for customers',
  });
  assert.match(CAPABILITIES.customer_bot_page.label.ru, /^ИИ-агент для клиентов:/);
  assert.match(CAPABILITIES.customer_bot_page.label.en, /^AI agent for customers:/);
  const texts = [
    RECIPES.customer_bot.description.ru,
    RECIPES.customer_bot.description.en,
    CAPABILITIES.text_generation.hint.ru,
    CAPABILITIES.text_generation.hint.en,
  ];
  for (const text of texts) assert.doesNotMatch(text, /[Бб]от[а-я]* для клиентов|customer bot/);
});

test('схема агента: «Клиент пишет агенту», «Агент «<имя>»» — без «бота» (RU/EN)', () => {
  const spec = botSolutionSpec({
    name: 'Лиса',
    source: null,
    bot: {
      slug: 'lisa',
      greeting: '',
      quickReplies: [],
      dailyCapCredits: 1000,
      corrections: [],
      automations: newBotAutomations(),
    },
  });
  const connections = { google_sheets: 'connected', owner_email: 'connected' } as const;
  const ru = diagramFromSpec(spec, connections, 'ru');
  const en = diagramFromSpec(spec, connections, 'en');
  const label = (diagram: typeof ru, id: string) =>
    diagram.nodes.find((node) => node.id === id)?.label;
  assert.equal(label(ru, 'trigger'), 'Клиент пишет агенту');
  assert.equal(label(ru, 'agent:bot'), 'Агент «Лиса»');
  assert.equal(label(en, 'trigger'), 'A customer writes to the agent');
  assert.equal(label(en, 'agent:bot'), 'Agent "Лиса"');
  assert.equal(ru.description[0], 'Клиент пишет агенту → Агент «Лиса»');
  for (const text of [...ru.nodes.map((node) => node.label), ...ru.description]) {
    assert.doesNotMatch(text, /[Бб]от/);
  }
  for (const text of [...en.nodes.map((node) => node.label), ...en.description]) {
    assert.doesNotMatch(text, /\bbot\b/i);
  }
});
