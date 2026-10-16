import type { FileChangeItem, WorkspaceContext } from '../types';
import { useWorkspace } from '../workspace-store';
import { sanitizeChangePath } from './path-safety';
import { applyTextEdits } from './text-patch';

/** Права доступа к папке (File System Access API; в lib.dom TypeScript их пока нет). */
type PermissionMode = { mode: 'read' | 'readwrite' };

/** Файл внутри выбранной папки: то, что нужно для чтения и записи. */
export interface LocalFileHandle {
  getFile(): Promise<{ text(): Promise<string> }>;
  createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
}

/**
 * Папка, выбранная через File System Access API. Структурный тип: ему соответствует
 * FileSystemDirectoryHandle браузера, а в тестах — простые объекты-заглушки.
 */
export interface LocalDirectoryHandle {
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<LocalDirectoryHandle>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<LocalFileHandle>;
  removeEntry(name: string): Promise<void>;
  queryPermission?(options: PermissionMode): Promise<PermissionState>;
  requestPermission?(options: PermissionMode): Promise<PermissionState>;
}

// Реестр хэндлов папок в памяти сессии
const handleRegistry = new Map<string, LocalDirectoryHandle>();

export function registerDirectoryHandle(workspaceId: string, handle: LocalDirectoryHandle): void {
  handleRegistry.set(workspaceId, handle);
}

export function getDirectoryHandle(workspaceId: string): LocalDirectoryHandle | null {
  return handleRegistry.get(workspaceId) ?? null;
}

/**
 * Проверяет и при необходимости запрашивает права на чтение и запись.
 * Браузер без методов запроса прав выдаёт доступ уже при выборе папки.
 */
async function verifyPermission(
  handle: LocalDirectoryHandle,
  readWrite: boolean,
): Promise<boolean> {
  if (!handle.queryPermission || !handle.requestPermission) return true;
  const options: PermissionMode = { mode: readWrite ? 'readwrite' : 'read' };
  if ((await handle.queryPermission(options)) === 'granted') {
    return true;
  }
  return (await handle.requestPermission(options)) === 'granted';
}

/** Путь внутри папки проекта; выход за её пределы (`..`) и служебные папки отклоняются. */
function safeRelativeParts(relativePath: string): string[] {
  const checked = sanitizeChangePath(relativePath);
  if (!checked.ok) throw new Error(`Некорректный путь к файлу: ${checked.reason}`);
  return checked.path.split('/');
}

async function resolveDirectory(
  rootHandle: LocalDirectoryHandle,
  parts: string[],
  create: boolean,
): Promise<LocalDirectoryHandle> {
  let currentDir = rootHandle;
  for (const part of parts) {
    currentDir = await currentDir.getDirectoryHandle(part, { create });
  }
  return currentDir;
}

/**
 * Читает текущее содержимое локального файла прямо с диска.
 */
export async function readLocalFile(
  rootHandle: LocalDirectoryHandle,
  relativePath: string,
): Promise<string> {
  const parts = safeRelativeParts(relativePath);
  const fileName = parts.pop();
  if (!fileName) throw new Error('Некорректный путь к файлу');
  const dir = await resolveDirectory(rootHandle, parts, false);
  const fileHandle = await dir.getFileHandle(fileName, { create: false });
  const file = await fileHandle.getFile();
  return await file.text();
}

/**
 * Записывает или перезаписывает локальный файл по относительному пути внутри папки проекта.
 */
export async function writeLocalFile(
  rootHandle: LocalDirectoryHandle,
  relativePath: string,
  content: string,
): Promise<void> {
  const parts = safeRelativeParts(relativePath);
  const fileName = parts.pop();
  if (!fileName) throw new Error('Некорректный путь к файлу');

  const currentDir = await resolveDirectory(rootHandle, parts, true);

  const fileHandle = await currentDir.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(content);
  await writable.close();
}

/**
 * Удаляет локальный файл по относительному пути.
 */
export async function deleteLocalFile(
  rootHandle: LocalDirectoryHandle,
  relativePath: string,
): Promise<void> {
  const parts = safeRelativeParts(relativePath);
  const fileName = parts.pop();
  if (!fileName) throw new Error('Некорректный путь к файлу');

  const currentDir = await resolveDirectory(rootHandle, parts, false);
  await currentDir.removeEntry(fileName);
}

/**
 * Применяет пакет изменений напрямую к локальной папке на диске пользователя через File System Access API.
 */
export async function applyLocalChanges(
  workspace: WorkspaceContext,
  changes: FileChangeItem[],
  customRootHandle?: LocalDirectoryHandle,
): Promise<{ success: boolean; appliedCount: number; errors: string[] }> {
  const rootHandle = customRootHandle ?? getDirectoryHandle(workspace.id);
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
        let contentToWrite = change.modifiedContent ?? change.content ?? '';
        if (change.action === 'replace' && change.edits && change.edits.length > 0) {
          // Точечные правки применяются к тому, что лежит на диске сейчас, а не к снимку из памяти:
          // файл мог измениться, а снимок — оказаться устаревшим или обрезанным.
          const fresh = await readLocalFile(rootHandle, change.path);
          const result = applyTextEdits(fresh, change.edits);
          if (!result.ok) {
            errors.push(`${change.path}: ${result.reason}. Файл не изменён.`);
            continue;
          }
          contentToWrite = result.text;
        }
        await writeLocalFile(rootHandle, change.path, contentToWrite);
        updatedFiles.push({ path: change.path, content: contentToWrite });
        appliedCount++;
      }
    } catch (err) {
      const message = err instanceof Error && err.message ? err.message : 'неизвестная ошибка';
      errors.push(`Ошибка записи ${change.path}: ${message}`);
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
