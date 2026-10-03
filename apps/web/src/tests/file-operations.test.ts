import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  generateLineDiff,
  parseFileProposals,
  stripFileActionBlocks,
  applyLocalChanges,
  commitDirectlyToGitHub,
  createGitHubPullRequest,
} from '../features/chat/file-operations';
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

      const mockWritable = {
        write: vi.fn(async (data: string) => {
          // capture write
        }),
        close: vi.fn(async () => {}),
      };

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

      const mockRootHandle = {
        queryPermission: vi.fn(async () => 'granted'),
        requestPermission: vi.fn(async () => 'granted'),
        getDirectoryHandle: vi.fn(async () => mockSubDirHandle),
        getFileHandle: vi.fn(async () => mockFileHandle),
      };

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

      global.fetch = vi.fn(async (url: any, opts?: any) => {
        const u = url.toString();
        if (u.includes('/git/ref/heads/main')) {
          return { ok: true, json: async () => ({ object: { sha: 'base-commit-sha-123' } }) } as any;
        }
        if (u.includes('/git/commits/base-commit-sha-123')) {
          return { ok: true, json: async () => ({ tree: { sha: 'base-tree-sha-456' } }) } as any;
        }
        if (u.includes('/git/blobs')) {
          return { ok: true, json: async () => ({ sha: 'new-blob-sha-789' }) } as any;
        }
        if (u.includes('/git/trees')) {
          return { ok: true, json: async () => ({ sha: 'new-tree-sha-012' }) } as any;
        }
        if (u.includes('/git/commits')) {
          return { ok: true, json: async () => ({ sha: 'final-commit-sha-345' }) } as any;
        }
        if (u.includes('/git/refs/heads/main') && opts?.method === 'PATCH') {
          return { ok: true, json: async () => ({ object: { sha: 'final-commit-sha-345' } }) } as any;
        }
        return { ok: false, status: 404 } as any;
      });

      const res = await commitDirectlyToGitHub({
        owner: 'testowner',
        repo: 'testrepo',
        branch: 'main',
        token: 'ghp_fake_token',
        changes: [
          {
            action: 'write',
            path: 'README.md',
            modifiedContent: '# Updated by AI',
          },
        ],
      });

      expect(res.commitSha).toBe('final-commit-sha-345');
      expect(res.url).toContain('https://github.com/testowner/testrepo/commit/final-commit-sha-345');

      // Проверяем обновление стора
      const updatedWs = useWorkspace.getState().activeWorkspace;
      expect(updatedWs?.files.find((f) => f.path === 'README.md')?.content).toBe('# Updated by AI');
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

      global.fetch = vi.fn(async (url: any) => {
        const u = url.toString();
        if (u.includes('/git/ref/heads/main')) {
          return { ok: true, json: async () => ({ object: { sha: 'base-commit-sha-123' } }) } as any;
        }
        if (u.includes('/git/commits/base-commit-sha-123')) {
          return { ok: true, json: async () => ({ tree: { sha: 'base-tree-sha-456' } }) } as any;
        }
        if (u.includes('/git/blobs')) {
          return { ok: true, json: async () => ({ sha: 'blob-sha' }) } as any;
        }
        if (u.includes('/git/trees')) {
          return { ok: true, json: async () => ({ sha: 'tree-sha' }) } as any;
        }
        if (u.includes('/git/commits')) {
          return { ok: true, json: async () => ({ sha: 'commit-sha' }) } as any;
        }
        if (u.includes('/git/refs')) {
          return { ok: true, json: async () => ({ ref: 'refs/heads/ai-patch-branch' }) } as any;
        }
        if (u.includes('/pulls')) {
          return {
            ok: true,
            json: async () => ({
              number: 42,
              html_url: 'https://github.com/testowner/testrepo/pull/42',
            }),
          } as any;
        }
        return { ok: false, status: 404 } as any;
      });

      const res = await createGitHubPullRequest({
        owner: 'testowner',
        repo: 'testrepo',
        branch: 'main',
        token: 'ghp_fake_token',
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
