import type { FileChangeItem, FileProposal, WorkspaceContext } from '../types';
import { generateLineDiff } from './diff-generator';

function normalizePath(raw: string): string {
  return raw
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\//, '');
}

/**
 * Извлекает структурированные предложения изменения файлов из текста ответа ассистента.
 */
export function parseFileProposals(
  content: string,
  messageId: string,
  workspace?: WorkspaceContext | null,
): FileProposal | null {
  if (!content || typeof content !== 'string') return null;

  const rawChanges: FileChangeItem[] = [];

  // 1. Поиск JSON блоков ```file-actions ... ``` или ```file-action ... ```
  const jsonBlockRegex = /```(?:file-actions|file-action)\s*\n([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;

  while ((match = jsonBlockRegex.exec(content)) !== null) {
    const rawJson = match[1].trim();
    try {
      const parsed = JSON.parse(rawJson);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item && typeof item.path === 'string') {
            rawChanges.push({
              action: item.action === 'replace' || item.action === 'delete' ? item.action : 'write',
              path: normalizePath(item.path),
              description: item.description,
              content: typeof item.content === 'string' ? item.content : undefined,
              targetContent: typeof item.targetContent === 'string' ? item.targetContent : undefined,
              replacementContent: typeof item.replacementContent === 'string' ? item.replacementContent : undefined,
            });
          }
        }
      } else if (parsed && typeof parsed.path === 'string') {
        rawChanges.push({
          action: parsed.action === 'replace' || parsed.action === 'delete' ? parsed.action : 'write',
          path: normalizePath(parsed.path),
          description: parsed.description,
          content: typeof parsed.content === 'string' ? parsed.content : undefined,
          targetContent: typeof parsed.targetContent === 'string' ? parsed.targetContent : undefined,
          replacementContent: typeof parsed.replacementContent === 'string' ? parsed.replacementContent : undefined,
        });
      }
    } catch {
      // Игнорируем невалидный JSON
    }
  }

  // 2. Поиск блоков в стиле Aider SEARCH/REPLACE:
  // <<<<<<< SEARCH: path/to/file.ts
  // old
  // =======
  // new
  // >>>>>>>
  const aiderRegex = /<{5,}\s*SEARCH(?::\s*([^\n\r]+))?\s*\n([\s\S]*?)={5,}\s*\n([\s\S]*?)>{5,}/g;
  while ((match = aiderRegex.exec(content)) !== null) {
    const pathFromHeader = match[1]?.trim();
    const targetContent = match[2];
    const replacementContent = match[3];

    let filePath = pathFromHeader;
    // Если путь не был указан в заголовке, проверяем первую строку поиска
    if (!filePath && targetContent.startsWith('// path:') || targetContent.startsWith('# path:')) {
      const lines = targetContent.split('\n');
      filePath = lines[0].replace(/^(\/\/|#)\s*path:\s*/, '').trim();
    }

    if (filePath) {
      rawChanges.push({
        action: 'replace',
        path: normalizePath(filePath),
        targetContent,
        replacementContent,
      });
    }
  }

  if (rawChanges.length === 0) {
    return null;
  }

  // Дедупликация изменений по пути: объединяем или сохраняем последовательность
  const processedChanges: FileChangeItem[] = [];

  for (const raw of rawChanges) {
    const existingFile = workspace?.files?.find(
      (f) => normalizePath(f.path) === raw.path || f.path === raw.path,
    );
    const originalContent = existingFile?.content ?? '';

    let modifiedContent = originalContent;

    if (raw.action === 'write') {
      modifiedContent = raw.content ?? '';
    } else if (raw.action === 'replace') {
      if (raw.targetContent && raw.replacementContent !== undefined) {
        if (originalContent.includes(raw.targetContent)) {
          modifiedContent = originalContent.replace(raw.targetContent, raw.replacementContent);
        } else {
          // Если точное совпадение не найдено из-за пробелов/переносов, пробуем trim-нормализацию
          const normTarget = raw.targetContent.trim();
          if (normTarget && originalContent.includes(normTarget)) {
            modifiedContent = originalContent.replace(normTarget, raw.replacementContent.trim());
          } else {
            // Если файл новый или пустой, берем заменяющий код
            modifiedContent = raw.replacementContent;
          }
        }
      } else {
        modifiedContent = raw.content ?? '';
      }
    } else if (raw.action === 'delete') {
      modifiedContent = '';
    }

    const diff = generateLineDiff(originalContent, modifiedContent, raw.path);

    processedChanges.push({
      ...raw,
      originalContent,
      modifiedContent,
      additions: diff.additions,
      deletions: diff.deletions,
    });
  }

  return {
    id: `proposal-${messageId}`,
    messageId,
    changes: processedChanges,
    status: 'pending',
  };
}

/**
 * Очищает текст ответа от технических служебных блоков ```file-actions ... ```
 * чтобы пользователь видел чистый текст с пояснениями, а сами изменения выводились в интерактивной карточке.
 */
export function stripFileActionBlocks(content: string): string {
  if (!content) return '';
  return content
    .replace(/```(?:file-actions|file-action)\s*\n[\s\S]*?```/gi, '')
    .trim();
}
