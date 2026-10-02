import type { WorkspaceContext, WorkspaceFile } from './types';
import { getFileExtension } from './attachment-utils';

const IGNORED_NAMES = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', 'out', 'target',
  '.turbo', '.cache', 'coverage', '.gemini', 'venv', '__pycache__',
  '.idea', '.vscode', '.DS_Store', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
]);

const CODE_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'json', 'py', 'rs', 'go', 'html', 'css', 'scss',
  'c', 'cpp', 'h', 'hpp', 'cs', 'java', 'kt', 'swift', 'php', 'rb', 'sql',
  'sh', 'bash', 'yaml', 'yml', 'toml', 'env', 'xml', 'md', 'graphql', 'txt',
]);

const MAX_TOTAL_FILES = 120;
const MAX_FILE_SIZE_BYTES = 256 * 1024; // 256 KB per text file to avoid overloading

function isCodeFile(filename: string): boolean {
  const ext = getFileExtension(filename);
  return CODE_EXTENSIONS.has(ext);
}

/**
 * Читает файлы из стандартного input `webkitdirectory`.
 */
export async function readFolderFromFiles(fileList: FileList | File[]): Promise<WorkspaceContext> {
  const files: File[] = Array.from(fileList);
  if (files.length === 0) {
    throw new Error('Папка пуста или не содержит доступных файлов');
  }

  // Извлекаем имя корневой папки из первого относительного пути
  const firstPath = files[0].webkitRelativePath || files[0].name;
  const folderName = firstPath.split('/')[0] || 'Локальный проект';

  const collected: WorkspaceFile[] = [];

  for (const file of files) {
    if (collected.length >= MAX_TOTAL_FILES) break;

    const relPath = file.webkitRelativePath || file.name;
    const parts = relPath.split('/');

    // Проверяем игнорируемые директории
    if (parts.some((p) => IGNORED_NAMES.has(p))) {
      continue;
    }

    const isText = isCodeFile(file.name);
    let content: string | undefined = undefined;

    if (isText && file.size <= MAX_FILE_SIZE_BYTES) {
      try {
        content = await file.text();
      } catch {
        // Игнорируем ошибки чтения
      }
    }

    collected.push({
      path: relPath,
      size: file.size,
      content,
      language: getFileExtension(file.name),
    });
  }

  return {
    id: `folder-${Date.now()}`,
    type: 'local_folder',
    name: folderName,
    pathOrUrl: folderName,
    filesCount: collected.length,
    files: collected,
    indexedAt: new Date().toISOString(),
  };
}

/**
 * Читает папку через File System Access API (window.showDirectoryPicker) в Chrome/Edge/Opera.
 */
export async function pickFolderNative(): Promise<WorkspaceContext> {
  if (typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker !== 'function') {
    throw new Error('showDirectoryPicker_not_supported');
  }

  // @ts-expect-error File System Access API
  const rootHandle = await window.showDirectoryPicker({ mode: 'read' });
  const folderName = rootHandle.name || 'Локальный проект';
  const collected: WorkspaceFile[] = [];

  async function scanDirectory(dirHandle: any, currentPath: string) {
    if (collected.length >= MAX_TOTAL_FILES) return;

    for await (const entry of dirHandle.values()) {
      if (collected.length >= MAX_TOTAL_FILES) break;
      if (IGNORED_NAMES.has(entry.name) || entry.name.startsWith('.')) continue;

      const fullPath = currentPath ? `${currentPath}/${entry.name}` : entry.name;

      if (entry.kind === 'file') {
        try {
          const file = await entry.getFile();
          const isText = isCodeFile(file.name);
          let content: string | undefined = undefined;

          if (isText && file.size <= MAX_FILE_SIZE_BYTES) {
            content = await file.text();
          }

          collected.push({
            path: fullPath,
            size: file.size,
            content,
            language: getFileExtension(file.name),
          });
        } catch {
          // Игнорируем недоступные файлы
        }
      } else if (entry.kind === 'directory') {
        await scanDirectory(entry, fullPath);
      }
    }
  }

  await scanDirectory(rootHandle, folderName);

  return {
    id: `folder-${Date.now()}`,
    type: 'local_folder',
    name: folderName,
    pathOrUrl: folderName,
    filesCount: collected.length,
    files: collected,
    indexedAt: new Date().toISOString(),
  };
}
