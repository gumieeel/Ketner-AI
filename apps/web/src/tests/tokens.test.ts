import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REQUIRED_TOKENS = [
  '--canvas',
  '--surface',
  '--surface-2',
  '--surface-3',
  '--stroke',
  '--stroke-strong',
  '--text',
  '--muted',
  '--subtle',
  '--accent',
  '--accent-hover',
  '--accent-soft',
  '--accent-text',
  '--danger',
  '--danger-soft',
  '--danger-text',
  '--warning',
  '--warning-soft',
  '--success',
  '--success-soft',
  '--info',
  '--info-soft',
  '--grid-line',
];

describe('Дизайн-токены (index.css)', () => {
  const cssPath = resolve(__dirname, '../index.css');
  const cssContent = readFileSync(cssPath, 'utf-8');

  it('блок :root содержит все обязательные переменные контракта токенов', () => {
    const rootBlockMatch = cssContent.match(/:root\s*\{([^}]+)\}/);
    expect(rootBlockMatch).toBeTruthy();
    const rootBlock = rootBlockMatch![1];

    for (const token of REQUIRED_TOKENS) {
      expect(rootBlock, `Токен ${token} отсутствует в :root`).toContain(token);
    }
  });

  it('блок .dark содержит все обязательные переменные контракта токенов', () => {
    const darkBlockMatch = cssContent.match(/\.dark\s*\{([^}]+)\}/);
    expect(darkBlockMatch).toBeTruthy();
    const darkBlock = darkBlockMatch![1];

    for (const token of REQUIRED_TOKENS) {
      expect(darkBlock, `Токен ${token} отсутствует в .dark`).toContain(token);
    }
  });

  it('@theme inline не содержит самоссылок вида --color-x: var(--color-x)', () => {
    const themeInlineMatch = cssContent.match(/@theme\s+inline\s*\{([^}]+)\}/);
    expect(themeInlineMatch).toBeTruthy();
    const themeInline = themeInlineMatch![1];

    // Проверяем каждую строку на самоссылки: --color-something: var(--color-something)
    const selfRefRegex = /--([a-zA-Z0-9-]+)\s*:\s*var\(--\1\)/g;
    const matches = themeInline.match(selfRefRegex);
    expect(matches, `Обнаружены самоссылки в @theme inline: ${matches?.join(', ')}`).toBeNull();
  });
});
