import { CloseIcon, CodeIcon, FileTextIcon, VideoIcon } from '@/components/icons';
import { formatFileSize, getFileExtension } from '@/features/chat/attachment-utils';
import type { MessageAttachment } from '@/features/chat/types';

interface ComposerAttachmentsProps {
  attachments: MessageAttachment[];
  onRemove: (id: string) => void;
}

export function ComposerAttachments({ attachments, onRemove }: ComposerAttachmentsProps) {
  if (attachments.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-2 pb-2">
      {attachments.map((att) => {
        const ext = getFileExtension(att.name).toUpperCase() || 'FILE';

        return (
          <div
            key={att.id}
            className="group relative flex items-center gap-2 rounded-lg border border-stroke bg-surface-2/80 px-2.5 py-1.5 text-xs text-text shadow-sm backdrop-blur transition hover:border-stroke-strong"
          >
            {att.category === 'image' && att.url ? (
              <img
                src={att.url}
                alt={att.name}
                className="size-8 shrink-0 rounded object-cover border border-stroke"
              />
            ) : att.category === 'video' ? (
              <div className="flex size-8 shrink-0 items-center justify-center rounded bg-accent-soft text-accent">
                <VideoIcon className="size-4" />
              </div>
            ) : att.category === 'code' ? (
              <div className="flex size-8 shrink-0 items-center justify-center rounded bg-accent-soft text-accent">
                <CodeIcon className="size-4" />
              </div>
            ) : (
              <div className="flex size-8 shrink-0 items-center justify-center rounded bg-surface text-muted">
                <FileTextIcon className="size-4" />
              </div>
            )}

            <div className="flex max-w-[140px] flex-col overflow-hidden sm:max-w-[180px]">
              <span className="truncate font-medium text-text">{att.name}</span>
              <div className="flex items-center gap-1.5 text-[10px] text-muted">
                <span className="font-mono uppercase font-semibold text-accent/80">{ext}</span>
                <span>•</span>
                <span>{formatFileSize(att.size)}</span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => onRemove(att.id)}
              className="ml-1 inline-flex size-5 shrink-0 items-center justify-center rounded-full text-muted transition hover:bg-surface hover:text-text"
              aria-label={`Удалить ${att.name}`}
              title="Удалить"
            >
              <CloseIcon className="size-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
