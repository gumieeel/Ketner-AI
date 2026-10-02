import { useState } from 'react';
import { EditIcon, FolderIcon, GitHubIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { useChat } from '@/features/chat/chat-store';
import type { Message } from '@/features/chat/types';
import { useTranslation } from '@/i18n';
import { MessageAttachments } from './message-attachments';

interface UserMessageProps {
  message: Message;
  /** Правка доступна только у последнего сообщения и пока нет генерации. */
  editable: boolean;
}

/** Сообщение пользователя: реплика справа, вложения и правка по месту. */
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
          className="w-full max-w-[92%] resize-none rounded-lg border border-accent bg-surface px-4 py-2.5 text-[15px] leading-[26px] text-text outline-none focus:ring-3 focus:ring-accent-soft"
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
    <div className="group flex flex-col items-end gap-1.5">
      {message.workspaceContext ? (
        <div className="flex items-center gap-1.5 rounded-full border border-stroke bg-surface px-2.5 py-0.5 text-[11px] text-muted shadow-sm">
          {message.workspaceContext.type === 'git_repo' ? (
            <GitHubIcon className="size-3 text-accent" />
          ) : (
            <FolderIcon className="size-3 text-accent" />
          )}
          <span className="font-medium text-text">{message.workspaceContext.name}</span>
          <span>({message.workspaceContext.filesCount ?? 0} файлов)</span>
        </div>
      ) : null}

      {message.attachments && message.attachments.length > 0 ? (
        <div className="max-w-[92%]">
          <MessageAttachments attachments={message.attachments} />
        </div>
      ) : null}

      {message.content ? (
        <div className="max-w-[92%] rounded-lg bg-surface-2 px-4 py-2.5 text-[15px] leading-[26px] whitespace-pre-wrap text-text">
          {message.content}
        </div>
      ) : null}

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
