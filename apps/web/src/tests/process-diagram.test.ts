import { describe, expect, it } from 'vitest';
import { diagramSize, wrapText } from '@/pages/solutions/process-diagram-layout';

describe('схема: перенос подписей и размер', () => {
  it('переносит по словам в две строки и обрезает только вторую', () => {
    expect(wrapText('Новая заявка', 20)).toEqual(['Новая заявка']);
    expect(wrapText('Агент «Ketner AI — ассистент поддержки»', 20)).toEqual([
      'Агент «Ketner AI —',
      'ассистент поддержки»',
    ]);
    expect(wrapText('Агент «Ketner AI — ассистент поддержки клиентов магазина»', 20)).toEqual([
      'Агент «Ketner AI —',
      'ассистент поддержки…',
    ]);
    // Слово длиннее строки режется, а не вылезает за узел.
    expect(wrapText('Суперкалифраджилистикэкспиалидоцио', 20)).toEqual(['Суперкалифраджилист…']);
  });

  it('пять колонок помещаются в 1100 px и не помещаются в колонку кабинета (650 px)', () => {
    const nodes = [0, 1, 2, 3, 4].map((level) => ({ level, row: 0 }));
    const { width } = diagramSize({ nodes: nodes as never });
    expect(width).toBeLessThanOrEqual(1100);
    expect(width).toBeGreaterThan(650);
  });
});
