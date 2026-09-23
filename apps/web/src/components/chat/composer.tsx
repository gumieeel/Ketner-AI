import { useEffect, useRef, type KeyboardEvent } from 'react';
import { PaperclipIcon, SendIcon, StopIcon } from '@/components/icons';
import { CornerMark } from '@/components/ui/corner-mark';
import { IconButton } from '@/components/ui/icon-button';
import { StubAction } from '@/components/ui/stub-action';
import { useChat } from '@/features/chat/chat-store';
import { useTranslation } from '@/i18n';
import { ModelPicker } from './model-picker';

/** Высота поля ввода, после которой появляется прокрутка. */
const MAX_HEIGHT_PX = 200;

/** Поле ввода сообщения: отправка, остановка генерации и переключатель модели. */
export function Composer() {
  const { t } = useTranslation();
  const draft = useChat((state) => state.draft);
  const setDraft = useChat((state) => state.setDraft);
  const send = useChat((state) => state.send);
  const stop = useChat((state) => state.stop);
  const streaming = useChat((state) => state.streaming);
  const fieldRef = useRef<HTMLTextAreaElement | null>(null);

  // Поле растёт под текст до предела, дальше включается прокрутка.
  useEffect(() => {
    const field = fieldRef.current;
    if (!field) {
      return;
    }
    field.style.height = 'auto';
    field.style.height = `${Math.min(field.scrollHeight, MAX_HEIGHT_PX)}px`;
  }, [draft]);

  const submit = (): void => {
    if (streaming || draft.trim() === '') {
      return;
    }
    void send(draft);
  };

  // Enter отправляет, Shift+Enter переносит строку — как в ChatGPT.
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <div className="mx-auto w-full max-w-[760px] shrink-0 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] md:pb-6">
      <div className="relative rounded-[16px] border border-stroke/40 bg-surface p-2.5 transition-colors focus-within:border-accent">
        <CornerMark
          size={13}
          className="pointer-events-none absolute top-2.5 left-2.5 text-accent opacity-90"
        />
        <label htmlFor="composer" className="sr-only">
          {t('chat.placeholder')}
        </label>
        <textarea
          id="composer"
          ref={fieldRef}
          rows={1}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t('chat.placeholder')}
          className="max-h-52 w-full resize-none bg-transparent pr-2 pl-6 pt-0.5 text-sm leading-5 text-text outline-none placeholder:text-muted"
        />
        <div className="flex items-center gap-1.5 pt-1">
          <StubAction label={t('chat.attach')} hint={t('chat.attachHint')} size="sm">
            <PaperclipIcon />
          </StubAction>
          <ModelPicker disabled={streaming} />
          {streaming ? (
            <IconButton
              label={t('chat.stop')}
              onClick={() => stop()}
              size="sm"
              className="ml-auto border border-stroke/30 bg-surface text-text hover:bg-canvas"
            >
              <StopIcon />
            </IconButton>
          ) : (
            <button
              type="button"
              aria-label={t('chat.send')}
              title={t('chat.send')}
              onClick={submit}
              disabled={draft.trim() === ''}
              className="ml-auto inline-flex size-8 shrink-0 items-center justify-center rounded-[6px] bg-accent text-[var(--color-accent-text)] transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <SendIcon />
            </button>
          )}
        </div>
      </div>
      <p className="mt-2 text-center text-xs leading-[18px] text-muted">
        {t('chat.composerNotice')}
      </p>
    </div>
  );
}
