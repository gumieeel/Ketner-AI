import type {
  FileActionType,
  FileChangeItem,
  FileProposal,
  FileReplaceEdit,
  RejectedFileChange,
  WorkspaceContext,
  WorkspaceFile,
} from '../types';
import { generateLineDiff } from './diff-generator';
import { isSensitivePath, sanitizeChangePath } from './path-safety';
import { applyTextReplace } from './text-patch';

/**
 * Блок ```file-actions … ```. Закрывающее ограждение ищется только в начале строки: JSON
 * записывается в одну строку на значение (переводы строк экранированы), поэтому тройные
 * кавычки внутри содержимого файла (например, README.md) не обрывают блок.
 */
const FILE_ACTIONS_BLOCK =
  /(`{3,})(?:file-actions|file-action)[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*\1(?!`)/gi;
/** Незакрытый блок в конце текста — ответ ещё стримится или оборван. */
const UNCLOSED_FILE_ACTIONS = /`{3,}(?:file-actions|file-action)[ \t]*\r?\n[\s\S]*$/i;

interface RawChange {
  action: FileActionType;
  path: unknown;
  description?: string;
  content?: string;
  targetContent?: string;
  replacementContent?: string;
}

function readAction(value: unknown): FileActionType {
  const v = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (v === 'replace' || v === 'edit' || v === 'patch') return 'replace';
  if (v === 'delete' || v === 'remove') return 'delete';
  return 'write';
}

function readRawChange(item: unknown): RawChange | null {
  if (!item || typeof item !== 'object') return null;
  const o = item as Record<string, unknown>;
  if (typeof o.path !== 'string') return null;
  return {
    action: readAction(o.action),
    path: o.path,
    description: typeof o.description === 'string' ? o.description : undefined,
    content: typeof o.content === 'string' ? o.content : undefined,
    targetContent: typeof o.targetContent === 'string' ? o.targetContent : undefined,
    replacementContent: typeof o.replacementContent === 'string' ? o.replacementContent : undefined,
  };
}

function collectRawChanges(content: string): RawChange[] {
  const raw: RawChange[] = [];

  // 1. JSON-блоки ```file-actions
  for (const match of content.matchAll(FILE_ACTIONS_BLOCK)) {
    try {
      const parsed: unknown = JSON.parse(match[2].trim());
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of items) {
        const change = readRawChange(item);
        if (change) raw.push(change);
      }
    } catch {
      // Невалидный JSON не применяем: лучше не сделать ничего, чем сделать неверное.
    }
  }

  // 2. Блоки Aider SEARCH/REPLACE:
  // <<<<<<< SEARCH: path/to/file.ts
  // old
  // =======
  // new
  // >>>>>>>
  const aiderRegex = /<{5,}\s*SEARCH(?::\s*([^\n\r]+))?\s*\n([\s\S]*?)={5,}\s*\n([\s\S]*?)>{5,}/g;
  for (const match of content.matchAll(aiderRegex)) {
    let targetContent = match[2];
    const replacementContent = match[3];
    let filePath = match[1]?.trim();

    // Если путь не указан в заголовке, он может стоять первой строкой блока поиска.
    if (!filePath && /^(\/\/|#)\s*path:/.test(targetContent)) {
      const lines = targetContent.split('\n');
      filePath = lines[0].replace(/^(\/\/|#)\s*path:\s*/, '').trim();
      targetContent = lines.slice(1).join('\n');
    }

    if (filePath) {
      raw.push({ action: 'replace', path: filePath, targetContent, replacementContent });
    }
  }

  return raw;
}

interface FileState {
  path: string;
  /** Файл есть в проекте до применения предложения. */
  existed: boolean;
  /** Полное и актуальное содержимое известно (не обрезано, не пустая загрузка). */
  fullyKnown: boolean;
  original: string;
  /** Текущее состояние после уже обработанных правок. */
  current: string;
  /** Файл удалён более ранней правкой этого ответа. */
  deleted: boolean;
  /** Хотя бы одна правка файла принята (иначе файл не попадает в предложение). */
  applied: boolean;
  /** Текст файла вообще не загружен (в отличие от обрезанного). */
  contentMissing: boolean;
  kind: FileActionType;
  edits: FileReplaceEdit[];
  descriptions: string[];
  warnings: string[];
  /** Файл создан или перезаписан целиком в этом предложении. */
  rewritten: boolean;
}

function adaptLineEndings(text: string, reference: string): string {
  return reference.includes('\r\n') && !text.includes('\r\n') ? text.replace(/\n/g, '\r\n') : text;
}

function lookupFile(files: WorkspaceFile[], path: string): WorkspaceFile | undefined {
  return files.find((f) => f.path === path);
}

/**
 * Извлекает структурированные предложения изменения файлов из текста ответа ассистента.
 *
 * Правила безопасности:
 *  - пути нормализуются и проверяются (`..`, `.git`, абсолютные пути, секреты — отклоняются);
 *  - `replace` применяется только к известному полному содержимому файла; если фрагмент не
 *    найден — правка отклоняется, а не превращается в перезапись файла;
 *  - несколько правок одного файла применяются последовательно и сливаются в одно изменение;
 *  - отклонённые правки возвращаются в `rejected`, чтобы пользователь видел причину.
 */
export function parseFileProposals(
  content: string,
  messageId: string,
  workspace?: WorkspaceContext | null,
): FileProposal | null {
  if (!content || typeof content !== 'string') return null;

  const rawChanges = collectRawChanges(content);
  if (rawChanges.length === 0) return null;

  const files = workspace?.files ?? [];
  const knownPaths = files.map((f) => f.path);
  const rootName = workspace?.type === 'local_folder' ? workspace.name : undefined;

  const states = new Map<string, FileState>();
  const order: string[] = [];
  const rejected: RejectedFileChange[] = [];

  const reject = (path: string, action: FileActionType, reason: string) => {
    rejected.push({ path, action, reason });
  };

  for (const raw of rawChanges) {
    const checked = sanitizeChangePath(raw.path, { knownPaths, rootName });
    if (!checked.ok) {
      reject(typeof raw.path === 'string' ? raw.path : '(без пути)', raw.action, checked.reason);
      continue;
    }
    const path = checked.path;

    if (isSensitivePath(path)) {
      reject(
        path,
        raw.action,
        'файл с секретами: его содержимое не передаётся модели, менять его по её совету нельзя',
      );
      continue;
    }

    let state = states.get(path);
    if (!state) {
      const file = lookupFile(files, path);
      const fullyKnown = !!file && typeof file.content === 'string' && !file.truncated;
      state = {
        path,
        existed: !!file,
        fullyKnown,
        original: file?.content ?? '',
        current: file?.content ?? '',
        deleted: false,
        applied: false,
        contentMissing: !!file && typeof file.content !== 'string',
        kind: raw.action,
        edits: [],
        descriptions: [],
        warnings: [],
        rewritten: false,
      };
      states.set(path, state);
      order.push(path);
    }

    if (raw.action === 'write') {
      if (typeof raw.content !== 'string') {
        reject(path, 'write', 'в правке нет поля content с новым содержимым файла');
        continue;
      }
      const reference = state.existed ? state.original : '';
      state.current = adaptLineEndings(raw.content, reference);
      state.kind = 'write';
      state.rewritten = true;
      state.deleted = false;
      state.applied = true;
      state.edits = [];
      if (state.existed && !state.fullyKnown) {
        state.warnings.push('Файл загружен не полностью — показанный diff приблизителен');
      }
    } else if (raw.action === 'replace') {
      if (!workspace) {
        reject(path, 'replace', 'проект не привязан — заменять фрагмент не в чем');
        continue;
      }
      if (typeof raw.targetContent !== 'string' || raw.replacementContent === undefined) {
        reject(path, 'replace', 'в правке нет targetContent или replacementContent');
        continue;
      }
      if (state.deleted) {
        reject(path, 'replace', 'файл уже удалён более ранней правкой этого ответа');
        continue;
      }
      if (!state.existed && !state.rewritten) {
        reject(path, 'replace', 'файл не найден в проекте');
        continue;
      }
      if (state.existed && !state.rewritten && !state.fullyKnown) {
        reject(
          path,
          'replace',
          state.contentMissing
            ? 'содержимое файла не загружено (слишком большой или не текстовый файл) — точечно править его нельзя'
            : 'файл загружен не полностью (после перезагрузки страницы хранится только начало) — переподключите проект',
        );
        continue;
      }
      const result = applyTextReplace(state.current, raw.targetContent, raw.replacementContent);
      if (!result.ok) {
        reject(path, 'replace', result.reason);
        continue;
      }
      state.current = result.text;
      state.applied = true;
      if (!state.rewritten) {
        state.kind = 'replace';
        state.edits.push({
          targetContent: raw.targetContent,
          replacementContent: raw.replacementContent,
        });
      }
      if (result.occurrences > 1) {
        state.warnings.push(
          `Фрагмент встречается ${result.occurrences} раз — заменено первое вхождение`,
        );
      }
    } else {
      // delete
      if (state.deleted) continue;
      if (!state.existed && !state.rewritten) {
        reject(path, 'delete', 'файл не найден в проекте');
        continue;
      }
      if (!state.existed && state.rewritten) {
        // Создан и тут же удалён в одном ответе — итоговых изменений нет.
        states.delete(path);
        order.splice(order.indexOf(path), 1);
        continue;
      }
      state.deleted = true;
      state.applied = true;
      state.kind = 'delete';
      state.rewritten = false;
      state.edits = [];
    }

    if (raw.description) state.descriptions.push(raw.description.trim());
  }

  const changes: FileChangeItem[] = [];
  for (const path of order) {
    const state = states.get(path);
    if (!state || !state.applied) continue;

    const description = [...new Set(state.descriptions.filter(Boolean))].join('; ') || undefined;
    const warning = state.warnings.length > 0 ? state.warnings.join('; ') : undefined;

    if (state.deleted) {
      if (!state.existed) continue;
      const diff = generateLineDiff(state.original, '', path);
      changes.push({
        action: 'delete',
        path,
        description,
        warning,
        originalContent: state.original,
        modifiedContent: '',
        additions: diff.additions,
        deletions: diff.deletions,
      });
      continue;
    }

    // Правка ничего не меняет — не показываем пустой diff.
    if (state.existed && state.current === state.original) continue;

    const diff = generateLineDiff(state.original, state.current, path);
    const base: FileChangeItem = {
      action: state.kind === 'replace' ? 'replace' : 'write',
      path,
      description,
      warning,
      originalContent: state.original,
      modifiedContent: state.current,
      additions: diff.additions,
      deletions: diff.deletions,
    };
    if (state.kind === 'replace' && state.edits.length > 0) {
      base.edits = state.edits;
      base.targetContent = state.edits[0].targetContent;
      base.replacementContent = state.edits[0].replacementContent;
    } else {
      base.content = state.current;
    }
    changes.push(base);
  }

  if (changes.length === 0 && rejected.length === 0) return null;

  return {
    id: `proposal-${messageId}`,
    messageId,
    changes,
    rejected: rejected.length > 0 ? rejected : undefined,
    status: 'pending',
  };
}

/**
 * Очищает текст ответа от технических служебных блоков ```file-actions ... ```
 * чтобы пользователь видел чистый текст с пояснениями, а сами изменения выводились в интерактивной карточке.
 * Незакрытый блок (ответ ещё стримится) тоже скрывается.
 */
export function stripFileActionBlocks(content: string): string {
  if (!content) return '';
  return content.replace(FILE_ACTIONS_BLOCK, '').replace(UNCLOSED_FILE_ACTIONS, '').trim();
}
