import assert from 'node:assert/strict';
import test from 'node:test';
import { CAPABILITY_IDS } from '../capabilities.js';
import { INDUSTRIES } from '../profile.js';
import { discoveryUserMessage } from '../prompts.js';
import { contextOutputSchema } from '../schemas.js';
import {
  PLAYBOOK_PROMPT_MAX_CHARS,
  PLAYBOOKS,
  playbookFor,
  playbookForPrompt,
  type PlaybookItem,
} from './index.js';

/** Все тексты пункта (обе локали) — для проверок. */
function texts(item: PlaybookItem): string[] {
  const all = [item.title, item.pain, item.trigger, item.result, ...item.steps, ...item.dataNeeded];
  for (const need of item.needs) if (typeof need !== 'string') all.push(need.other);
  return all.flatMap((text) => [text.ru, text.en]);
}

test('восемь отраслей и общий; форма пунктов; id уникальны', () => {
  assert.deepEqual(
    PLAYBOOKS.map((playbook) => playbook.id),
    [
      'medical',
      'beauty',
      'auto',
      'online_store',
      'education',
      'real_estate',
      'b2b_services',
      'food',
      'general',
    ],
  );
  const ids = PLAYBOOKS.flatMap((playbook) => playbook.items.map((item) => item.id));
  assert.equal(new Set(ids).size, ids.length);
  for (const playbook of PLAYBOOKS) {
    assert.ok(playbook.items.length >= 4 && playbook.items.length <= 6, playbook.id);
    for (const item of playbook.items) {
      assert.ok(item.steps.length >= 2 && item.steps.length <= 6, item.id);
      assert.ok(item.dataNeeded.length >= 1, item.id);
      assert.ok(item.needs.length >= 1, item.id);
      for (const text of texts(item)) assert.ok(text.trim().length > 0, item.id);
    }
  }
});

test('без чисел-бенчмарков: в текстах плейбуков нет цифр (кроме «B2B»)', () => {
  for (const playbook of PLAYBOOKS) {
    const all = [playbook.name.ru, playbook.name.en, ...playbook.items.flatMap(texts)];
    for (const text of all) {
      assert.doesNotMatch(text.replace(/B2B/g, ''), /\d/, `${playbook.id}: ${text}`);
      assert.doesNotMatch(text, /%/, `${playbook.id}: ${text}`);
    }
  }
});

test('«Нужно» — только id каталога или «other» с описанием; статуса в плейбуке нет', () => {
  for (const playbook of PLAYBOOKS) {
    for (const item of playbook.items) {
      for (const need of item.needs) {
        if (typeof need === 'string') {
          assert.ok((CAPABILITY_IDS as readonly string[]).includes(need), `${item.id}: ${need}`);
        } else {
          assert.ok(need.other.ru && need.other.en, item.id);
        }
      }
      assert.ok(!('status' in item), item.id);
    }
  }
});

test('текст для промпта: все пункты, не длиннее лимита, без цифр', () => {
  for (const playbook of PLAYBOOKS) {
    for (const language of ['ru', 'en'] as const) {
      const text = playbookForPrompt(playbook, language);
      assert.ok(text.length <= PLAYBOOK_PROMPT_MAX_CHARS, `${playbook.id} ${language}`);
      assert.equal(
        text.split('\n').length - 1,
        playbook.items.length,
        `${playbook.id} ${language}`,
      );
      assert.doesNotMatch(text.replace(/B2B/g, ''), /\d/);
    }
  }
  const ru = playbookForPrompt(playbookFor('medical', null), 'ru');
  assert.match(ru, /«Клиники и медицинские центры»/);
  assert.match(
    ru,
    /Онлайн-запись без администратора\. Боль: .+ Процесс: .+ → .+ Нужно: customer_bot_page, text_generation, messengers, other \(запись в календарь/,
  );
});

test('выбор плейбука: по отрасли; услуги B2B — агентства; иначе общий; новое значение real_estate', () => {
  assert.ok((INDUSTRIES as readonly string[]).includes('real_estate'));
  assert.equal(playbookFor('medical', null).id, 'medical');
  assert.equal(playbookFor('real_estate', 'b2c').id, 'real_estate');
  assert.equal(playbookFor('services', 'b2b').id, 'b2b_services');
  assert.equal(playbookFor('services', 'mixed').id, 'b2b_services');
  assert.equal(playbookFor('services', 'b2c').id, 'general');
  assert.equal(playbookFor('agro', null).id, 'general');
  assert.equal(playbookFor(null, null).id, 'general');
  // Разбор профиля терпимый: незнакомая отрасль — null, а не ошибка.
  const parsed = contextOutputSchema.parse({
    domain: 'd',
    summary: 's',
    profile: { industry: 'real_estate' },
  });
  assert.equal(parsed.profile?.industry, 'real_estate');
});

test('плейбук — в сообщении поиска возможностей отдельным блоком справки, до данных пользователя', () => {
  const context = contextOutputSchema.parse({ domain: 'd', summary: 's' });
  const message = discoveryUserMessage('ru', context, [], 'СПРАВКА');
  assert.match(
    message,
    /^<reference>\nСПРАВКА\n<\/reference>\nКонтекст и ответы \(JSON\):\n<user_data>/,
  );
  assert.doesNotMatch(discoveryUserMessage('ru', context, []), /<reference>/);
});
