import type { CodeFileEntry } from './types';

export interface TreeNode {
  name: string;
  /** Полный путь: для файла путь файла, для каталога — путь каталога без завершающего «/». */
  path: string;
  kind: 'file' | 'dir';
  size?: number;
  children: TreeNode[];
}

/** Дерево из плоского списка путей: каталоги раньше файлов, внутри групп — по алфавиту. */
export function buildTree(files: readonly Pick<CodeFileEntry, 'path' | 'size'>[]): TreeNode[] {
  const root: TreeNode = { name: '', path: '', kind: 'dir', children: [] };
  const dirs = new Map<string, TreeNode>([['', root]]);

  for (const file of files) {
    const parts = file.path.split('/');
    let parent = root;
    for (let i = 0; i < parts.length - 1; i += 1) {
      const dirPath = parts.slice(0, i + 1).join('/');
      let dir = dirs.get(dirPath);
      if (!dir) {
        dir = { name: parts[i], path: dirPath, kind: 'dir', children: [] };
        dirs.set(dirPath, dir);
        parent.children.push(dir);
      }
      parent = dir;
    }
    parent.children.push({
      name: parts[parts.length - 1],
      path: file.path,
      kind: 'file',
      size: file.size,
      children: [],
    });
  }

  const sort = (nodes: TreeNode[]): void => {
    nodes.sort((a, b) =>
      a.kind === b.kind
        ? a.name.localeCompare(b.name, undefined, { numeric: true })
        : a.kind === 'dir'
          ? -1
          : 1,
    );
    for (const node of nodes) if (node.kind === 'dir') sort(node.children);
  };
  sort(root.children);
  return root.children;
}

/** Все каталоги, содержащие путь (для раскрытия дерева при открытии файла). */
export function parentDirectories(path: string): string[] {
  const parts = path.split('/');
  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/'));
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}
