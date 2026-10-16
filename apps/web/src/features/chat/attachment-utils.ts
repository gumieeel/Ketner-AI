import { extractOfficeText, type OfficeFormat } from './office-text';
import type { AttachmentCategory, MessageAttachment } from './types';

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif']);
const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv', 'm4v']);
const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac']);
const CODE_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'json', 'py', 'rs', 'go', 'html', 'css', 'scss',
  'c', 'cpp', 'h', 'hpp', 'cs', 'java', 'kt', 'swift', 'php', 'rb', 'sql',
  'sh', 'bash', 'zsh', 'yaml', 'yml', 'toml', 'env', 'xml', 'md', 'graphql',
]);
const DOCUMENT_EXTENSIONS = new Set([
  'pdf', 'doc', 'docx', 'txt', 'rtf', 'csv', 'tsv', 'xlsx', 'xls', 'pptx', 'ppt', 'odt', 'ods', 'odp',
]);
/** Документы, которые действительно являются обычным текстом. */
const PLAIN_TEXT_DOCUMENT_EXTENSIONS = new Set(['txt', 'csv', 'tsv', 'md', 'markdown', 'log']);
const OFFICE_FORMATS = new Set<string>(['docx', 'xlsx', 'pptx']);
/** Расширения файлов проекта, которые можно читать как текст. */
const READABLE_TEXT_EXTENSIONS = new Set([
  ...CODE_EXTENSIONS,
  ...PLAIN_TEXT_DOCUMENT_EXTENSIONS,
  'vue', 'svelte', 'ini', 'cfg', 'conf', 'properties', 'gradle', 'lua', 'dart', 'scala', 'r', 'ps1', 'bat',
  'mjs', 'cjs', 'tf', 'proto', 'prisma', 'lock',
]);
const READABLE_TEXT_BASENAMES = new Set([
  'dockerfile', 'makefile', 'procfile', '.gitignore', '.dockerignore', '.editorconfig', '.prettierrc',
  '.eslintrc', '.nvmrc', 'license', 'readme',
]);
const ARCHIVE_EXTENSIONS = new Set(['zip', 'tar', 'gz', 'tgz', 'rar', '7z', 'bz2']);

export function getFileExtension(filename: string): string {
  const parts = filename.split('.');
  return parts.length > 1 ? (parts.pop()?.toLowerCase() ?? '') : '';
}

/** Можно ли читать файл проекта как текст (по расширению или имени). */
export function isReadableTextPath(path: string): boolean {
  const base = (path.split('/').pop() ?? path).toLowerCase();
  if (READABLE_TEXT_BASENAMES.has(base)) return true;
  return READABLE_TEXT_EXTENSIONS.has(getFileExtension(base));
}

export function detectCategory(file: { name: string; type: string }): AttachmentCategory {
  const ext = getFileExtension(file.name);
  const mime = file.type.toLowerCase();

  if (mime.startsWith('image/') || IMAGE_EXTENSIONS.has(ext)) {
    return 'image';
  }
  // Расширение кода проверяется до MIME: браузеры отдают `.ts` как `video/mp2t`.
  if (CODE_EXTENSIONS.has(ext)) {
    return 'code';
  }
  if (mime.startsWith('video/') || VIDEO_EXTENSIONS.has(ext)) {
    return 'video';
  }
  if (mime.startsWith('audio/') || AUDIO_EXTENSIONS.has(ext)) {
    return 'audio';
  }
  if (mime.includes('javascript') || mime.includes('typescript') || mime.includes('json')) {
    return 'code';
  }
  if (DOCUMENT_EXTENSIONS.has(ext) || mime.includes('pdf') || mime.includes('text/')) {
    return 'document';
  }
  if (ARCHIVE_EXTENSIONS.has(ext) || mime.includes('zip') || mime.includes('compressed')) {
    return 'archive';
  }
  return 'file';
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Читает текстовый файл целиком (до 512 КБ) либо его начало; бинарное содержимое отбрасывается. */
async function readPlainText(file: Blob): Promise<string | undefined> {
  const limit = 512 * 1024;
  const text = file.size <= limit
    ? await file.text()
    : (await file.slice(0, 64 * 1024).text()) + '\n\n... [файл обрезан из-за большого размера]';
  // Нулевой байт в тексте — надёжный признак бинарного файла.
  return text.includes('\u0000') ? undefined : text;
}

/** Есть ли у вложения текст, доступный модели (для подсказок в интерфейсе). */
export function attachmentHasText(attachment: Pick<MessageAttachment, 'category' | 'contentPreview'>): boolean {
  return typeof attachment.contentPreview === 'string' && attachment.contentPreview.length > 0;
}

function createAttachmentId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `att-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/**
 * Читает File из браузера и превращает в MessageAttachment.
 * Для текстовых/код-файлов сохраняет содержимое в contentPreview.
 * Для медиа (фото/видео) формирует data URL или object URL.
 */
export async function readFileAsAttachment(file: File): Promise<MessageAttachment> {
  const category = detectCategory(file);
  const id = createAttachmentId();

  let url: string;
  let contentPreview: string | undefined = undefined;

  // В контекст ИИ попадает только настоящий текст. Бинарные форматы раньше читались как
  // строка и превращались в «кракозябры», за которые пользователь платил токенами.
  const ext = getFileExtension(file.name);
  try {
    if (category === 'code' || (category === 'document' && PLAIN_TEXT_DOCUMENT_EXTENSIONS.has(ext))) {
      contentPreview = await readPlainText(file);
    } else if (category === 'document' && OFFICE_FORMATS.has(ext)) {
      contentPreview = (await extractOfficeText(file, ext as OfficeFormat)) ?? undefined;
    }
  } catch {
    // Текст не извлечён — вложение останется «без текста», модель и пользователь об этом узнают.
  }

  // Создаем Data URL для изображений (чтобы они сохранялись и отображались стабильно)
  if (category === 'image' && file.size <= 8 * 1024 * 1024) {
    url = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => resolve(URL.createObjectURL(file));
      reader.readAsDataURL(file);
    });
  } else {
    url = URL.createObjectURL(file);
  }

  return {
    id,
    name: file.name,
    size: file.size,
    type: file.type || 'application/octet-stream',
    category,
    url,
    contentPreview,
  };
}
