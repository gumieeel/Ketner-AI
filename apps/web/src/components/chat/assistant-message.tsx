import { Suspense, lazy, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { AlertIcon, RefreshIcon, SparkleIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { buttonClasses } from '@/components/ui/button-classes';
import { ModelMark } from '@/components/ui/model-mark';
import { CopyButton } from '@/components/ui/copy-button';
import { IconButton } from '@/components/ui/icon-button';
import { findModel } from '@/features/chat/can-access-model';
import { useChat } from '@/features/chat/chat-store';
import type { Message } from '@/features/chat/types';
import { useTranslation } from '@/i18n';
import { cn } from '@/lib/cn';
import { modelColor } from '@/lib/model-color';
import { ThinkingBlock, parseThinking } from './thinking-block';
import { useWorkspace } from '@/features/chat/workspace-store';
import { parseFileProposals, stripFileActionBlocks } from '@/features/chat/file-operations';
import { FileProposalCard } from './file-proposal-card';
import { FeedbackButtons } from './feedback-buttons';

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
  const continueReply = useChat((state) => state.continueReply);
  const streaming = useChat((state) => state.streaming);
  const meta = useChat((state) => state.meta);

  const parsed = useMemo(() => parseThinking(message.content), [message.content]);
  const isPending = message.status === 'pending';
  const isStreaming = message.status === 'streaming';
  const failed = message.status === 'error';
  const hasThoughts = Boolean(parsed.thinking && parsed.thinking.length > 0);
  const showThinkingBlock = isPending || hasThoughts || parsed.isThinking;
  const activeWorkspace = useWorkspace((state) => state.activeWorkspace);
  // Правки файлов разбираются, когда ответ дописан: во время стрима блок ещё не закончен,
  // а построение diff на каждую порцию текста впустую грузило бы процессор.
  const fileProposal = useMemo(() => {
    if (isPending || isStreaming) return null;
    return parseFileProposals(parsed.content || message.content, message.id, activeWorkspace);
  }, [parsed.content, message.content, message.id, activeWorkspace, isPending, isStreaming]);

  const displayContent = useMemo(() => {
    if (fileProposal || isStreaming) {
      return stripFileActionBlocks(parsed.content);
    }
    return parsed.content;
  }, [parsed.content, fileProposal, isStreaming]);

  const hasContent = displayContent !== '' || Boolean(fileProposal);
  // Кнопка «Продолжить» — только у последнего ответа, оборванного по длине или времени.
  const canContinue =
    canRegenerate &&
    !failed &&
    !isPending &&
    !isStreaming &&
    (message.canContinue === true || message.finishReason === 'length');
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
      <ModelMark modelId={message.modelId ?? 'ketner-mini'} size="md" className="mt-0.5" />

      <div className="min-w-0 flex-1">
        {modelName ? (
          <div
            className="mb-1 text-xs font-semibold"
            style={{ color: message.modelId ? modelColor(message.modelId) : undefined }}
          >
            {modelName}
          </div>
        ) : null}

        {showThinkingBlock ? (
          <ThinkingBlock
            thinkingText={parsed.thinking}
            isThinkingActive={parsed.isThinking && isStreaming}
            isPending={isPending}
            workspaceName={message.workspaceContext?.name}
          />
        ) : null}

        {displayContent ? (
          <div className="text-base leading-7 text-text">
            <Suspense
              fallback={
                <p className="max-w-[68ch] whitespace-pre-wrap">
                  {displayContent}
                </p>
              }
            >
              <Markdown content={displayContent} />
            </Suspense>
          </div>
        ) : null}

        {fileProposal ? (
          <FileProposalCard proposal={fileProposal} workspace={activeWorkspace} />
        ) : null}
        {isStreaming && !parsed.isThinking ? (
          <span className="caret text-accent ml-1" aria-hidden="true" />
        ) : null}

        {failed ? (
          <div
            className={cn(
              'mt-2 rounded-xl p-4 text-sm leading-5',
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
                <Link to="/pricing" className={buttonClasses({ variant: 'primary', size: 'sm' })}>
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

        {canContinue ? (
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px] text-muted">
            <span>{t('chat.truncatedNotice')}</span>
            <Button variant="outline" size="sm" disabled={streaming} onClick={() => void continueReply()}>
              {t('chat.continue')}
            </Button>
          </div>
        ) : null}

        {hasContent && !isPending && !failed ? (
          <div className="mt-2 -ml-2 flex items-center gap-0.5 text-muted">
            <CopyButton value={parsed.content || message.content} label={t('chat.copy')} size="sm" />
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
            <FeedbackButtons message={message} disabled={streaming} />
          </div>
        ) : null}
      </div>
    </article>
  );
}
