import type { FileChangeItem, WorkspaceContext } from '../types';
import { useWorkspace } from '../workspace-store';

// Реестр хэндлов папок в памяти сессии
const handleRegistry = new Map<string, any>();

export function registerDirectoryHandle(workspaceId: string, handle: any): void {
  handleRegistry.set(workspaceId, handle);
}

export function getDirectoryHandle(workspaceId: string): any | null {
  return handleRegistry.get(workspaceId) || null;
}

/**
 * Проверяет и при необходимости запрашивает права на чтение и запись.
 */
async function verifyPermission(fileHandle: any, readWrite: boolean): Promise<boolean> {
  const options = { mode: readWrite ? 'readwrite' : 'read' };
  if ((await fileHandle.queryPermission(options)) === 'granted') {
    return true;
  }
  if ((await fileHandle.requestPermission(options)) === 'granted') {
    return true;
  }
  return false;
}

/**
 * Записывает или перезаписывает локальный файл по относительному пути внутри папки проекта.
 */
export async function writeLocalFile(
  rootHandle: any,
  relativePath: string,
  content: string,
): Promise<void> {
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\//, '');
  const parts = normalized.split('/');
  const fileName = parts.pop();
  if (!fileName) throw new Error('Некорректный путь к файлу');

  let currentDir = rootHandle;
  for (const part of parts) {
    if (part === '.' || part === '') continue;
    currentDir = await currentDir.getDirectoryHandle(part, { create: true });
  }

  const fileHandle = await currentDir.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(content);
  await writable.close();
}

/**
 * Удаляет локальный файл по относительному пути.
 */
export async function deleteLocalFile(
  rootHandle: any,
  relativePath: string,
): Promise<void> {
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\//, '');
  const parts = normalized.split('/');
  const fileName = parts.pop();
  if (!fileName) throw new Error('Некорректный путь к файлу');

  let currentDir = rootHandle;
  for (const part of parts) {
    if (part === '.' || part === '') continue;
    currentDir = await currentDir.getDirectoryHandle(part, { create: false });
  }

  await currentDir.removeEntry(fileName);
}

/**
 * Применяет пакет изменений напрямую к локальной папке на диске пользователя через File System Access API.
 */
export async function applyLocalChanges(
  workspace: WorkspaceContext,
  changes: FileChangeItem[],
  customRootHandle?: any,
): Promise<{ success: boolean; appliedCount: number; errors: string[] }> {
  const rootHandle = customRootHandle || getDirectoryHandle(workspace.id);
  if (!rootHandle) {
    throw new Error(
      'Доступ к локальной папке закрыт или истекла сессия. Пожалуйста, выберите папку проекта повторно для подтверждения записи.',
    );
  }

  const hasAccess = await verifyPermission(rootHandle, true);
  if (!hasAccess) {
    throw new Error('Разрешение на запись в папку было отклонено пользователем.');
  }

  const errors: string[] = [];
  const updatedFiles: Array<{ path: string; content?: string }> = [];
  let appliedCount = 0;

  for (const change of changes) {
    try {
      if (change.action === 'delete') {
        await deleteLocalFile(rootHandle, change.path);
        useWorkspace.getState().removeWorkspaceFile(change.path);
        appliedCount++;
      } else {
        const contentToWrite = change.modifiedContent ?? change.content ?? '';
        await writeLocalFile(rootHandle, change.path, contentToWrite);
        updatedFiles.push({ path: change.path, content: contentToWrite });
        appliedCount++;
      }
    } catch (err: any) {
      errors.push(`Ошибка записи ${change.path}: ${err?.message || 'неизвестная ошибка'}`);
    }
  }

  if (updatedFiles.length > 0) {
    useWorkspace.getState().updateWorkspaceFiles(updatedFiles);
  }

  return {
    success: errors.length === 0,
    appliedCount,
    errors,
  };
}
