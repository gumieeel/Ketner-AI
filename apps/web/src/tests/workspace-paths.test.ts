import { beforeEach, describe, expect, it } from 'vitest';
import type { WorkspaceContext } from '../features/chat/types';
import { normalizeWorkspacePaths, useWorkspace } from '../features/chat/workspace-store';

function folder(files: Array<{ path: string; content?: string }>): WorkspaceContext {
  return {
    id: 'f1',
    type: 'local_folder',
    name: 'my-app',
    pathOrUrl: 'my-app',
    filesCount: files.length,
    files: files.map((f) => ({ path: f.path, size: f.content?.length ?? 0, content: f.content })),
    indexedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('workspace-store: пути и обрезанные файлы', () => {
  beforeEach(() => {
    localStorage.removeItem('ketner.workspace');
    useWorkspace.setState({ activeWorkspace: null, selectedFile: null });
  });

  it('старые проекты с именем корня в путях приводятся к путям относительно корня', () => {
    const legacy = folder([{ path: 'my-app/src/a.ts' }, { path: 'my-app/package.json' }]);
    expect(normalizeWorkspacePaths(legacy).files.map((f) => f.path)).toEqual([
      'src/a.ts',
      'package.json',
    ]);

    const mixed = folder([{ path: 'my-app/src/a.ts' }, { path: 'other/b.ts' }]);
    expect(normalizeWorkspacePaths(mixed)).toBe(mixed);

    const git: WorkspaceContext = { ...legacy, type: 'git_repo' };
    expect(normalizeWorkspacePaths(git)).toBe(git);
  });

  it('в localStorage длинные файлы сохраняются с пометкой truncated, в памяти — целиком', () => {
    const long = 'x'.repeat(9000);
    useWorkspace.getState().setWorkspace(
      folder([
        { path: 'big.ts', content: long },
        { path: 'small.ts', content: 'ok' },
      ]),
    );

    const stored = JSON.parse(localStorage.getItem('ketner.workspace') ?? '{}') as WorkspaceContext;
    const big = stored.files.find((f) => f.path === 'big.ts');
    expect(big?.content).toHaveLength(4000);
    expect(big?.truncated).toBe(true);
    expect(stored.files.find((f) => f.path === 'small.ts')?.truncated).toBeUndefined();

    expect(useWorkspace.getState().activeWorkspace?.files[0].content).toHaveLength(9000);
  });

  it('после записи файла в проект признак truncated снимается', () => {
    useWorkspace.setState({
      activeWorkspace: {
        ...folder([]),
        files: [{ path: 'big.ts', size: 9000, content: 'x'.repeat(4000), truncated: true }],
      },
    });
    useWorkspace.getState().updateWorkspaceFiles([{ path: 'big.ts', content: 'new full content' }]);
    const file = useWorkspace.getState().activeWorkspace?.files[0];
    expect(file?.content).toBe('new full content');
    expect(file?.truncated).toBeUndefined();
  });
});
