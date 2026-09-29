import { useState } from 'react';
import { EditIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { useChat } from '@/features/chat/chat-store';
import type { Message } from '@/features/chat/types';
import { useTranslation } from '@/i18n';

interface UserMessageProps {
  message: Message;
  /** Правка доступна только у последнего сообщения и пока нет генерации. */
  editable: boolean;
}

/** Сообщение пользователя: реплика справа и правка по месту. */
export function UserMessage({ message, editable }: UserMessageProps) {
  const { t } = useTranslation();
  const editMessage = useChat((state) => state.editMessage);
  const streaming = useChat((state) => state.streaming);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(message.content);

  const startEditing = (): void => {
    setValue(message.content);
    setEditing(true);
  };

  const submit = (): void => {
    const next = value.trim();
    setEditing(false);
    if (next === '' || next === message.content) {
      return;
    }
    void editMessage(message.id, next);
  };

  if (editing) {
    return (
      <div className="flex flex-col items-end gap-2">
        <label htmlFor={`edit-${message.id}`} className="sr-only">
          {t('chat.edit')}
        </label>
        <textarea
          id={`edit-${message.id}`}
          autoFocus
          rows={3}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setEditing(false);
            }
          }}
          className="w-full max-w-[85%] resize-none rounded-lg border border-accent bg-surface px-4 py-2.5 text-[15px] leading-[26px] text-text outline-none focus:ring-3 focus:ring-accent-soft"
        />
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
            {t('chat.editCancel')}
          </Button>
          <Button size="sm" onClick={submit}>
            {t('chat.editSend')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="group flex flex-col items-end gap-1">
      <div className="max-w-[85%] rounded-lg bg-surface-2 px-4 py-2.5 text-[15px] leading-[26px] whitespace-pre-wrap text-text">
        {message.content}
      </div>
      {editable && !streaming ? (
        <IconButton
          label={t('chat.edit')}
          size="sm"
          onClick={startEditing}
          className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
        >
          <EditIcon />
        </IconButton>
      ) : null}
    </div>
  );
}
