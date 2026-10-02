import { useState } from 'react';
import { CloseIcon, CodeIcon, DownloadIcon, EyeIcon, FileTextIcon } from '@/components/icons';
import { formatFileSize, getFileExtension } from '@/features/chat/attachment-utils';
import type { MessageAttachment } from '@/features/chat/types';

interface MessageAttachmentsProps {
  attachments: MessageAttachment[];
}

export function MessageAttachments({ attachments }: MessageAttachmentsProps) {
  const [activeImage, setActiveImage] = useState<MessageAttachment | null>(null);
  const [previewFile, setPreviewFile] = useState<MessageAttachment | null>(null);

  if (!attachments || attachments.length === 0) {
    return null;
  }

  const images = attachments.filter((att) => att.category === 'image');
  const videos = attachments.filter((att) => att.category === 'video');
  const files = attachments.filter((att) => att.category !== 'image' && att.category !== 'video');

  return (
    <div className="flex flex-col gap-2.5 max-w-full">
      {/* 1. Галерея изображений */}
      {images.length > 0 ? (
        <div
          className={`grid gap-2 ${
            images.length === 1
              ? 'grid-cols-1 max-w-[400px]'
              : images.length === 2
                ? 'grid-cols-2 max-w-[500px]'
                : 'grid-cols-2 sm:grid-cols-3 max-w-[600px]'
          }`}
        >
          {images.map((img) => (
            <div
              key={img.id}
              onClick={() => setActiveImage(img)}
              className="group relative cursor-pointer overflow-hidden rounded-lg border border-stroke bg-canvas transition hover:border-accent"
            >
              <img
                src={img.url}
                alt={img.name}
                loading="lazy"
                className="max-h-64 w-full object-cover transition duration-300 group-hover:scale-105"
              />
              <div className="absolute inset-0 flex items-end bg-gradient-to-t from-black/70 via-transparent to-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100">
                <span className="truncate text-xs font-medium text-white">{img.name}</span>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {/* 2. Видеоплеер */}
      {videos.length > 0 ? (
        <div className="flex flex-col gap-2 max-w-[520px]">
          {videos.map((vid) => (
            <div
              key={vid.id}
              className="overflow-hidden rounded-lg border border-stroke bg-black shadow-sm"
            >
              <video
                src={vid.url}
                controls
                preload="metadata"
                className="max-h-72 w-full object-contain"
              >
                Ваш браузер не поддерживает встроенное воспроизведение видео.
              </video>
              <div className="flex items-center justify-between border-t border-stroke/40 bg-surface px-3 py-1.5 text-xs text-muted">
                <span className="truncate font-medium text-text">{vid.name}</span>
                <span>{formatFileSize(vid.size)}</span>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {/* 3. Документы, код и файлы */}
      {files.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {files.map((file) => {
            const ext = getFileExtension(file.name).toUpperCase() || 'FILE';
            const isCodeOrText = file.category === 'code' || file.category === 'document';

            return (
              <div
                key={file.id}
                className="flex items-center gap-2.5 rounded-lg border border-stroke bg-surface-2 px-3 py-2 text-xs text-text shadow-sm transition hover:border-stroke-strong"
              >
                <div className="flex size-8 shrink-0 items-center justify-center rounded bg-surface text-accent">
                  {file.category === 'code' ? (
                    <CodeIcon className="size-4" />
                  ) : (
                    <FileTextIcon className="size-4 text-muted" />
                  )}
                </div>

                <div className="flex flex-col overflow-hidden max-w-[160px] sm:max-w-[220px]">
                  <span className="truncate font-medium text-text">{file.name}</span>
                  <div className="flex items-center gap-1.5 text-[10px] text-muted">
                    <span className="font-mono uppercase font-semibold text-accent/80">{ext}</span>
                    <span>•</span>
                    <span>{formatFileSize(file.size)}</span>
                  </div>
                </div>

                <div className="ml-2 flex items-center gap-1">
                  {isCodeOrText && file.contentPreview ? (
                    <button
                      type="button"
                      onClick={() => setPreviewFile(file)}
                      title="Просмотреть содержимое"
                      className="inline-flex size-6 items-center justify-center rounded text-muted hover:bg-surface hover:text-text"
                    >
                      <EyeIcon className="size-3.5" />
                    </button>
                  ) : null}

                  {file.url ? (
                    <a
                      href={file.url}
                      download={file.name}
                      title="Скачать файл"
                      className="inline-flex size-6 items-center justify-center rounded text-muted hover:bg-surface hover:text-text"
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

      {/* Модальное окно просмотра изображения (Lightbox) */}
      {activeImage ? (
        <div
          onClick={() => setActiveImage(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm animate-in fade-in duration-200"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative flex max-h-[90vh] max-w-[90vw] flex-col items-center"
          >
            <div className="mb-2 flex w-full items-center justify-between text-white">
              <span className="truncate text-sm font-medium">{activeImage.name}</span>
              <div className="flex items-center gap-2">
                <a
                  href={activeImage.url}
                  download={activeImage.name}
                  className="rounded p-1.5 hover:bg-white/10"
                  title="Скачать"
                >
                  <DownloadIcon className="size-4" />
                </a>
                <button
                  type="button"
                  onClick={() => setActiveImage(null)}
                  className="rounded p-1.5 hover:bg-white/10"
                >
                  <CloseIcon className="size-5" />
                </button>
              </div>
            </div>
            <img
              src={activeImage.url}
              alt={activeImage.name}
              className="max-h-[80vh] max-w-full rounded-lg object-contain shadow-2xl"
            />
          </div>
        </div>
      ) : null}

      {/* Модальное окно просмотра кода / текста файла */}
      {previewFile ? (
        <div
          onClick={() => setPreviewFile(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-xl border border-stroke bg-canvas p-4 shadow-2xl"
          >
            <div className="mb-3 flex items-center justify-between border-b border-stroke pb-2.5">
              <div className="flex items-center gap-2">
                <CodeIcon className="size-4 text-accent" />
                <span className="font-semibold text-text">{previewFile.name}</span>
                <span className="text-xs text-muted font-mono">({formatFileSize(previewFile.size)})</span>
              </div>
              <button
                type="button"
                onClick={() => setPreviewFile(null)}
                className="rounded p-1 text-muted hover:text-text"
              >
                <CloseIcon className="size-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-stroke bg-surface p-3 font-mono text-xs text-text">
              <pre className="whitespace-pre-wrap">{previewFile.contentPreview}</pre>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
