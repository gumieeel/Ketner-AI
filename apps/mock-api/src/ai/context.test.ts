import assert from 'node:assert/strict';
import test from 'node:test';
import { ContextOptimizer } from './context.js';

test('cleanText: обычный текст чистится как раньше', () => {
  assert.equal(ContextOptimizer.cleanText('  Привет \r\n\r\n\r\n   мир   '), 'Привет\n\nмир');
  assert.equal(ContextOptimizer.cleanText('a    b\t\tc'), 'a b c');
});

test('cleanText: код внутри ограждения не меняется (отступы Python/YAML сохраняются)', () => {
  const code = 'def f(x):\n    if x:\n        return  x   + 1\n    return 0';
  const input = `Вот код:\n\n\`\`\`python\n${code}\n\`\`\`\n\nГотово.`;
  const out = ContextOptimizer.cleanText(input);
  assert.ok(out.includes(code), 'код должен остаться байт-в-байт');
  assert.ok(out.includes('Вот код:'));
});

test('cleanText: незакрытое ограждение (оборванный ответ) тоже защищает код', () => {
  const input = 'Файл:\n```yaml\nservices:\n  web:\n    image: x\n    ports:\n      - "80:80"';
  const out = ContextOptimizer.cleanText(input);
  assert.ok(out.includes('services:\n  web:\n    image: x\n    ports:\n      - "80:80"'));
});

test('cleanText: код без ограждения (серия строк с отступом) сохраняется', () => {
  const input = 'Исправь функцию:\n\n    function a() {\n      return 1;\n    }\n\nСпасибо';
  const out = ContextOptimizer.cleanText(input);
  assert.ok(out.includes('    function a() {\n      return 1;\n    }'));
});

test('cleanText: пробелы в конце строк внутри кода убираются, перевод строк нормализуется', () => {
  const out = ContextOptimizer.cleanText('```\r\nline  \r\n  indented\r\n```');
  assert.equal(out, '```\nline\n  indented\n```');
});

test('optimize: индентация системного промпта с кодом проекта доходит до модели', () => {
  const systemPrompt = 'Ты помощник.\n\n--- File: a.py ---\n```python\nclass A:\n    def m(self):\n        pass\n```';
  const result = ContextOptimizer.optimize(
    [{ role: 'user', content: 'Что делает класс?' }],
    { maxMessages: 10, systemPrompt },
  );
  assert.ok(result[0].content.includes('class A:\n    def m(self):\n        pass'));
});
