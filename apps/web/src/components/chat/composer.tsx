import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertIcon,
  FolderIcon,
  GitHubIcon,
  PaperclipIcon,
  SendIcon,
  SparkleIcon,
  StopIcon,
} from '@/components/icons';
import { buttonClasses } from '@/components/ui/button-classes';
import { IconButton } from '@/components/ui/icon-button';
import { useAuth } from '@/features/auth/auth-store';
import { isFreeLimitReached } from '@/features/billing/free-usage';
import { useUpgradeModal } from '@/features/billing/upgrade-modal-store';
import { readFileAsAttachment } from '@/features/chat/attachment-utils';
import {
  MODEL_NAME_KEYS,
  canAccessModel,
  findModel,
  getRequiredPlanName,
} from '@/features/chat/can-access-model';
import { useChat } from '@/features/chat/chat-store';
import type { ModelInfo } from '@/features/chat/types';
import { usePreferences } from '@/features/preferences/preferences-store';
import { useTranslation } from '@/i18n';
import { cn } from '@/lib/cn';
import { ComposerAttachments } from './composer-attachments';
import { LinkWorkspaceModal } from './link-workspace-modal';
import { WorkspaceBar } from './workspace-bar';

const attachItemClass =
  'flex min-h-11 w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium text-text transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 md:min-h-10';

/** Высота поля ввода (до 5 строк), после которой появляется прокрутка. */
const MAX_HEIGHT_PX = 120;

/** Поле ввода сообщения: отправка, вложения фото/видео/файлов, привязка папки/репо и переключатель модели. */
export function Composer() {
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
  const user = useAuth((state) => state.user);

  const fieldRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [isDragOver, setIsDragOver] = useState(false);
  const [isAttachMenuOpen, setIsAttachMenuOpen] = useState(false);
  const [isWorkspaceModalOpen, setIsWorkspaceModalOpen] = useState(false);

  const currentModel = findModel(meta?.models, selectedModelId);
  const hasAccess = canAccessModel(user?.plan, currentModel);
  const isFreeAccount = Boolean(user && (!user.plan || user.plan === 'free'));
  const freeLimitReached = Boolean(isFreeAccount && user && isFreeLimitReached(user.id));

  const labelOf = (model: ModelInfo): string => {
    const key = MODEL_NAME_KEYS[model.id];
    return key ? t(key) : model.name;
  };

  const handlePaidModelAttempt = () => {
    useUpgradeModal.getState().open({
      reason: 'paid_model',
      modelName: labelOf(currentModel),
      requiredPlan: getRequiredPlanName(currentModel),
    });
  };

  const handleFreeLimitAttempt = () => {
    useUpgradeModal.getState().open({
      reason: 'free_limit',
    });
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
    if (freeLimitReached) {
      handleFreeLimitAttempt();
      return;
    }
    if (!hasAccess) {
      handlePaidModelAttempt();
    }
    if (draft.trim() === '' && attachedFiles.length === 0) {
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

  const onFieldClick = (): void => {
    if (freeLimitReached) {
      handleFreeLimitAttempt();
    }
  };

  const canSubmit = draft.trim() !== '' || attachedFiles.length > 0;

  const bannerClass =
    'mb-2.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-xl border border-warning/30 bg-warning-soft px-3.5 py-2.5 text-[13px] text-text shadow-sm';

  return (
    <div className="relative mx-auto w-full max-w-[792px] shrink-0 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:px-4 md:pb-5">
      {/* Плавное «растворение» ленты под композером */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 -top-6 h-6 bg-gradient-to-t from-canvas to-transparent"
      />

      {freeLimitReached ? (
        <div role="alert" className={bannerClass}>
          <div className="flex min-w-0 items-center gap-2">
            <AlertIcon className="size-4 shrink-0 text-warning" aria-hidden="true" />
            <span className="font-medium">{t('chat.freeLimitDesc')}</span>
          </div>
          <Link
            to="/pricing"
            onClick={handleFreeLimitAttempt}
            className={buttonClasses({ variant: 'primary', size: 'sm' })}
          >
            {t('chat.upgradeButton')} →
          </Link>
        </div>
      ) : !hasAccess ? (
        <div role="alert" className={bannerClass}>
          <div className="flex min-w-0 items-center gap-2">
            <SparkleIcon className="size-4 shrink-0 text-warning" aria-hidden="true" />
            <span className="font-medium">
              {t('chat.upgradeBanner', {
                model: labelOf(currentModel),
                plan: getRequiredPlanName(currentModel),
              })}
            </span>
          </div>
          <Link
            to="/pricing"
            onClick={handlePaidModelAttempt}
            className={buttonClasses({ variant: 'primary', size: 'sm' })}
          >
            {t('chat.upgradeButton')} →
          </Link>
        </div>
      ) : null}

      {/* Полоса привязанной рабочей папки / репозитория */}
      <div className="mb-1.5">
        <WorkspaceBar />
      </div>

      {/* Скрытый input для выбора файлов */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleFileInputChange}
      />

      <div
        onClick={onFieldClick}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          'relative rounded-xl border bg-surface p-2.5 shadow-md',
          'transition-[border-color,box-shadow] duration-200',
          'focus-within:border-accent/60 focus-within:ring-2 focus-within:ring-accent-soft',
          isDragOver ? 'border-accent ring-2 ring-accent-soft' : 'border-stroke-strong',
        )}
      >
        {isDragOver ? (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-xl bg-canvas/85 text-sm font-medium text-accent"
          >
            <span className="inline-flex items-center gap-2">
              <PaperclipIcon className="size-4" />
              {t('composer.dropHint')}
            </span>
          </div>
        ) : null}

        {/* Превью прикреплённых файлов */}
        <ComposerAttachments
          attachments={attachedFiles}
          onRemove={removeAttachment}
        />

        <label htmlFor="composer" className="sr-only">
          {t('chat.placeholder')}
        </label>
        <textarea
          id="composer"
          ref={fieldRef}
          rows={1}
          value={draft}
          onClick={onFieldClick}
          onFocus={onFieldClick}
          onPaste={handlePaste}
          onChange={(event) => {
            if (freeLimitReached) {
              handleFreeLimitAttempt();
              return;
            }
            setDraft(event.target.value);
          }}
          onKeyDown={onKeyDown}
          placeholder={t('chat.placeholder')}
          className="block max-h-[120px] w-full resize-none bg-transparent px-1.5 py-1 text-base leading-6 max-md:-my-1.5 max-md:py-2.5 text-text outline-none placeholder:text-subtle md:text-[15px]"
        />

        <div className="flex items-center gap-1.5 pt-1.5">
          {/* Кнопка скрепки с меню прикрепления */}
          <div ref={attachRef} className="relative">
            <IconButton
              label={t('composer.attachAria')}
              size="sm"
              aria-haspopup="true"
              aria-expanded={isAttachMenuOpen}
              onClick={() => setIsAttachMenuOpen(!isAttachMenuOpen)}
              className={cn(
                'rounded-md border border-stroke text-text hover:border-stroke-strong hover:bg-surface-2',
                isAttachMenuOpen && 'border-stroke-strong bg-surface-2',
              )}
            >
              <PaperclipIcon />
            </IconButton>

            {isAttachMenuOpen ? (
              <div className="absolute bottom-full left-0 z-[var(--z-dropdown)] mb-2 w-[min(18rem,calc(100vw-2rem))] origin-bottom-left animate-scale-in rounded-lg border border-stroke-strong bg-surface-2 p-1.5 shadow-popover">
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

          <p className="ml-1 hidden min-w-0 truncate text-xs text-subtle md:block">{t('composer.hintSend')}</p>

          {streaming ? (
            <button
              type="button"
              aria-label={t('chat.stop')}
              title={t('chat.stop')}
              onClick={() => stop()}
              className="ml-auto inline-flex size-11 shrink-0 items-center justify-center rounded-md border border-stroke-strong bg-surface-2 text-text transition-[background-color] duration-150 hover:bg-surface-3"
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
                'ml-auto inline-flex size-11 shrink-0 items-center justify-center rounded-md',
                'bg-brand-gradient text-accent-text',
                'transition-[background-color,color] duration-150',
                'hover:bg-action-hover',
                'disabled:cursor-not-allowed disabled:bg-surface-3 disabled:text-subtle disabled:shadow-none',
              )}
            >
              <SendIcon />
            </button>
          )}
        </div>
      </div>

      <p className="mt-2 text-center text-xs leading-[18px] text-subtle">
        {t('chat.composerNotice')}
      </p>

      <LinkWorkspaceModal
        isOpen={isWorkspaceModalOpen}
        onClose={() => setIsWorkspaceModalOpen(false)}
      />
    </div>
  );
}

