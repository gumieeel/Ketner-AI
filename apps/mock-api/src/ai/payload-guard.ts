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
  maxTotalChars?: number;
  maxMessageChars?: number;
  maxAttachmentsCount?: number;
  maxAttachmentBytes?: number;
}

export interface PayloadValidationResult {
  valid: boolean;
  code?: 'payload_too_large' | 'message_too_large' | 'too_many_attachments' | 'attachment_too_large';
  message?: string;
}

export const DEFAULT_PAYLOAD_LIMITS: Required<PayloadGuardLimits> = {
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
    },
  ): PayloadValidationResult {
    const limits = { ...DEFAULT_PAYLOAD_LIMITS, ...options?.limits };
    const lang = options?.language ?? 'ru';

    // 1. Проверка вложений
    const allAttachments: MessageAttachment[] = [
      ...(options?.attachments ?? []),
      ...messages.flatMap((m) => m.attachments ?? []),
    ];

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
      const size = att.size ?? (att.extractedText?.length ?? 0);
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
