import assert from 'node:assert/strict';
import test from 'node:test';
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
