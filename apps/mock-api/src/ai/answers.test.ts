import assert from 'node:assert/strict';
import test from 'node:test';
import { ERROR_MESSAGES, pickAnswer } from './answers.js';
import { splitIntoChunks } from './stream.js';

test('шаблон выбирается по ключевым словам запроса', () => {
  const aboutCode = pickAnswer('Отрефактори этот код', 'ru', () => 0.5);
  assert.ok(aboutCode.includes('## Что можно улучшить'));

  const aboutSql = pickAnswer('Разница между SQL и NoSQL', 'ru', () => 0.5);
  assert.ok(aboutSql.includes('| Критерий | SQL | NoSQL |'));
});

test('язык ответа совпадает с языком интерфейса', () => {
  const english = pickAnswer('Explain the difference between SQL and NoSQL', 'en', () => 0.5);
  assert.ok(english.includes('### In short'));
  assert.ok(!english.includes('Коротко'));
});

test('без совпадений берётся общий ответ', () => {
  const answer = pickAnswer('расскажи про кофе', 'ru', () => 0);
  assert.ok(answer.includes('Соберу ответ по шагам'));
});

test('чанки собираются в исходный текст без потерь', () => {
  const text = pickAnswer('привет', 'ru', () => 0);
  const chunks = splitIntoChunks(text, () => 0.5);

  assert.ok(chunks.length > 1, 'ответ должен приходить несколькими чанками');
  assert.equal(chunks.join(''), text);
});

test('текст ошибки есть для обоих языков', () => {
  assert.ok(ERROR_MESSAGES.ru.length > 0);
  assert.ok(ERROR_MESSAGES.en.length > 0);
});
