import { Suspense, lazy } from 'react';
import { Link } from 'react-router-dom';
import { AlertIcon, RefreshIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/ui/copy-button';
import { CornerMark } from '@/components/ui/corner-mark';
import { IconButton } from '@/components/ui/icon-button';
import { useChat } from '@/features/chat/chat-store';
import type { Message } from '@/features/chat/types';
import { useTranslation } from '@/i18n';
import { cn } from '@/lib/cn';

/** Тяжёлый рендер markdown подключается при первом ответе, а не при загрузке чата. */
const Markdown = lazy(() => import('@/features/chat/markdown/markdown'));

interface AssistantMessageProps {
  message: Message;
  /** Повторная генерация доступна только у последнего ответа. */
  canRegenerate: boolean;
}

/** Ответ ассистента: открытая лента без пузыря, ограничение строки 66ch, импульс маркера в начале. */
export function AssistantMessage({ message, canRegenerate }: AssistantMessageProps) {
  const { t } = useTranslation();
  const regenerate = useChat((state) => state.regenerate);
  const streaming = useChat((state) => state.streaming);

  const thinking = message.status === 'pending';
  const failed = message.status === 'error';
  const hasContent = message.content !== '';
  const isUpgradeError =
    message.errorCode === 'upgrade_required' ||
    (typeof message.error === 'string' &&
      (message.error.toLowerCase().includes('upgrade') ||
        message.error.toLowerCase().includes('подписк')));

  return (
    <article className="flex gap-3" aria-label={t('chat.assistant')}>
      <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-[6px] bg-accent/15 p-1 text-accent">
        <img src="/logo-mark.png" alt="Ketner AI" className="size-5 object-contain" />
      </span>

      <div className="min-w-0 flex-1">
        {thinking ? (
          <p className="flex items-center gap-2 text-sm leading-5 text-muted" role="status">
            <CornerMark size={14} className="text-accent reply-marker-pulse" />
            {t('chat.thinking')}
          </p>
        ) : null}

        {hasContent ? (
          <div className="text-base leading-[27px] text-text [&>*:not(pre):not(table):not(.code-block)]:max-w-[66ch]">
            <Suspense
              fallback={
                <p className="text-base leading-[27px] whitespace-pre-wrap max-w-[66ch]">
                  {message.content}
                </p>
              }
            >
              <Markdown content={message.content} />
            </Suspense>
          </div>
        ) : null}
        {message.status === 'streaming' ? (
          <span className="caret text-accent ml-1" aria-hidden="true" />
        ) : null}

        {failed ? (
          <div
            className={cn(
              'mt-2 rounded-[12px] p-3.5 text-sm leading-5 transition-all',
              isUpgradeError
                ? 'border border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                : 'border border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400',
            )}
          >
            <p className="flex items-center gap-2 font-medium">
              {isUpgradeError ? (
                <span className="text-base select-none" aria-hidden="true">
                  ⭐
                </span>
              ) : (
                <AlertIcon />
              )}
              {isUpgradeError ? t('chat.upgradeRequired') : t('chat.errorTitle')}
            </p>
            <p className="mt-1 text-text/85">{message.error ?? t('chat.errorText')}</p>
            {isUpgradeError ? (
              <div className="mt-3">
                <Link
                  to="/pricing"
                  className="inline-flex items-center gap-1.5 rounded-[6px] bg-accent px-3 py-1.5 text-xs font-semibold text-[var(--color-accent-text)] transition hover:opacity-90 shadow-sm"
                >
                  ⭐ {t('chat.upgradeButton')}
                </Link>
              </div>
            ) : canRegenerate ? (
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
          <div className="mt-2 flex items-center gap-1 text-muted">
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
