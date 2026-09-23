import { useEffect, useRef, useState } from 'react';
import { ChevronDownIcon } from '@/components/icons';
import { useChat } from '@/features/chat/chat-store';
import type { Message } from '@/features/chat/types';
import { useTranslation } from '@/i18n';
import { AssistantMessage } from './assistant-message';
import { UserMessage } from './user-message';

/** Ниже этого расстояния до низа лента считается «приклеенной» к последней реплике. */
const NEAR_BOTTOM_PX = 80;

function lastIndexOfRole(messages: readonly Message[], role: Message['role']): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === role) {
      return index;
    }
  }
  return -1;
}

/** Лента сообщений с автоскроллом и кнопкой возврата к последней реплике. */
export function MessageList() {
  const { t } = useTranslation();
  const messages = useChat((state) => state.messages);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [pinned, setPinned] = useState(true);

  const scrollToBottom = (behavior: ScrollBehavior = 'auto'): void => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    if (typeof container.scrollTo === 'function') {
      container.scrollTo({ top: container.scrollHeight, behavior });
    } else {
      container.scrollTop = container.scrollHeight;
    }
  };

  const onScroll = (): void => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const distance = container.scrollHeight - container.scrollTop - container.clientHeight;
    setPinned(distance <= NEAR_BOTTOM_PX);
  };

  // Лента подтягивается вниз на каждой порции ответа, но только если пользователь
  // и так внизу: иначе чтение истории постоянно срывалось бы.
  useEffect(() => {
    if (pinned) {
      scrollToBottom();
    }
  }, [messages, pinned]);

  const lastUser = lastIndexOfRole(messages, 'user');
  const lastAssistant = lastIndexOfRole(messages, 'assistant');

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={containerRef} onScroll={onScroll} className="h-full overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[760px] flex-col gap-6 md:gap-8 px-4 py-6">
          {messages.map((message, index) =>
            message.role === 'user' ? (
              <UserMessage key={message.id} message={message} editable={index === lastUser} />
            ) : (
              <AssistantMessage
                key={message.id}
                message={message}
                canRegenerate={index === lastAssistant}
              />
            ),
          )}
        </div>
      </div>

      {!pinned && messages.length > 0 ? (
        <button
          type="button"
          onClick={() => scrollToBottom('smooth')}
          className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-[10px] border border-stroke/30 bg-surface px-3 py-1.5 text-xs text-text shadow-md transition-colors hover:bg-canvas"
        >
          <ChevronDownIcon />
          {t('chat.jumpToLatest')}
        </button>
      ) : null}
    </div>
  );
}
