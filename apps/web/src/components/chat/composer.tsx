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
import { CornerMark } from '@/components/ui/corner-mark';
import { IconButton } from '@/components/ui/icon-button';
import { useAuth } from '@/features/auth/auth-store';
import { isFreeLimitReached } from '@/features/billing/free-usage';
import { useUpgradeModal } from '@/features/billing/upgrade-modal-store';
import { readFileAsAttachment } from '@/features/chat/attachment-utils';
import { canAccessModel, findModel, getRequiredPlanName } from '@/features/chat/can-access-model';
import { useChat } from '@/features/chat/chat-store';
import type { ModelInfo } from '@/features/chat/types';
import { usePreferences } from '@/features/preferences/preferences-store';
import { useTranslation } from '@/i18n';
import type { TranslationKey } from '@/i18n';
import { ComposerAttachments } from './composer-attachments';
import { LinkWorkspaceModal } from './link-workspace-modal';
import { ModelPicker } from './model-picker';
import { WorkspaceBar } from './workspace-bar';

const MODEL_NAME_KEYS: Record<string, TranslationKey> = {
  'ketner-mini': 'chat.modelMini',
  'gpt-6-astra': 'chat.modelGptAstra',
  'claude-fable': 'chat.modelClaudeFable',
  'gemini-pro': 'chat.modelGeminiPro',
  'ketner-pro': 'chat.modelPro',
};

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
  const isFree = !user || !user.plan || user.plan === 'free';
  const freeLimitReached = isFree && isFreeLimitReached(user?.id);

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

  return (
    <div className="mx-auto w-full max-w-[760px] shrink-0 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] md:pb-6">
      {freeLimitReached ? (
        <div
          role="alert"
          className="mb-2.5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/30 bg-warning-soft px-3.5 py-2.5 text-xs text-warning shadow-sm"
        >
          <div className="flex items-center gap-2">
            <AlertIcon className="size-4 shrink-0 text-warning" aria-hidden="true" />
            <span className="font-medium">
              {t('chat.freeLimitDesc')}
            </span>
          </div>
          <Link
            to="/pricing"
            onClick={handleFreeLimitAttempt}
            className="inline-flex items-center gap-1 shrink-0 rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-accent-text transition hover:opacity-90 shadow-sm"
          >
            {t('chat.upgradeButton')} →
          </Link>
        </div>
      ) : !hasAccess ? (
        <div
          role="alert"
          className="mb-2.5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/30 bg-warning-soft px-3.5 py-2.5 text-xs text-warning shadow-sm"
        >
          <div className="flex items-center gap-2">
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
            className="inline-flex items-center gap-1 shrink-0 rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-accent-text transition hover:opacity-90 shadow-sm"
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
        className={`relative rounded-lg border bg-surface p-2.5 transition-colors focus-within:border-accent focus-within:ring-3 focus-within:ring-accent-soft ${
          isDragOver
            ? 'border-accent ring-2 ring-accent-soft bg-surface-2'
            : 'border-stroke'
        }`}
      >
        <CornerMark
          size={12}
          className="pointer-events-none absolute top-2.5 left-2.5 text-accent opacity-90"
        />

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
          className="max-h-[120px] w-full resize-none bg-transparent pr-2 pl-6 pt-0.5 text-sm leading-5 text-text outline-none placeholder:text-muted"
        />

        <div className="flex items-center gap-1.5 pt-1">
          {/* Кнопка скрепки с меню прикрепления */}
          <div className="relative">
            <IconButton
              label="Прикрепить фото, видео, файлы или папку"
              size="sm"
              onClick={() => setIsAttachMenuOpen(!isAttachMenuOpen)}
              className="border border-stroke bg-surface hover:bg-surface-2 text-text"
            >
              <PaperclipIcon />
            </IconButton>

            {isAttachMenuOpen ? (
              <div
                className="absolute bottom-full left-0 mb-2 w-64 rounded-xl border border-stroke bg-canvas p-1.5 shadow-xl backdrop-blur-md z-40 animate-in fade-in slide-in-from-bottom-2 duration-150"
              >
                <button
                  type="button"
                  onClick={() => {
                    setIsAttachMenuOpen(false);
                    fileInputRef.current?.click();
                  }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-medium text-text transition hover:bg-surface"
                >
                  <PaperclipIcon className="size-4 text-accent" />
                  <span>Фото, видео или любые файлы</span>
                </button>

                <div className="my-1 border-t border-stroke" />

                <button
                  type="button"
                  onClick={() => {
                    setIsAttachMenuOpen(false);
                    setIsWorkspaceModalOpen(true);
                  }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-medium text-text transition hover:bg-surface"
                >
                  <FolderIcon className="size-4 text-accent" />
                  <span>Привязать локальную папку</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setIsAttachMenuOpen(false);
                    setIsWorkspaceModalOpen(true);
                  }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-medium text-text transition hover:bg-surface"
                >
                  <GitHubIcon className="size-4 text-text" />
                  <span>Привязать GitHub репозиторий</span>
                </button>
              </div>
            ) : null}
          </div>

          <ModelPicker disabled={streaming} />

          {streaming ? (
            <IconButton
              label={t('chat.stop')}
              onClick={() => stop()}
              size="sm"
              className="ml-auto border border-stroke bg-surface text-text hover:bg-surface-2"
            >
              <StopIcon />
            </IconButton>
          ) : (
            <button
              type="button"
              aria-label={t('chat.send')}
              title={t('chat.send')}
              onClick={submit}
              disabled={!canSubmit}
              className="ml-auto inline-flex size-[44px] shrink-0 items-center justify-center rounded-md bg-accent text-accent-text transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
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

