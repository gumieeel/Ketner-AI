import { useEffect, useRef } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ChatEmptyState } from '@/components/chat/chat-empty-state';
import { Composer } from '@/components/chat/composer';
import { MessageList } from '@/components/chat/message-list';
import { CreditsLine } from '@/components/chat/credits-line';
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
  const setDraft = useChat((state) => state.setDraft);
  const location = useLocation();
  // Переход из отчёта анализа или плана: текст вопроса подставляется в новый чат, отправляет его
  // сам пользователь.
  const prompt = (location.state as { prompt?: unknown } | null)?.prompt;
  const prevActiveIdRef = useRef<string | null>(activeId);

  useEffect(() => {
    void openConversation(conversationId).then(() => {
      if (conversationId === undefined && typeof prompt === 'string' && prompt.trim()) {
        setDraft(prompt);
        // Вопрос подставляется один раз: после перезагрузки или «назад» поле не заполняется снова.
        navigate('/chat', { replace: true, state: null });
      }
    });
    // Подстановка — только при открытии экрана, а не при каждом изменении состояния адреса.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, openConversation]);

  useEffect(() => {
    // Переход на /chat/:id нужен только когда пользователь находился на новом чате (/chat)
    // и отправил первое сообщение (activeId сменился с null на созданный id диалога).
    if (conversationId === undefined && prevActiveIdRef.current === null && activeId !== null) {
      navigate(`/chat/${activeId}`, { replace: true });
    }
    prevActiveIdRef.current = activeId;
  }, [activeId, conversationId, navigate]);

  const showEmptyState =
    messagesStatus !== 'loading' && messagesStatus !== 'error' && messages.length === 0;

  return (
    <div className="flex h-full flex-col">
      <CreditsLine />
      {messagesStatus === 'loading' ? <MessagesSkeleton /> : null}

      {messagesStatus === 'error' ? (
        <div className="flex min-h-0 flex-1 items-center justify-center px-4">
          <div
            role="alert"
            className="max-w-md rounded-2xl border border-danger/30 bg-danger-soft p-5 text-center"
          >
            <p className="flex items-center justify-center gap-2 font-medium text-danger">
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

      {showEmptyState ? null : <Composer />}
    </div>
  );
}

/** Скелет ленты, пока диалог грузится: список в сайдбаре уже виден. */
function MessagesSkeleton() {
  return (
    <div className="min-h-0 flex-1 overflow-hidden px-4 py-6">
      <div className="mx-auto flex w-full max-w-[760px] flex-col gap-6 md:gap-8">
        <Skeleton className="h-14 w-2/3 self-end rounded-2xl rounded-br-md" />
        <div className="flex gap-3">
          <Skeleton className="size-8 shrink-0 rounded-[10px]" />
          <div className="flex flex-1 flex-col gap-2.5 pt-1">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-[92%]" />
            <Skeleton className="h-4 w-[70%]" />
          </div>
        </div>
        <Skeleton className="h-10 w-1/2 self-end rounded-2xl rounded-br-md" />
      </div>
    </div>
  );
}
