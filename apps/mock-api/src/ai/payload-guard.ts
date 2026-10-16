/**
 * Payload Guard (Phase 5).
 *
 * Защита шлюза от перегрузки, DoS и гигантских полезных нагрузок.
 * Проверяет лимиты на:
 * - Суммарный размер текста всех сообщений (по умолчанию 250,000 символов)
 * - Размер одного сообщения (по умолчанию 100,000 символов)
 * - Количество вложений (по умолчанию не более 10)
 * - Размер отдельного вложения (по умолчанию не более 20 МБ)
 */

import type { Language, MessageAttachment } from './gateway-types.js';

export interface PayloadGuardLimits {
  /** Суммарный размер содержимого файлов привязанного проекта в одном запросе, символов. */
  maxWorkspaceChars?: number;
  maxTotalChars?: number;
  maxMessageChars?: number;
  maxAttachmentsCount?: number;
  maxAttachmentBytes?: number;
}

export interface PayloadValidationResult {
  valid: boolean;
  code?:
    'payload_too_large' | 'message_too_large' | 'too_many_attachments' | 'attachment_too_large';
  message?: string;
}

export const DEFAULT_PAYLOAD_LIMITS: Required<PayloadGuardLimits> = {
  maxWorkspaceChars: 400_000,
  maxTotalChars: 250_000,
  maxMessageChars: 100_000,
  maxAttachmentsCount: 10,
  maxAttachmentBytes: 20 * 1024 * 1024, // 20 MB
};

export class PayloadGuard {
  static validate(
    messages: Array<{ role: string; content: string; attachments?: MessageAttachment[] }>,
    options?: {
      limits?: PayloadGuardLimits;
      language?: Language;
      attachments?: MessageAttachment[];
      /** Проект, привязанный к последнему сообщению. */
      workspace?: { files?: Array<{ content?: string }> };
    },
  ): PayloadValidationResult {
    const limits = { ...DEFAULT_PAYLOAD_LIMITS, ...options?.limits };
    const lang = options?.language ?? 'ru';

    // 1. Проверка вложений: считаются только вложения ТЕКУЩЕГО запроса (последнее сообщение и
    // явно переданные). Раньше складывались вложения всей истории, и после 10 файлов за диалог
    // каждый следующий запрос, даже текстовый, получал 400; а переданные отдельно вложения
    // последнего сообщения считались дважды.
    const lastMessage = messages[messages.length - 1];
    const byId = new Map<string, MessageAttachment>();
    for (const att of [...(options?.attachments ?? []), ...(lastMessage?.attachments ?? [])]) {
      byId.set(att.id ?? `${att.name}:${att.size}`, att);
    }
    const allAttachments: MessageAttachment[] = Array.from(byId.values());

    if (allAttachments.length > limits.maxAttachmentsCount) {
      return {
        valid: false,
        code: 'too_many_attachments',
        message:
          lang === 'en'
            ? `Too many attachments: maximum ${limits.maxAttachmentsCount} files allowed (received ${allAttachments.length})`
            : `Слишком много вложений: разрешено не более ${limits.maxAttachmentsCount} файлов (передано ${allAttachments.length})`,
      };
    }

    for (const att of allAttachments) {
      const size = att.size ?? att.extractedText?.length ?? 0;
      if (size > limits.maxAttachmentBytes) {
        return {
          valid: false,
          code: 'attachment_too_large',
          message:
            lang === 'en'
              ? `Attachment "${att.name}" exceeds the maximum allowed size of ${Math.round(limits.maxAttachmentBytes / (1024 * 1024))}MB`
              : `Файл "${att.name}" превышает максимальный размер ${Math.round(limits.maxAttachmentBytes / (1024 * 1024))}МБ`,
        };
      }
    }

    // 1.1. Размер содержимого привязанного проекта
    if (options?.workspace?.files) {
      let workspaceChars = 0;
      for (const file of options.workspace.files) {
        workspaceChars += file.content?.length ?? 0;
      }
      if (workspaceChars > limits.maxWorkspaceChars) {
        return {
          valid: false,
          code: 'payload_too_large',
          message:
            lang === 'en'
              ? `The linked project is too large: ${workspaceChars} characters of file contents (max allowed: ${limits.maxWorkspaceChars})`
              : `Привязанный проект слишком большой: ${workspaceChars} символов содержимого файлов (максимум: ${limits.maxWorkspaceChars})`,
        };
      }
    }

    // 2. Проверка каждого сообщения
    let totalChars = 0;
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      const len = msg.content?.length ?? 0;
      totalChars += len;

      if (len > limits.maxMessageChars) {
        return {
          valid: false,
          code: 'message_too_large',
          message:
            lang === 'en'
              ? `Message #${i + 1} is too long: ${len} chars (max allowed: ${limits.maxMessageChars})`
              : `Сообщение #${i + 1} слишком длинное: ${len} символов (максимум: ${limits.maxMessageChars})`,
        };
      }
    }

    // 3. Проверка суммарного размера сообщений
    if (totalChars > limits.maxTotalChars) {
      return {
        valid: false,
        code: 'payload_too_large',
        message:
          lang === 'en'
            ? `Total conversation payload is too large: ${totalChars} chars (max allowed: ${limits.maxTotalChars})`
            : `Суммарный размер контекста диалога слишком велик: ${totalChars} символов (максимум: ${limits.maxTotalChars})`,
      };
    }

    return { valid: true };
  }
}
