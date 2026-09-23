import { useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChatEmptyState } from '@/components/chat/chat-empty-state';
import { Composer } from '@/components/chat/composer';
import { MessageList } from '@/components/chat/message-list';
import { AlertIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useChat } from '@/features/chat/chat-store';
import { useTranslation } from '@/i18n';

/**
 * Экран чата.
 *
 * Лента, композер и стриминг ответа. Адрес и активный диалог синхронизируются:
 * новый чат получает `/chat/:id` сразу после первого сообщения.
 */
export function ChatPage() {
  const { t } = useTranslation();
  const { conversationId } = useParams();
  const navigate = useNavigate();
  const activeId = useChat((state) => state.activeId);
  const messages = useChat((state) => state.messages);
  const messagesStatus = useChat((state) => state.messagesStatus);
  const openConversation = useChat((state) => state.openConversation);
  const prevActiveIdRef = useRef<string | null>(activeId);

  useEffect(() => {
    void openConversation(conversationId);
  }, [conversationId, openConversation]);

  useEffect(() => {
    // Переход на /chat/:id нужен только когда пользователь находился на новом чате (/chat)
    // и отправил первое сообщение (activeId сменился с null на созданный id диалога).
    if (conversationId === undefined && prevActiveIdRef.current === null && activeId !== null) {
      navigate(`/chat/${activeId}`, { replace: true });
    }
    prevActiveIdRef.current = activeId;
  }, [activeId, conversationId, navigate]);

  return (
    <div className="flex h-full flex-col">
      {messagesStatus === 'loading' ? <MessagesSkeleton /> : null}

      {messagesStatus === 'error' ? (
        <div className="flex min-h-0 flex-1 items-center justify-center px-4">
          <div className="max-w-md rounded-2xl border border-red-200 bg-red-50 p-4 text-center dark:border-red-900/60 dark:bg-red-950/40">
            <p className="flex items-center justify-center gap-2 font-medium text-red-700 dark:text-red-300">
              <AlertIcon />
              {t('chat.loadError')}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              disabled={activeId === null}
              onClick={() => void openConversation(activeId ?? undefined, true)}
            >
              {t('common.retry')}
            </Button>
          </div>
        </div>
      ) : null}

      {messagesStatus !== 'loading' && messagesStatus !== 'error' ? (
        messages.length === 0 ? (
          <ChatEmptyState />
        ) : (
          <MessageList />
        )
      ) : null}

      <Composer />
    </div>
  );
}

/** Скелет ленты, пока диалог грузится: список в сайдбаре уже виден. */
function MessagesSkeleton() {
  return (
    <div className="min-h-0 flex-1 overflow-hidden px-4 py-6">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <Skeleton className="h-16 w-2/3 self-end rounded-2xl" />
        <Skeleton className="h-24 w-full rounded-2xl" />
        <Skeleton className="h-10 w-1/2 self-end rounded-2xl" />
      </div>
    </div>
  );
}
