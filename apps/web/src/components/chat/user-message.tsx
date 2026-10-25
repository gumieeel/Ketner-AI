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
          className="w-full max-w-[92%] resize-none rounded-2xl border border-accent bg-surface px-4 py-3 text-base leading-[26px] text-text outline-none ring-4 ring-accent-soft md:text-[15px]"
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
        <div className="flex max-w-full items-center gap-1.5 rounded-full border border-stroke bg-surface px-2.5 py-1 text-xs text-muted shadow-xs">
          {message.workspaceContext.type === 'git_repo' ? (
            <GitHubIcon className="size-3 text-accent" />
          ) : (
            <FolderIcon className="size-3 text-accent" />
          )}
          <span className="truncate font-medium text-text">{message.workspaceContext.name}</span>
          <span className="shrink-0">
            {t('workspace.filesCount', { count: message.workspaceContext.filesCount ?? 0 })}
          </span>
        </div>
      ) : null}

      {message.attachments && message.attachments.length > 0 ? (
        <div className="max-w-[92%]">
          <MessageAttachments attachments={message.attachments} />
        </div>
      ) : null}

      {message.content ? (
        <div className="max-w-[92%] rounded-2xl rounded-br-md border border-stroke bg-surface-2 px-4 py-2.5 text-[15px] leading-[26px] break-words whitespace-pre-wrap text-text shadow-xs">
          {message.content}
        </div>
      ) : null}

      {editable && !streaming ? (
        <IconButton
          label={t('chat.edit')}
          size="sm"
          onClick={startEditing}
          className="transition-opacity focus-visible:opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"
        >
          <EditIcon />
        </IconButton>
      ) : null}
    </div>
  );
}
