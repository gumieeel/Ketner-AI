import { CloseIcon, CodeIcon, FileTextIcon, VideoIcon } from '@/components/icons';
import { attachmentHasText, formatFileSize, getFileExtension } from '@/features/chat/attachment-utils';
import type { MessageAttachment } from '@/features/chat/types';
import { useTranslation } from '@/i18n';

interface ComposerAttachmentsProps {
  attachments: MessageAttachment[];
  onRemove: (id: string) => void;
}

export function ComposerAttachments({ attachments, onRemove }: ComposerAttachmentsProps) {
  const { t } = useTranslation();

  if (attachments.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-2 pb-2.5">
      {attachments.map((att) => {
        const ext = getFileExtension(att.name).toUpperCase() || 'FILE';
        // Честно показываем, что именно увидит модель: текст есть не у каждого вложения.
        const warning = attachmentHasText(att)
          ? null
          : att.category === 'image'
            ? t('attachment.noImageAnalysis')
            : t('attachment.noText');

        return (
          <div
            key={att.id}
            className="group relative flex items-center gap-2.5 rounded-xl border border-stroke bg-surface-2/80 py-1.5 pr-1.5 pl-1.5 text-xs text-text shadow-sm transition-colors hover:border-stroke-strong"
          >
            {att.category === 'image' && att.url ? (
              <img
                src={att.url}
                alt={att.name}
                className="size-9 shrink-0 rounded-lg border border-stroke object-cover"
              />
            ) : att.category === 'video' ? (
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
                <VideoIcon className="size-4" />
              </div>
            ) : att.category === 'code' ? (
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
                <CodeIcon className="size-4" />
              </div>
            ) : (
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface text-muted">
                <FileTextIcon className="size-4" />
              </div>
            )}

            <div className="flex max-w-[140px] flex-col overflow-hidden sm:max-w-[180px]">
              <span className="truncate font-medium text-text">{att.name}</span>
              <div className="flex items-center gap-1.5 text-[11px] text-muted">
                <span className="font-mono font-semibold uppercase text-accent">{ext}</span>
                <span>•</span>
                <span>{formatFileSize(att.size)}</span>
              </div>
              {warning && (
                <span className="truncate text-[11px] text-warning" title={t('attachment.modelGetsMeta')}>
                  {warning}
                </span>
              )}
            </div>

            <button
              type="button"
              onClick={() => onRemove(att.id)}
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-3 hover:text-text max-md:size-10"
              aria-label={t('attachment.remove', { name: att.name })}
              title={t('attachment.removeShort')}
            >
              <CloseIcon className="size-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
