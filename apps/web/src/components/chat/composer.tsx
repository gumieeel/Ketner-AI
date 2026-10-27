import {
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
} from 'react';
import {
  FolderIcon,
  GitHubIcon,
  PaperclipIcon,
  PlusIcon,
  SendIcon,
  StopIcon,
} from '@/components/icons';
import { IconButton } from '@/components/ui/icon-button';
import { readFileAsAttachment } from '@/features/chat/attachment-utils';
import { MODEL_NAME_KEYS, findModel } from '@/features/chat/model-catalog';
import { useChat } from '@/features/chat/chat-store';
import type { ModelInfo } from '@/features/chat/types';
import { usePreferences } from '@/features/preferences/preferences-store';
import { useWorkspace } from '@/features/chat/workspace-store';
import { useGithub } from '@/features/github/github-store';
import { useTranslation } from '@/i18n';
import { cn } from '@/lib/cn';
import { ComposerAttachments } from './composer-attachments';
import { ModelPicker } from './model-picker';
import { LinkWorkspaceModal, type LinkWorkspaceTab } from './link-workspace-modal';
import { WorkspaceBar } from './workspace-bar';
import { CompareBar } from './compare-bar';
import { useCompareSelection } from '@/features/chat/use-compare-selection';
import { useCompare } from '@/features/chat/compare-store';

const attachItemClass =
  'flex min-h-11 w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium text-text transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 md:min-h-10';

/** Высота поля ввода (до 5 строк), после которой появляется прокрутка. */
const MAX_HEIGHT_PX = 120;

export interface ComposerProps {
  /** `hero` — по центру пустого экрана; `dock` — внизу, под лентой сообщений. */
  variant?: 'hero' | 'dock';
}

/** Поле ввода сообщения: отправка, вложения фото/видео/файлов, привязка папки/репо и переключатель модели. */
export function Composer({ variant = 'dock' }: ComposerProps) {
  const { t } = useTranslation();
  const draft = useChat((state) => state.draft);
  const setDraft = useChat((state) => state.setDraft);
  const send = useChat((state) => state.send);
  const stop = useChat((state) => state.stop);
  const streaming = useChat((state) => state.streaming);
  const meta = useChat((state) => state.meta);
  const attachedFiles = useChat((state) => state.attachedFiles);
  const addAttachments = useChat((state) => state.addAttachments);
  const removeAttachment = useChat((state) => state.removeAttachment);
  const selectedModelId = usePreferences((state) => state.chatModelId);

  const fieldRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [isDragOver, setIsDragOver] = useState(false);
  const [isAttachMenuOpen, setIsAttachMenuOpen] = useState(false);
  const [isWorkspaceModalOpen, setIsWorkspaceModalOpen] = useState(false);
  const [workspaceTab, setWorkspaceTab] = useState<LinkWorkspaceTab>('folder');
  const resumeIntent = useGithub((state) => state.resumeIntent);
  const consumeGithubIntent = useGithub((state) => state.consumeIntent);

  useEffect(() => {
    // Вернулись после подключения GitHub из окна привязки — открываем его снова на вкладке GitHub.
    if (resumeIntent === 'link-repo' && consumeGithubIntent('link-repo')) {
      setWorkspaceTab('git');
      setIsWorkspaceModalOpen(true);
    }
  }, [resumeIntent, consumeGithubIntent]);

  const compareEnabled = useCompare((state) => state.enabled);
  const compareSelection = useCompareSelection();
  const compareReady = !compareEnabled || compareSelection.ids.length >= 2;

  const currentModel = findModel(meta?.models, selectedModelId);
  const activeWorkspace = useWorkspace((state) => state.activeWorkspace);

  const labelOf = (model: ModelInfo): string => {
    const key = MODEL_NAME_KEYS[model.id];
    return key ? t(key) : model.name;
  };

  const attachRef = useRef<HTMLDivElement | null>(null);

  // Меню вложений закрывается по Escape и клику вне него.
  useEffect(() => {
    if (!isAttachMenuOpen) {
      return;
    }
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setIsAttachMenuOpen(false);
      }
    };
    const onPointer = (event: PointerEvent): void => {
      if (attachRef.current && !attachRef.current.contains(event.target as Node)) {
        setIsAttachMenuOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [isAttachMenuOpen]);

  // Поле растёт под текст до предела, дальше включается прокрутка.
  useEffect(() => {
    const field = fieldRef.current;
    if (!field) {
      return;
    }
    field.style.height = 'auto';
    field.style.height = `${Math.min(field.scrollHeight, MAX_HEIGHT_PX)}px`;
  }, [draft]);

  // Обработка загруженных файлов
  const handleFiles = async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (list.length === 0) return;

    const parsed = await Promise.all(list.map((f) => readFileAsAttachment(f)));
    addAttachments(parsed);
  };

  const handleFileInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) {
      void handleFiles(event.target.files);
      event.target.value = '';
    }
    setIsAttachMenuOpen(false);
  };

  // Drag and drop
  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      void handleFiles(e.dataTransfer.files);
    }
  };

  // Clipboard paste (вставка скриншота или файла через Ctrl+V)
  const handlePaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    if (e.clipboardData.files && e.clipboardData.files.length > 0) {
      void handleFiles(e.clipboardData.files);
    }
  };

  const submit = (): void => {
    if (streaming) {
      return;
    }
    if (draft.trim() === '' && attachedFiles.length === 0) {
      return;
    }
    if (!compareReady) {
      return;
    }
    void send(draft, attachedFiles);
  };

  // Enter отправляет, Shift+Enter переносит строку — как в ChatGPT.
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };

  const canSubmit = (draft.trim() !== '' || attachedFiles.length > 0) && compareReady;

  const hero = variant === 'hero';

  return (
    <div
      className={cn(
        'relative mx-auto w-full max-w-[824px] shrink-0 px-3 md:px-4',
        !hero && 'pb-[max(0.75rem,env(safe-area-inset-bottom))] md:pb-5',
      )}
    >
      {/* Плавное «растворение» ленты под композером */}
      {hero ? null : (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 -top-6 h-6 bg-gradient-to-t from-canvas to-transparent" // taste-skill-ignore: neutral scrim over the message list
        />
      )}

      {/* Полоса привязанной рабочей папки / репозитория (только когда она привязана) */}
      {activeWorkspace ? (
        <div className="mb-1.5">
          <WorkspaceBar />
        </div>
      ) : null}

      {/* Модели, которые ответят на вопрос в режиме сравнения */}
      {compareEnabled ? <CompareBar disabled={streaming} /> : null}

      {/* Скрытый input для выбора файлов */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleFileInputChange}
      />

      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          'relative rounded-[32px] border bg-surface-2/60 p-2 shadow-sm',
          'transition-[border-color,box-shadow,background-color] duration-200',
          'focus-within:border-accent/50 focus-within:bg-surface-2 focus-within:ring-4 focus-within:ring-accent-soft',
          isDragOver ? 'border-accent ring-4 ring-accent-soft' : 'border-stroke-strong',
        )}
      >
        {isDragOver ? (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-[32px] bg-canvas/85 text-sm font-medium text-accent"
          >
            <span className="inline-flex items-center gap-2">
              <PaperclipIcon className="size-4" />
              {t('composer.dropHint')}
            </span>
          </div>
        ) : null}

        {/* Превью прикреплённых файлов */}
        <ComposerAttachments attachments={attachedFiles} onRemove={removeAttachment} />

        <label htmlFor="composer" className="sr-only">
          {t('chat.placeholder')}
        </label>

        <div className="flex items-end gap-1.5">
          {/* Кнопка «+» с меню прикрепления */}
          <div ref={attachRef} className="relative shrink-0">
            <IconButton
              label={t('composer.attachAria')}
              aria-haspopup="true"
              aria-expanded={isAttachMenuOpen}
              onClick={() => setIsAttachMenuOpen(!isAttachMenuOpen)}
              className={cn(
                'size-11 bg-surface-3/70 text-text hover:bg-surface-3',
                isAttachMenuOpen && 'bg-surface-3',
              )}
            >
              <PlusIcon className="size-[18px]" />
            </IconButton>

            {isAttachMenuOpen ? (
              <div
                className={cn(
                  'absolute left-0 z-[var(--z-dropdown)] w-[min(18rem,calc(100vw-2rem))] animate-scale-in rounded-2xl border border-stroke-strong bg-surface-2 p-1.5 shadow-popover',
                  hero ? 'top-full mt-3 origin-top-left' : 'bottom-full mb-3 origin-bottom-left',
                )}
              >
                <button
                  type="button"
                  onClick={() => {
                    setIsAttachMenuOpen(false);
                    fileInputRef.current?.click();
                  }}
                  className={attachItemClass}
                >
                  <PaperclipIcon className="size-4 shrink-0 text-accent" />
                  <span>{t('composer.attachFiles')}</span>
                </button>

                <div className="my-1 border-t border-stroke" />

                <button
                  type="button"
                  onClick={() => {
                    setIsAttachMenuOpen(false);
                    setWorkspaceTab('folder');
                    setIsWorkspaceModalOpen(true);
                  }}
                  className={attachItemClass}
                >
                  <FolderIcon className="size-4 shrink-0 text-accent" />
                  <span>{t('composer.linkFolder')}</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setIsAttachMenuOpen(false);
                    setWorkspaceTab('git');
                    setIsWorkspaceModalOpen(true);
                  }}
                  className={attachItemClass}
                >
                  <GitHubIcon className="size-4 shrink-0 text-text" />
                  <span>{t('composer.linkGithub')}</span>
                </button>
              </div>
            ) : null}
          </div>

          <textarea
            id="composer"
            ref={fieldRef}
            rows={1}
            value={draft}
            onPaste={handlePaste}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t('chat.placeholder')}
            className="block max-h-[120px] min-h-11 min-w-0 flex-1 resize-none bg-transparent px-2.5 py-[10px] text-base leading-6 text-text outline-none placeholder:text-subtle md:text-[15px]"
          />

          <span className="contents max-sm:hidden">
            <ModelPicker
              variant="chip"
              placement={hero ? 'down' : 'up'}
              disabled={streaming}
              ariaLabel={`${t('chat.modelChip')}: ${labelOf(currentModel)}`}
            />
          </span>

          {streaming ? (
            <button
              type="button"
              aria-label={t('chat.stop')}
              title={t('chat.stop')}
              onClick={() => stop()}
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-surface-3 text-text transition-[background-color] duration-150 hover:bg-surface-3/70"
            >
              <StopIcon />
            </button>
          ) : (
            <button
              type="button"
              aria-label={t('chat.send')}
              title={t('chat.send')}
              onClick={submit}
              disabled={!canSubmit}
              className={cn(
                'inline-flex size-11 shrink-0 items-center justify-center rounded-full',
                'bg-brand-gradient text-accent-text',
                'transition-[background-color,color,transform] duration-200',
                'hover:bg-action-hover active:scale-95',
                'disabled:cursor-not-allowed disabled:bg-surface-3 disabled:text-subtle disabled:shadow-none disabled:active:scale-100',
              )}
            >
              <SendIcon className="size-[18px]" />
            </button>
          )}
        </div>
      </div>

      <p className="mt-3 text-center text-xs leading-[18px] text-subtle">
        <span className="max-md:hidden">{t('composer.hintSend')} · </span>
        {t('chat.composerNotice')}
      </p>

      <LinkWorkspaceModal
        isOpen={isWorkspaceModalOpen}
        initialTab={workspaceTab}
        onClose={() => setIsWorkspaceModalOpen(false)}
      />
    </div>
  );
}
