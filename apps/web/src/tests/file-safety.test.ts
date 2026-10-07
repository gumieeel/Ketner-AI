import { describe, expect, it } from 'vitest';
import { parseFileProposals, stripFileActionBlocks } from '../features/chat/file-operations/patch-parser';
import { isSensitivePath, sanitizeChangePath } from '../features/chat/file-operations/path-safety';
import { applyTextEdits, applyTextReplace } from '../features/chat/file-operations/text-patch';
import type { WorkspaceContext, WorkspaceFile } from '../features/chat/types';

function workspace(files: WorkspaceFile[], overrides: Partial<WorkspaceContext> = {}): WorkspaceContext {
  return {
    id: 'ws',
    type: 'local_folder',
    name: 'proj',
    pathOrUrl: 'proj',
    filesCount: files.length,
    files,
    indexedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function actions(items: unknown[]): string {
  return 'Готово.\n\n```file-actions\n' + JSON.stringify(items, null, 2) + '\n```\n';
}

const MATH = 'export function add(a: number, b: number) {\n  return a + b;\n}\n';

describe('path-safety: sanitizeChangePath', () => {
  it('отклоняет выход за пределы проекта, .git и абсолютные пути', () => {
    for (const bad of ['../secret.txt', 'src/../../etc/passwd', '.git/config', 'a/.git/hooks/pre-commit', 'C:\\Windows\\x.dll', '//host/share/x', '', '  ', 'src/']) {
      expect(sanitizeChangePath(bad).ok).toBe(false);
    }
    expect(sanitizeChangePath(42).ok).toBe(false);
  });

  it('нормализует разделители и ведущие ./ и /', () => {
    expect(sanitizeChangePath('./src\\a.ts')).toEqual({ ok: true, path: 'src/a.ts' });
    expect(sanitizeChangePath('/src//a.ts')).toEqual({ ok: true, path: 'src/a.ts' });
  });

  it('убирает имя корневой папки и подбирает регистр по файлам проекта', () => {
    const known = ['src/App.ts'];
    expect(sanitizeChangePath('proj/src/App.ts', { knownPaths: known, rootName: 'proj' })).toEqual({ ok: true, path: 'src/App.ts' });
    expect(sanitizeChangePath('SRC/app.ts', { knownPaths: known })).toEqual({ ok: true, path: 'src/App.ts' });
    // Если вложенная папка с таким именем реально есть — это не корень.
    expect(sanitizeChangePath('proj/a.ts', { knownPaths: ['proj/a.ts'], rootName: 'proj' })).toEqual({ ok: true, path: 'proj/a.ts' });
  });

  it('распознаёт файлы с секретами', () => {
    for (const secret of ['.env', 'apps/api/.env.production', 'keys/server.pem', '.ssh/id_rsa', 'config/credentials.json']) {
      expect(isSensitivePath(secret)).toBe(true);
    }
    expect(isSensitivePath('src/environment.ts')).toBe(false);
  });
});

describe('text-patch: applyTextReplace', () => {
  it('заменяет точное вхождение', () => {
    const result = applyTextReplace(MATH, 'return a + b;', 'return a - b;');
    expect(result.ok && result.text).toBe(MATH.replace('a + b', 'a - b'));
  });

  it('при промахе возвращает ошибку и не подставляет заменяющий текст', () => {
    const result = applyTextReplace(MATH, 'return a * b;', 'return 0;');
    expect(result.ok).toBe(false);
  });

  it('подсказывает, что правка уже применена', () => {
    const applied = MATH.replace('a + b;', 'a - b;');
    const result = applyTextReplace(applied, 'return a + b;', 'return a - b;');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('уже применено');
  });

  it('сохраняет CRLF файла, если модель прислала LF', () => {
    const crlf = 'line1\r\nline2\r\nline3\r\n';
    const result = applyTextReplace(crlf, 'line2\n', 'LINE2\n');
    expect(result.ok && result.text).toBe('line1\r\nLINE2\r\nline3\r\n');
  });

  it('терпим к пробелам в конце строк и пустым строкам по краям фрагмента', () => {
    const file = 'if (x) {   \n  run();  \n}\n';
    const result = applyTextReplace(file, '\nif (x) {\n  run();\n}\n\n', 'if (x) {\n  stop();\n}');
    expect(result.ok && result.text).toBe('if (x) {\n  stop();\n}\n');
  });

  it('считает вхождения и меняет только первое', () => {
    const result = applyTextReplace('a = 1;\nb = 1;\n', '= 1;', '= 2;');
    expect(result.ok && result.occurrences).toBe(2);
    expect(result.ok && result.text).toBe('a = 2;\nb = 1;\n');
  });

  it('использует замену как есть: `$&` и `$1` не интерпретируются', () => {
    const result = applyTextReplace('const price = X;', 'X', "'$&' + '$1'");
    expect(result.ok && result.text).toBe("const price = '$&' + '$1';");
  });

  it('отклоняет пустой фрагмент', () => {
    expect(applyTextReplace('abc', '   ', 'x').ok).toBe(false);
  });

  it('applyTextEdits применяет правки по очереди и сообщает номер неудачной', () => {
    const ok = applyTextEdits('one two', [
      { targetContent: 'one', replacementContent: '1' },
      { targetContent: 'two', replacementContent: '2' },
    ]);
    expect(ok.ok && ok.text).toBe('1 2');

    const bad = applyTextEdits('one two', [
      { targetContent: 'one', replacementContent: '1' },
      { targetContent: 'three', replacementContent: '3' },
    ]);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.reason).toContain('правка 2 из 2');
  });
});

describe('patch-parser: безопасное применение правок', () => {
  const ws = workspace([
    { path: 'src/math.ts', size: MATH.length, content: MATH },
    { path: 'big.ts', size: 90_000, content: 'export const head = 1;\n', truncated: true },
    { path: 'binary.dat', size: 5_000_000 },
    { path: 'crlf.txt', size: 12, content: 'a\r\nb\r\n' },
  ]);

  it('не затирает файл, если фрагмент не найден', () => {
    const proposal = parseFileProposals(
      actions([{ action: 'replace', path: 'src/math.ts', targetContent: 'return a * b;', replacementContent: 'return 0;' }]),
      'm1',
      ws,
    );
    expect(proposal?.changes).toHaveLength(0);
    expect(proposal?.rejected?.[0]).toMatchObject({ path: 'src/math.ts', action: 'replace' });
  });

  it('применяет часть правок и объясняет отказ по остальным', () => {
    const proposal = parseFileProposals(
      actions([
        { action: 'replace', path: 'src/math.ts', targetContent: 'a + b', replacementContent: 'a - b' },
        { action: 'write', path: '../outside.txt', content: 'x' },
        { action: 'write', path: '.env', content: 'KEY=1' },
        { action: 'write', path: 'src/new.ts', content: 'export {};' },
      ]),
      'm2',
      ws,
    );
    expect(proposal?.changes.map((c) => c.path)).toEqual(['src/math.ts', 'src/new.ts']);
    expect(proposal?.rejected?.map((r) => r.path)).toEqual(['../outside.txt', '.env']);
    expect(proposal?.changes[0].modifiedContent).toContain('a - b');
  });

  it('объединяет несколько правок одного файла последовательно', () => {
    const proposal = parseFileProposals(
      actions([
        { action: 'replace', path: 'src/math.ts', targetContent: 'add', replacementContent: 'plus', description: 'rename' },
        { action: 'replace', path: 'src/math.ts', targetContent: 'a + b', replacementContent: 'a + b + 0' },
      ]),
      'm3',
      ws,
    );
    expect(proposal?.changes).toHaveLength(1);
    const change = proposal!.changes[0];
    expect(change.action).toBe('replace');
    expect(change.edits).toHaveLength(2);
    expect(change.modifiedContent).toBe(
      'export function plus(a: number, b: number) {\n  return a + b + 0;\n}\n',
    );
    expect(change.description).toBe('rename');
  });

  it('не правит точечно обрезанный или незагруженный файл', () => {
    const proposal = parseFileProposals(
      actions([
        { action: 'replace', path: 'big.ts', targetContent: 'head', replacementContent: 'top' },
        { action: 'replace', path: 'binary.dat', targetContent: 'x', replacementContent: 'y' },
      ]),
      'm4',
      ws,
    );
    expect(proposal?.changes).toHaveLength(0);
    expect(proposal?.rejected).toHaveLength(2);
    expect(proposal?.rejected?.[0].reason).toContain('не полностью');
    expect(proposal?.rejected?.[1].reason).toContain('не загружено');
  });

  it('отклоняет write без content и replace без проекта', () => {
    const noContent = parseFileProposals(actions([{ action: 'write', path: 'a.ts' }]), 'm5', ws);
    expect(noContent?.changes).toHaveLength(0);
    expect(noContent?.rejected?.[0].reason).toContain('content');

    const noWorkspace = parseFileProposals(
      actions([{ action: 'replace', path: 'a.ts', targetContent: 'a', replacementContent: 'b' }]),
      'm6',
      null,
    );
    expect(noWorkspace?.changes).toHaveLength(0);
  });

  it('write для CRLF-файла сохраняет переводы строк', () => {
    const proposal = parseFileProposals(
      actions([{ action: 'write', path: 'crlf.txt', content: 'a\nc\n' }]),
      'm7',
      ws,
    );
    expect(proposal?.changes[0].modifiedContent).toBe('a\r\nc\r\n');
  });

  it('удаление несуществующего файла отклоняется, создание+удаление — ничего не меняет', () => {
    const missing = parseFileProposals(actions([{ action: 'delete', path: 'nope.ts' }]), 'm8', ws);
    expect(missing?.changes).toHaveLength(0);
    expect(missing?.rejected?.[0].reason).toContain('не найден');

    const noop = parseFileProposals(
      actions([
        { action: 'write', path: 'tmp.ts', content: 'x' },
        { action: 'delete', path: 'tmp.ts' },
      ]),
      'm9',
      ws,
    );
    expect(noop).toBeNull();

    const real = parseFileProposals(actions([{ action: 'delete', path: 'src/math.ts' }]), 'm10', ws);
    expect(real?.changes[0]).toMatchObject({ action: 'delete', path: 'src/math.ts', deletions: 4 });
  });

  it('убирает имя корневой папки из пути модели (папка проекта не вкладывается сама в себя)', () => {
    const proposal = parseFileProposals(
      actions([{ action: 'write', path: 'proj/src/new.ts', content: 'x' }]),
      'm11',
      ws,
    );
    expect(proposal?.changes[0].path).toBe('src/new.ts');
  });

  it('повторный показ уже применённой правки не превращается в перезапись', () => {
    const applied = workspace([{ path: 'src/math.ts', size: 10, content: MATH.replace('a + b', 'a - b') }]);
    const proposal = parseFileProposals(
      actions([{ action: 'replace', path: 'src/math.ts', targetContent: 'a + b', replacementContent: 'a - b' }]),
      'm12',
      applied,
    );
    expect(proposal?.changes).toHaveLength(0);
    expect(proposal?.rejected?.[0].reason).toContain('уже применено');
  });

  it('тройные кавычки внутри содержимого файла не обрывают блок file-actions', () => {
    const readme = '# Title\n\n```bash\nnpm install\n```\n';
    const proposal = parseFileProposals(actions([{ action: 'write', path: 'README.md', content: readme }]), 'm13', ws);
    expect(proposal?.changes[0].modifiedContent).toBe(readme);
  });

  it('Aider SEARCH/REPLACE: путь в первой строке блока поиска', () => {
    const text = '<<<<<<< SEARCH\n// path: src/math.ts\nreturn a + b;\n=======\nreturn b + a;\n>>>>>>>';
    const proposal = parseFileProposals(text, 'm14', ws);
    expect(proposal?.changes[0].path).toBe('src/math.ts');
    expect(proposal?.changes[0].modifiedContent).toContain('return b + a;');
  });

  it('невалидный JSON и ответы без правок дают null', () => {
    expect(parseFileProposals('```file-actions\n{oops\n```', 'm15', ws)).toBeNull();
    expect(parseFileProposals('просто текст', 'm16', ws)).toBeNull();
  });
});

describe('patch-parser: stripFileActionBlocks', () => {
  it('скрывает законченные и ещё не закрытые блоки (стриминг)', () => {
    const done = 'Текст до\n```file-actions\n[]\n```\nТекст после';
    expect(stripFileActionBlocks(done)).toBe('Текст до\n\nТекст после');
    const streaming = 'Пояснение\n```file-actions\n[{"action":"wri';
    expect(stripFileActionBlocks(streaming)).toBe('Пояснение');
  });
});
