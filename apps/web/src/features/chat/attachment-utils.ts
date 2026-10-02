import type { AttachmentCategory, MessageAttachment } from './types';

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif']);
const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv', 'm4v']);
const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac']);
const CODE_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'json', 'py', 'rs', 'go', 'html', 'css', 'scss',
  'c', 'cpp', 'h', 'hpp', 'cs', 'java', 'kt', 'swift', 'php', 'rb', 'sql',
  'sh', 'bash', 'zsh', 'yaml', 'yml', 'toml', 'env', 'xml', 'md', 'graphql',
]);
const DOCUMENT_EXTENSIONS = new Set(['pdf', 'doc', 'docx', 'txt', 'rtf', 'csv', 'tsv', 'xlsx', 'xls', 'pptx']);
const ARCHIVE_EXTENSIONS = new Set(['zip', 'tar', 'gz', 'tgz', 'rar', '7z', 'bz2']);

export function getFileExtension(filename: string): string {
  const parts = filename.split('.');
  return parts.length > 1 ? (parts.pop()?.toLowerCase() ?? '') : '';
}

export function detectCategory(file: { name: string; type: string }): AttachmentCategory {
  const ext = getFileExtension(file.name);
  const mime = file.type.toLowerCase();

  if (mime.startsWith('image/') || IMAGE_EXTENSIONS.has(ext)) {
    return 'image';
  }
  if (mime.startsWith('video/') || VIDEO_EXTENSIONS.has(ext)) {
    return 'video';
  }
  if (mime.startsWith('audio/') || AUDIO_EXTENSIONS.has(ext)) {
    return 'audio';
  }
  if (CODE_EXTENSIONS.has(ext) || mime.includes('javascript') || mime.includes('typescript') || mime.includes('json')) {
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

  let url = '';
  let contentPreview: string | undefined = undefined;

  // Текстовые и файлы с кодом читаем как текст для передачи ИИ в контекст
  if (category === 'code' || category === 'document') {
    try {
      if (file.size <= 512 * 1024) { // До 512 КБ читаем текст целиком
        const text = await file.text();
        contentPreview = text;
      } else {
        const slice = file.slice(0, 64 * 1024);
        contentPreview = (await slice.text()) + '\n\n... [файл обрезан из-за большого размера]';
      }
    } catch {
      // Игнорируем ошибку чтения (например, бинарный PDF)
    }
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
