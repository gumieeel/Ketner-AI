import { describe, expect, it } from 'vitest';
import { groupThread } from '@/components/code/agent-panel';
import { buildTree, formatBytes, parentDirectories } from '@/features/code/tree';
import type { ThreadItem } from '@/features/code/types';

describe('дерево файлов проекта', () => {
  it('строит каталоги раньше файлов и сортирует по алфавиту', () => {
    const tree = buildTree([
      { path: 'z.txt', size: 1 },
      { path: 'src/b.ts', size: 2 },
      { path: 'src/a.ts', size: 3 },
      { path: 'README.md', size: 4 },
    ]);
    expect(tree.map((n) => `${n.kind}:${n.name}`)).toEqual([
      'dir:src',
      'file:README.md',
      'file:z.txt',
    ]);
    expect(tree[0].children.map((n) => n.path)).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('вложенные каталоги получают полный путь', () => {
    const tree = buildTree([{ path: 'a/b/c.ts', size: 1 }]);
    expect(tree[0].path).toBe('a');
    expect(tree[0].children[0].path).toBe('a/b');
    expect(tree[0].children[0].children[0].path).toBe('a/b/c.ts');
  });

  it('перечисляет родительские каталоги файла', () => {
    expect(parentDirectories('a/b/c.ts')).toEqual(['a', 'a/b']);
    expect(parentDirectories('c.ts')).toEqual([]);
  });

  it('форматирует размеры', () => {
    expect(formatBytes(12)).toBe('12 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB');
  });
});

describe('лента агента', () => {
  const tool = (id: string): ThreadItem => ({
    id,
    kind: 'tool',
    runId: 'r1',
    step: 1,
    tool: 'read_file',
    label: 'read_file a.ts',
    ok: true,
    summary: '',
    createdAt: '2026-01-01T00:00:00Z',
  });

  it('склеивает соседние вызовы инструментов в один список', () => {
    const groups = groupThread([
      { id: 'u', kind: 'user', text: 'сделай', createdAt: '' },
      tool('t1'),
      tool('t2'),
      { id: 'a', kind: 'assistant', text: 'готово', runId: 'r1', createdAt: '' },
      tool('t3'),
    ]);
    expect(groups.map((g) => g.type)).toEqual(['item', 'tools', 'item', 'tools']);
    const first = groups[1];
    expect(first.type === 'tools' && first.items.length).toBe(2);
  });
});
