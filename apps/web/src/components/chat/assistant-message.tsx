import { Suspense, lazy } from 'react';
import { AlertIcon, RefreshIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/ui/copy-button';
import { IconButton } from '@/components/ui/icon-button';
import { useChat } from '@/features/chat/chat-store';
import type { Message } from '@/features/chat/types';
import { useTranslation } from '@/i18n';

/** Тяжёлый рендер markdown подключается при первом ответе, а не при загрузке чата. */
const Markdown = lazy(() => import('@/features/chat/markdown/markdown'));

interface AssistantMessageProps {
  message: Message;
  /** Повторная генерация доступна только у последнего ответа. */
  canRegenerate: boolean;
}

/** Ответ ассистента: markdown, состояние «думает», ошибка и действия. */
export function AssistantMessage({ message, canRegenerate }: AssistantMessageProps) {
  const { t } = useTranslation();
  const regenerate = useChat((state) => state.regenerate);
  const streaming = useChat((state) => state.streaming);

  const thinking = message.status === 'pending';
  const failed = message.status === 'error';
  const hasContent = message.content !== '';

  return (
    <article className="flex gap-3" aria-label={t('chat.assistant')}>
      <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-brand-500/10 p-1 text-brand-600 dark:bg-brand-500/20 dark:text-brand-300">
        <img src="/logo-mark.png" alt="Ketner AI" className="size-5 object-contain" />
      </span>

      <div className="min-w-0 flex-1">
        {thinking ? (
          <p
            className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400"
            role="status"
          >
            <ThinkingDots />
            {t('chat.thinking')}
          </p>
        ) : null}

        {hasContent ? (
          <Suspense fallback={<p className="text-sm whitespace-pre-wrap">{message.content}</p>}>
            <Markdown content={message.content} />
          </Suspense>
        ) : null}
        {message.status === 'streaming' ? <span className="caret" aria-hidden="true" /> : null}

        {failed ? (
          <div className="mt-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm dark:border-red-900/60 dark:bg-red-950/40">
            <p className="flex items-center gap-2 font-medium text-red-700 dark:text-red-300">
              <AlertIcon />
              {t('chat.errorTitle')}
            </p>
            <p className="mt-1 text-red-700 dark:text-red-300">
              {message.error ?? t('chat.errorText')}
            </p>
            {canRegenerate ? (
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                disabled={streaming}
                onClick={() => void regenerate()}
              >
                <RefreshIcon />
                {t('common.retry')}
              </Button>
            ) : null}
          </div>
        ) : null}

        {hasContent && !thinking && !failed ? (
          <div className="mt-1 flex items-center gap-1">
            <CopyButton value={message.content} label={t('chat.copy')} size="sm" />
            {canRegenerate ? (
              <IconButton
                label={t('chat.regenerate')}
                size="sm"
                disabled={streaming}
                onClick={() => void regenerate()}
              >
                <RefreshIcon />
              </IconButton>
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}

/** Три точки вместо индикатора «думает…»: как в чатах, которые ждут модель. */
function ThinkingDots() {
  return (
    <span className="flex items-center gap-1" aria-hidden="true">
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className="size-1.5 animate-bounce rounded-full bg-current"
          style={{ animationDelay: `${index * 120}ms` }}
        />
      ))}
    </span>
  );
}
