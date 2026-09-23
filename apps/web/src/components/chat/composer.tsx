import { useEffect, useRef, type KeyboardEvent } from 'react';
import { PaperclipIcon, SendIcon, StopIcon } from '@/components/icons';
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
    <div className="mx-auto w-full max-w-3xl shrink-0 px-4 pb-6">
      <div className="rounded-2xl border border-zinc-300 bg-white p-2 shadow-sm focus-within:border-brand-500 dark:border-zinc-600 dark:bg-zinc-800">
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
          className="max-h-52 w-full resize-none bg-transparent px-2 py-2 text-sm outline-none placeholder:text-zinc-400 dark:placeholder:text-zinc-500"
        />
        <div className="flex items-center gap-1">
          <StubAction label={t('chat.attach')} hint={t('chat.attachHint')} size="sm">
            <PaperclipIcon />
          </StubAction>
          <ModelPicker disabled={streaming} />
          {streaming ? (
            <IconButton
              label={t('chat.stop')}
              onClick={() => stop()}
              className="ml-auto bg-zinc-800 text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              <StopIcon />
            </IconButton>
          ) : (
            <IconButton
              label={t('chat.send')}
              onClick={submit}
              disabled={draft.trim() === ''}
              className="ml-auto bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50"
            >
              <SendIcon />
            </IconButton>
          )}
        </div>
      </div>
      <p className="mt-2 text-center text-xs text-zinc-500 dark:text-zinc-400">
        {t('chat.composerNotice')}
      </p>
    </div>
  );
}
