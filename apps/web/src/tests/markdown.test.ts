import { describe, expect, it } from 'vitest';
import { parseInline, parseMarkdown } from '@/features/chat/markdown/parse';

describe('разбор markdown на блоки', () => {
  it('различает заголовки по уровню', () => {
    expect(parseMarkdown('# Один\n\n### Три')).toEqual([
      { type: 'heading', level: 1, text: 'Один' },
      { type: 'heading', level: 3, text: 'Три' },
    ]);
  });

  it('склеивает многострочный абзац в одну строку', () => {
    expect(parseMarkdown('Первая строка\nвторая строка')).toEqual([
      { type: 'paragraph', text: 'Первая строка вторая строка' },
    ]);
  });

  it('разбирает маркированный и нумерованный списки', () => {
    expect(parseMarkdown('- один\n- два\n\n1. раз\n2) два')).toEqual([
      { type: 'list', ordered: false, items: ['один', 'два'] },
      { type: 'list', ordered: true, items: ['раз', 'два'] },
    ]);
  });

  it('склеивает перенос строки внутри пункта списка', () => {
    expect(parseMarkdown('- начало\n  продолжение')).toEqual([
      { type: 'list', ordered: false, items: ['начало продолжение'] },
    ]);
  });

  it('читает блок кода с указанным языком', () => {
    expect(parseMarkdown('```ts\nconst a = 1;\n```')).toEqual([
      { type: 'code', language: 'ts', code: 'const a = 1;' },
    ]);
  });

  it('показывает незакрытый блок кода: текст приходит по частям при стриминге', () => {
    expect(parseMarkdown('```python\nprint(1)')).toEqual([
      { type: 'code', language: 'python', code: 'print(1)' },
    ]);
  });

  it('разбирает цитату, разделитель и таблицу с выравниванием', () => {
    expect(parseMarkdown('> мысль\n> ещё')).toEqual([{ type: 'quote', text: 'мысль ещё' }]);
    expect(parseMarkdown('---')).toEqual([{ type: 'divider' }]);
    expect(parseMarkdown('| A | B |\n| --- | ---: |\n| 1 | 2 |')).toEqual([
      { type: 'table', header: ['A', 'B'], rows: [['1', '2']], align: ['left', 'right'] },
    ]);
  });

  it('не принимает строку с одной вертикальной чертой за таблицу', () => {
    expect(parseMarkdown('обычный | текст')).toEqual([
      { type: 'paragraph', text: 'обычный | текст' },
    ]);
  });
});

describe('разметка внутри строки', () => {
  it('распознаёт жирный, курсив, код, ссылку и зачёркнутый текст', () => {
    expect(parseInline('**жирный** *курсив* `код` ~~нет~~')).toEqual([
      { kind: 'bold', text: 'жирный' },
      { kind: 'text', text: ' ' },
      { kind: 'italic', text: 'курсив' },
      { kind: 'text', text: ' ' },
      { kind: 'code', text: 'код' },
      { kind: 'text', text: ' ' },
      { kind: 'strike', text: 'нет' },
    ]);
    expect(parseInline('[документация](https://example.com)')).toEqual([
      { kind: 'link', text: 'документация', href: 'https://example.com' },
    ]);
  });

  it('оставляет подчёркивания внутри слова обычным текстом', () => {
    expect(parseInline('snake_case_name')).toEqual([{ kind: 'text', text: 'snake_case_name' }]);
  });
});
