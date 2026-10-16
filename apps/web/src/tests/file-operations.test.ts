import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  generateLineDiff,
  parseFileProposals,
  stripFileActionBlocks,
  applyLocalChanges,
  commitDirectlyToGitHub,
  createGitHubPullRequest,
} from '../features/chat/file-operations';
import type { LocalDirectoryHandle } from '../features/chat/file-operations';
import type { WorkspaceContext } from '../features/chat/types';
import { useWorkspace } from '../features/chat/workspace-store';

describe('File Operations Subsystem', () => {
  beforeEach(() => {
    useWorkspace.setState({
      activeWorkspace: null,
      selectedFile: null,
      isLinking: false,
      linkError: null,
    });
    vi.restoreAllMocks();
  });

  describe('diff-generator: generateLineDiff', () => {
    it('корректно находит добавленные и удалённые строки', () => {
      const oldCode = 'function hello() {\n  console.log("old");\n}';
      const newCode = 'function hello() {\n  console.log("new");\n  return true;\n}';

      const diff = generateLineDiff(oldCode, newCode, 'src/hello.ts');

      expect(diff.path).toBe('src/hello.ts');
      expect(diff.deletions).toBe(1);
      expect(diff.additions).toBe(2);

      const addLines = diff.lines.filter((l) => l.type === 'add');
      expect(addLines.some((l) => l.text.includes('"new"'))).toBe(true);
      expect(addLines.some((l) => l.text.includes('return true;'))).toBe(true);

      const delLines = diff.lines.filter((l) => l.type === 'delete');
      expect(delLines.some((l) => l.text.includes('"old"'))).toBe(true);
    });

    it('корректно обрабатывает создание нового файла с нуля', () => {
      const diff = generateLineDiff('', 'const x = 1;\nconst y = 2;', 'src/new.ts');
      expect(diff.deletions).toBe(0);
      expect(diff.additions).toBe(2);
      expect(diff.lines.every((l) => l.type === 'add')).toBe(true);
    });
  });

  describe('patch-parser: parseFileProposals & stripFileActionBlocks', () => {
    it('парсит JSON блок file-actions и строит предложение правок', () => {
      const sampleWorkspace: WorkspaceContext = {
        id: 'ws-1',
        type: 'local_folder',
        name: 'my-project',
        pathOrUrl: 'my-project',
        filesCount: 1,
        files: [
          {
            path: 'src/utils/math.ts',
            size: 50,
            content: 'export function add(a: number, b: number) {\n  return a + b;\n}',
          },
        ],
        indexedAt: new Date().toISOString(),
      };

      const aiResponse = `
Я обновил функцию сложения и добавил вычитание.

\`\`\`file-actions
[
  {
    "action": "replace",
    "path": "src/utils/math.ts",
    "description": "Добавлена функция subtract",
    "targetContent": "return a + b;\\n}",
    "replacementContent": "return a + b;\\n}\\n\\nexport function subtract(a: number, b: number) {\\n  return a - b;\\n}"
  },
  {
    "action": "write",
    "path": "src/utils/config.ts",
    "description": "Новый конфиг",
    "content": "export const VERSION = '1.0.0';"
  }
]
\`\`\`

Проверьте изменения перед применением.
`;

      const proposal = parseFileProposals(aiResponse, 'msg-1', sampleWorkspace);
      expect(proposal).not.toBeNull();
      expect(proposal?.changes).toHaveLength(2);

      const mathChange = proposal?.changes.find((c) => c.path === 'src/utils/math.ts');
      expect(mathChange).toBeDefined();
      expect(mathChange?.action).toBe('replace');
      expect(mathChange?.modifiedContent).toContain('export function subtract');
      expect(mathChange?.additions).toBeGreaterThan(0);

      const configChange = proposal?.changes.find((c) => c.path === 'src/utils/config.ts');
      expect(configChange).toBeDefined();
      expect(configChange?.action).toBe('write');
      expect(configChange?.modifiedContent).toBe("export const VERSION = '1.0.0';");

      // Очистка от технического блока
      const stripped = stripFileActionBlocks(aiResponse);
      expect(stripped).not.toContain('```file-actions');
      expect(stripped).toContain('Я обновил функцию сложения');
      expect(stripped).toContain('Проверьте изменения перед применением.');
    });

    it('парсит Aider SEARCH/REPLACE синтаксис', () => {
      const sampleWorkspace: WorkspaceContext = {
        id: 'ws-2',
        type: 'git_repo',
        name: 'owner/repo',
        pathOrUrl: 'https://github.com/owner/repo',
        filesCount: 1,
        files: [{ path: 'app.js', size: 20, content: 'const mode = "dev";' }],
        indexedAt: new Date().toISOString(),
      };

      const aiResponse = `
Вот исправление:
<<<<<<< SEARCH: app.js
const mode = "dev";
=======
const mode = "production";
>>>>>>>
`;

      const proposal = parseFileProposals(aiResponse, 'msg-2', sampleWorkspace);
      expect(proposal).not.toBeNull();
      expect(proposal?.changes).toHaveLength(1);
      expect(proposal?.changes[0].path).toBe('app.js');
      expect(proposal?.changes[0].modifiedContent).toBe('const mode = "production";');
    });
  });

  describe('local-writer: applyLocalChanges', () => {
    it('записывает файлы в локальную папку через FileSystemDirectoryHandle', async () => {
      const mockWorkspace: WorkspaceContext = {
        id: 'folder-123',
        type: 'local_folder',
        name: 'demo-local',
        pathOrUrl: 'demo-local',
        filesCount: 1,
        files: [{ path: 'test.txt', size: 5, content: 'hello' }],
        indexedAt: new Date().toISOString(),
      };

      useWorkspace.setState({ activeWorkspace: mockWorkspace });

      const writtenData: Record<string, string> = {};

      const mockFileHandle = {
        createWritable: vi.fn(async () => {
          return {
            write: async (data: string) => {
              writtenData['src/new.ts'] = data;
            },
            close: async () => {},
          };
        }),
      };

      const mockSubDirHandle = {
        getFileHandle: vi.fn(async () => mockFileHandle),
      };

      // Заглушка реализует только то, что нужно для записи одного файла.
      const mockRootHandle = {
        queryPermission: vi.fn(async () => 'granted' as const),
        requestPermission: vi.fn(async () => 'granted' as const),
        getDirectoryHandle: vi.fn(async () => mockSubDirHandle),
        getFileHandle: vi.fn(async () => mockFileHandle),
      } as unknown as LocalDirectoryHandle;

      const result = await applyLocalChanges(
        mockWorkspace,
        [
          {
            action: 'write',
            path: 'src/new.ts',
            modifiedContent: 'export const X = 42;',
          },
        ],
        mockRootHandle,
      );

      expect(result.success).toBe(true);
      expect(result.appliedCount).toBe(1);
      expect(writtenData['src/new.ts']).toBe('export const X = 42;');

      // Проверяем, что состояние стора обновилось
      const updatedWs = useWorkspace.getState().activeWorkspace;
      expect(updatedWs?.files.find((f) => f.path === 'src/new.ts')?.content).toBe('export const X = 42;');
    });
  });

  describe('local-writer: безопасность записи', () => {
    function makeRoot(initial: Record<string, string>) {
      const disk: Record<string, string> = { ...initial };
      // Явный тип результата: фабрика рекурсивна (каталог возвращает вложенные каталоги), иначе TS7023.
      const dirFor = (prefix: string): LocalDirectoryHandle => ({
        getDirectoryHandle: vi.fn(async (name: string) => dirFor(prefix ? `${prefix}/${name}` : name)),
        getFileHandle: vi.fn(async (name: string, opts?: { create?: boolean }) => {
          const path = prefix ? `${prefix}/${name}` : name;
          if (!(path in disk) && !opts?.create) throw new Error('NotFoundError');
          return {
            getFile: async () => ({ text: async () => disk[path] }),
            createWritable: async () => ({
              write: async (data: string) => {
                disk[path] = data;
              },
              close: async () => {},
            }),
          };
        }),
        removeEntry: vi.fn(async (name: string) => {
          delete disk[prefix ? `${prefix}/${name}` : name];
        }),
      });
      const root: LocalDirectoryHandle = {
        queryPermission: vi.fn(async () => 'granted' as const),
        requestPermission: vi.fn(async () => 'granted' as const),
        ...dirFor(''),
      };
      return { root, disk };
    }

    const workspace: WorkspaceContext = {
      id: 'folder-safe',
      type: 'local_folder',
      name: 'demo',
      pathOrUrl: 'demo',
      filesCount: 1,
      files: [{ path: 'src/a.ts', size: 10, content: 'const a = 1;\n' }],
      indexedAt: new Date().toISOString(),
    };

    it('точечная правка применяется к актуальному содержимому диска, а не к снимку в памяти', async () => {
      // Пока пользователь смотрел на карточку, он дописал строку в файл.
      const { root, disk } = makeRoot({ 'src/a.ts': 'const a = 1;\nconst mine = true;\n' });
      const res = await applyLocalChanges(
        workspace,
        [
          {
            action: 'replace',
            path: 'src/a.ts',
            edits: [{ targetContent: 'const a = 1;', replacementContent: 'const a = 2;' }],
            modifiedContent: 'const a = 2;\n',
          },
        ],
        root,
      );
      expect(res.success).toBe(true);
      expect(disk['src/a.ts']).toBe('const a = 2;\nconst mine = true;\n');
    });

    it('если фрагмент на диске не найден — файл не меняется, а ошибка показывается', async () => {
      const { root, disk } = makeRoot({ 'src/a.ts': 'совсем другой файл\n' });
      const res = await applyLocalChanges(
        workspace,
        [
          {
            action: 'replace',
            path: 'src/a.ts',
            edits: [{ targetContent: 'const a = 1;', replacementContent: 'const a = 2;' }],
            modifiedContent: 'const a = 2;\n',
          },
        ],
        root,
      );
      expect(res.success).toBe(false);
      expect(res.errors[0]).toContain('Файл не изменён');
      expect(disk['src/a.ts']).toBe('совсем другой файл\n');
    });

    it('отказывается писать за пределы папки проекта', async () => {
      const { root, disk } = makeRoot({});
      const res = await applyLocalChanges(
        workspace,
        [
          { action: 'write', path: '../evil.txt', modifiedContent: 'x' },
          { action: 'write', path: '.git/config', modifiedContent: 'x' },
          { action: 'delete', path: '../victim.txt' },
        ],
        root,
      );
      expect(res.success).toBe(false);
      expect(res.appliedCount).toBe(0);
      expect(res.errors).toHaveLength(3);
      expect(Object.keys(disk)).toHaveLength(0);
    });
  });

  describe('git-writer: commitDirectlyToGitHub & createGitHubPullRequest', () => {
    it('создает коммит на GitHub через Git Data API', async () => {
      const mockWorkspace: WorkspaceContext = {
        id: 'github-owner-repo',
        type: 'git_repo',
        name: 'testowner/testrepo',
        pathOrUrl: 'https://github.com/testowner/testrepo',
        branch: 'main',
        filesCount: 1,
        files: [{ path: 'README.md', size: 10, content: '# Old' }],
        indexedAt: new Date().toISOString(),
      };

      useWorkspace.setState({ activeWorkspace: mockWorkspace });

      global.fetch = vi.fn(async (url: RequestInfo | URL, opts?: RequestInit) => {
        const u = url.toString();
        if (u.includes('/git/ref/heads/main')) {
          return Response.json({ object: { sha: 'base-commit-sha-123' } });
        }
        if (u.includes('/git/commits/base-commit-sha-123')) {
          return Response.json({ tree: { sha: 'base-tree-sha-456' } });
        }
        if (u.includes('/git/blobs')) {
          return Response.json({ sha: 'new-blob-sha-789' });
        }
        if (u.includes('/git/trees')) {
          return Response.json({ sha: 'new-tree-sha-012' });
        }
        if (u.includes('/git/commits')) {
          return Response.json({ sha: 'final-commit-sha-345' });
        }
        if (u.includes('/git/refs/heads/main') && opts?.method === 'PATCH') {
          return Response.json({ object: { sha: 'final-commit-sha-345' } });
        }
        return new Response(null, { status: 404 });
      });

      const res = await commitDirectlyToGitHub({
        owner: 'testowner',
        repo: 'testrepo',
        branch: 'main',
        changes: [
          {
            action: 'write',
            path: 'README.md',
            modifiedContent: '# Updated by AI',
          },
        ],
      });

      expect(res.commitSha).toBe('final-commit-sha-345');
      // Всё идёт через прокси сервера: токена в браузере нет, адрес GitHub напрямую не вызывается.
      const calls = vi.mocked(global.fetch).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      for (const [url, init] of calls) {
        expect(String(url)).toMatch(/^\/api\/github\/api\/repos\/testowner\/testrepo\//);
        expect(JSON.stringify((init as RequestInit | undefined)?.headers ?? {})).not.toMatch(/token /i);
      }
      expect(res.url).toContain('https://github.com/testowner/testrepo/commit/final-commit-sha-345');

      // Проверяем обновление стора
      const updatedWs = useWorkspace.getState().activeWorkspace;
      expect(updatedWs?.files.find((f) => f.path === 'README.md')?.content).toBe('# Updated by AI');
    });

    it('точечная правка применяется к свежему файлу из репозитория, а не к снимку при привязке', async () => {
      const mockWorkspace: WorkspaceContext = {
        id: 'github-owner-fresh',
        type: 'git_repo',
        name: 'testowner/testrepo',
        pathOrUrl: 'https://github.com/testowner/testrepo',
        branch: 'main',
        filesCount: 1,
        files: [{ path: 'src/a.ts', size: 10, content: 'const a = 1;\n' }],
        indexedAt: new Date().toISOString(),
      };
      useWorkspace.setState({ activeWorkspace: mockWorkspace });

      let committedBlob = '';
      global.fetch = vi.fn(async (url: RequestInfo | URL, opts?: RequestInit) => {
        const u = url.toString();
        if (u.includes('/git/ref/heads/main')) {
          return Response.json({ object: { sha: 'base-sha' } });
        }
        if (u.includes('/git/commits/base-sha')) {
          return Response.json({ tree: { sha: 'base-tree' } });
        }
        if (u.includes('/contents/src/a.ts?ref=base-sha')) {
          // В репозитории файл уже изменился другим человеком.
          return new Response('const a = 1;\nconst teammate = 42;\n');
        }
        if (u.includes('/git/blobs')) {
          committedBlob = JSON.parse(String(opts?.body)).content;
          return Response.json({ sha: 'blob' });
        }
        if (u.includes('/git/trees')) return Response.json({ sha: 'tree' });
        if (u.includes('/git/commits')) return Response.json({ sha: 'commit' });
        if (u.includes('/git/refs/heads/main')) return Response.json({});
        return new Response(null, { status: 404 });
      });

      await commitDirectlyToGitHub({
        owner: 'testowner',
        repo: 'testrepo',
        branch: 'main',
        changes: [
          {
            action: 'replace',
            path: 'src/a.ts',
            edits: [{ targetContent: 'const a = 1;', replacementContent: 'const a = 2;' }],
            modifiedContent: 'const a = 2;\n',
          },
        ],
      });

      expect(committedBlob).toBe('const a = 2;\nconst teammate = 42;\n');
      const synced = useWorkspace.getState().activeWorkspace;
      expect(synced?.files.find((f) => f.path === 'src/a.ts')?.content).toBe(committedBlob);
    });

    it('не коммитит, если фрагмент в репозитории не найден', async () => {
      useWorkspace.setState({
        activeWorkspace: {
          id: 'github-owner-miss',
          type: 'git_repo',
          name: 'testowner/testrepo',
          pathOrUrl: 'https://github.com/testowner/testrepo',
          branch: 'main',
          filesCount: 0,
          files: [],
          indexedAt: new Date().toISOString(),
        },
      });
      let blobCalls = 0;
      global.fetch = vi.fn(async (url: RequestInfo | URL) => {
        const u = url.toString();
        if (u.includes('/git/ref/heads/main')) return Response.json({ object: { sha: 'base-sha' } });
        if (u.includes('/git/commits/base-sha')) return Response.json({ tree: { sha: 'base-tree' } });
        if (u.includes('/contents/')) return new Response('совсем другое содержимое');
        if (u.includes('/git/blobs')) {
          blobCalls++;
          return Response.json({ sha: 'blob' });
        }
        return new Response(null, { status: 404 });
      });

      await expect(
        commitDirectlyToGitHub({
          owner: 'testowner',
          repo: 'testrepo',
          branch: 'main',
            changes: [
            {
              action: 'replace',
              path: 'src/a.ts',
              edits: [{ targetContent: 'const a = 1;', replacementContent: 'const a = 2;' }],
            },
          ],
        }),
      ).rejects.toThrow();
      expect(blobCalls).toBe(0);
    });

    it('создает Pull Request на GitHub', async () => {
      const mockWorkspace: WorkspaceContext = {
        id: 'github-owner-repo',
        type: 'git_repo',
        name: 'testowner/testrepo',
        pathOrUrl: 'https://github.com/testowner/testrepo',
        branch: 'main',
        filesCount: 1,
        files: [{ path: 'index.ts', size: 10, content: 'export {};' }],
        indexedAt: new Date().toISOString(),
      };

      useWorkspace.setState({ activeWorkspace: mockWorkspace });

      global.fetch = vi.fn(async (url: RequestInfo | URL) => {
        const u = url.toString();
        if (u.includes('/git/ref/heads/main')) {
          return Response.json({ object: { sha: 'base-commit-sha-123' } });
        }
        if (u.includes('/git/commits/base-commit-sha-123')) {
          return Response.json({ tree: { sha: 'base-tree-sha-456' } });
        }
        if (u.includes('/git/blobs')) {
          return Response.json({ sha: 'blob-sha' });
        }
        if (u.includes('/git/trees')) {
          return Response.json({ sha: 'tree-sha' });
        }
        if (u.includes('/git/commits')) {
          return Response.json({ sha: 'commit-sha' });
        }
        if (u.includes('/git/refs')) {
          return Response.json({ ref: 'refs/heads/ai-patch-branch' });
        }
        if (u.includes('/pulls')) {
          return Response.json({
            number: 42,
            html_url: 'https://github.com/testowner/testrepo/pull/42',
          });
        }
        return new Response(null, { status: 404 });
      });

      const res = await createGitHubPullRequest({
        owner: 'testowner',
        repo: 'testrepo',
        branch: 'main',
        title: 'New AI feature',
        changes: [
          {
            action: 'write',
            path: 'index.ts',
            modifiedContent: 'export const ok = true;',
          },
        ],
      });

      expect(res.prNumber).toBe(42);
      expect(res.url).toBe('https://github.com/testowner/testrepo/pull/42');
    });
  });
});
