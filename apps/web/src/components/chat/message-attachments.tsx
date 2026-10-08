import { useState } from 'react';
import { CodeIcon, DownloadIcon, EyeIcon, FileTextIcon } from '@/components/icons';
import { IconButton } from '@/components/ui/icon-button';
import { Modal, ModalHeader } from '@/components/ui/modal';
import { formatFileSize, getFileExtension } from '@/features/chat/attachment-utils';
import type { MessageAttachment } from '@/features/chat/types';
import { useTranslation } from '@/i18n';
import { cn } from '@/lib/cn';

interface MessageAttachmentsProps {
  attachments: MessageAttachment[];
}

export function MessageAttachments({ attachments }: MessageAttachmentsProps) {
  const { t } = useTranslation();
  const [activeImage, setActiveImage] = useState<MessageAttachment | null>(null);
  const [previewFile, setPreviewFile] = useState<MessageAttachment | null>(null);

  if (!attachments || attachments.length === 0) {
    return null;
  }

  const images = attachments.filter((att) => att.category === 'image');
  const videos = attachments.filter((att) => att.category === 'video');
  const files = attachments.filter((att) => att.category !== 'image' && att.category !== 'video');

  return (
    <div className="flex max-w-full flex-col items-end gap-2.5">
      {/* 1. Галерея изображений */}
      {images.length > 0 ? (
        <div
          className={cn(
            'grid w-full gap-2',
            images.length === 1
              ? 'max-w-[400px] grid-cols-1'
              : images.length === 2
                ? 'max-w-[500px] grid-cols-2'
                : 'max-w-[600px] grid-cols-2 sm:grid-cols-3',
          )}
        >
          {images.map((img) => (
            <button
              key={img.id}
              type="button"
              onClick={() => setActiveImage(img)}
              className="group relative overflow-hidden rounded-xl border border-stroke bg-canvas text-left transition-colors hover:border-accent"
            >
              <img
                src={img.url}
                alt={img.name}
                loading="lazy"
                className="max-h-64 w-full object-cover transition-transform duration-300 group-hover:scale-105"
              />
              <span className="absolute inset-0 flex items-end bg-gradient-to-t from-black/70 via-transparent to-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                <span className="truncate text-xs font-medium text-white">{img.name}</span>
              </span>
            </button>
          ))}
        </div>
      ) : null}

      {/* 2. Видеоплеер */}
      {videos.length > 0 ? (
        <div className="flex w-full max-w-[520px] flex-col gap-2">
          {videos.map((vid) => (
            <div key={vid.id} className="overflow-hidden rounded-xl border border-stroke bg-black shadow-sm">
              <video src={vid.url} controls preload="metadata" className="max-h-72 w-full object-contain">
                {t('msgAtt.noVideo')}
              </video>
              <div className="flex items-center justify-between gap-3 border-t border-stroke bg-surface px-3 py-2 text-xs text-muted">
                <span className="truncate font-medium text-text">{vid.name}</span>
                <span className="shrink-0">{formatFileSize(vid.size)}</span>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {/* 3. Документы, код и файлы */}
      {files.length > 0 ? (
        <div className="flex flex-wrap justify-end gap-2">
          {files.map((file) => {
            const ext = getFileExtension(file.name).toUpperCase() || 'FILE';
            const isCodeOrText = file.category === 'code' || file.category === 'document';

            return (
              <div
                key={file.id}
                className="flex items-center gap-2.5 rounded-xl border border-stroke bg-surface-2 py-1.5 pr-1.5 pl-1.5 text-xs text-text shadow-xs transition-colors hover:border-stroke-strong"
              >
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface text-accent">
                  {file.category === 'code' ? (
                    <CodeIcon className="size-4" />
                  ) : (
                    <FileTextIcon className="size-4 text-muted" />
                  )}
                </div>

                <div className="flex max-w-[140px] flex-col overflow-hidden sm:max-w-[220px]">
                  <span className="truncate font-medium text-text">{file.name}</span>
                  <div className="flex items-center gap-1.5 text-[11px] text-muted">
                    <span className="font-mono font-semibold text-accent uppercase">{ext}</span>
                    <span aria-hidden="true">•</span>
                    <span>{formatFileSize(file.size)}</span>
                  </div>
                </div>

                <div className="flex items-center">
                  {isCodeOrText && file.contentPreview ? (
                    <IconButton label={t('msgAtt.view')} size="sm" onClick={() => setPreviewFile(file)}>
                      <EyeIcon className="size-3.5" />
                    </IconButton>
                  ) : null}

                  {file.url ? (
                    <a
                      href={file.url}
                      download={file.name}
                      title={t('msgAtt.download')}
                      aria-label={t('msgAtt.download')}
                      className="inline-flex size-9 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface hover:text-text max-md:size-11"
                    >
                      <DownloadIcon className="size-3.5" />
                    </a>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {/* Просмотр изображения (lightbox) */}
      {activeImage ? (
        <Modal
          labelledBy="attachment-image-title"
          onClose={() => setActiveImage(null)}
          size="xl"
          className="w-auto max-w-[94vw] bg-canvas"
        >
          <ModalHeader
            titleId="attachment-image-title"
            title={<span className="block truncate">{activeImage.name}</span>}
            actions={
              <a
                href={activeImage.url}
                download={activeImage.name}
                title={t('msgAtt.downloadShort')}
                aria-label={t('msgAtt.downloadShort')}
                className="inline-flex size-9 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-text max-md:size-11"
              >
                <DownloadIcon className="size-4" />
              </a>
            }
            onClose={() => setActiveImage(null)}
          />
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-3">
            <img
              src={activeImage.url}
              alt={activeImage.name}
              className="max-h-[78dvh] max-w-full rounded-lg object-contain"
            />
          </div>
        </Modal>
      ) : null}

      {/* Просмотр кода / текста файла */}
      {previewFile ? (
        <Modal labelledBy="attachment-file-title" onClose={() => setPreviewFile(null)} size="lg" className="max-w-3xl">
          <ModalHeader
            titleId="attachment-file-title"
            icon={<CodeIcon className="size-5" />}
            title={previewFile.name}
            description={<span className="font-mono text-xs">{formatFileSize(previewFile.size)}</span>}
            onClose={() => setPreviewFile(null)}
          />
          <div tabIndex={0} className="m-4 min-h-0 flex-1 overflow-auto rounded-xl border border-stroke bg-canvas p-4 font-mono text-xs text-text focus-visible:outline-2 focus-visible:outline-accent">
            <pre className="whitespace-pre-wrap">{previewFile.contentPreview}</pre>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
