import { Suspense, lazy } from 'react';
import { Link } from 'react-router-dom';
import { AlertIcon, RefreshIcon, SparkleIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/ui/copy-button';
import { CornerMark } from '@/components/ui/corner-mark';
import { IconButton } from '@/components/ui/icon-button';
import { findModel } from '@/features/chat/can-access-model';
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
  const meta = useChat((state) => state.meta);

  const thinking = message.status === 'pending';
  const failed = message.status === 'error';
  const hasContent = message.content !== '';
  const isUpgradeError =
    message.errorCode === 'upgrade_required' ||
    (typeof message.error === 'string' &&
      (message.error.toLowerCase().includes('upgrade') ||
        message.error.toLowerCase().includes('подписк')));

  const foundModel = message.modelId ? findModel(meta?.models, message.modelId) : null;
  const modelName =
    message.modelId && foundModel?.id === message.modelId
      ? foundModel.name.replace(/^✨\s*/, '')
      : null;

  return (
    <article className="flex gap-3" aria-label={t('chat.assistant')}>
      <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-md bg-surface-2 p-1 text-text">
        <img src="/logo-mark.png" alt="Ketner AI" className="size-4.5 object-contain" />
      </span>

      <div className="min-w-0 flex-1">
        {modelName ? (
          <div className="mb-1 font-mono text-[11px] uppercase tracking-[0.06em] text-subtle">
            {modelName}
          </div>
        ) : null}

        {thinking ? (
          <p className="flex items-center gap-2 text-sm leading-5 text-muted" role="status">
            <CornerMark size={14} className="text-accent reply-marker-pulse" />
            {t('chat.thinking')}
          </p>
        ) : null}

        {hasContent ? (
          <div className="text-[15px] leading-[26px] text-text [&>*:not(pre):not(table):not(.code-block)]:max-w-[66ch]">
            <Suspense
              fallback={
                <p className="text-[15px] leading-[26px] whitespace-pre-wrap max-w-[66ch]">
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
              'mt-2 rounded-lg p-3.5 text-sm leading-5 transition-all',
              isUpgradeError
                ? 'border border-warning/30 bg-warning-soft text-warning'
                : 'border border-danger/30 bg-danger-soft text-danger',
            )}
          >
            <p className="flex items-center gap-2 font-medium">
              {isUpgradeError ? (
                <SparkleIcon className="size-4 text-warning" aria-hidden="true" />
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
                  className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-accent-text transition hover:opacity-90 shadow-sm"
                >
                  {t('chat.upgradeButton')}
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
