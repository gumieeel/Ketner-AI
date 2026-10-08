import { useEffect, useRef, useState } from 'react';
import { BrainIcon, ChevronDownIcon } from '@/components/icons';
import { useTranslation } from '@/i18n';
import { cn } from '@/lib/cn';

export interface ParsedMessageContent {
  thinking: string;
  isThinking: boolean;
  content: string;
}

/**
 * Парсит сообщение на блок размышлений (<think>...</think>) и чистый текст ответа.
 * Поддерживает потоковый режим, когда тег <think> ещё не закрыт.
 */
export function parseThinking(rawContent: string): ParsedMessageContent {
  if (!rawContent) {
    return { thinking: '', isThinking: false, content: '' };
  }

  const thinkStartIdx = rawContent.indexOf('<think>');
  if (thinkStartIdx === -1) {
    return { thinking: '', isThinking: false, content: rawContent };
  }

  const prefix = rawContent.slice(0, thinkStartIdx).trim();
  const afterStart = rawContent.slice(thinkStartIdx + '<think>'.length);
  const thinkEndIdx = afterStart.indexOf('</think>');

  if (thinkEndIdx === -1) {
    // Тег всё ещё открыт — модель стримит свои мысли
    return {
      thinking: afterStart.trim(),
      isThinking: true,
      content: prefix,
    };
  }

  const thinkingText = afterStart.slice(0, thinkEndIdx).trim();
  const restContent = (prefix ? prefix + '\n\n' : '') + afterStart.slice(thinkEndIdx + '</think>'.length).trim();

  return {
    thinking: thinkingText,
    isThinking: false,
    content: restContent,
  };
}

interface ThinkingBlockProps {
  thinkingText?: string;
  isThinkingActive?: boolean;
  isPending?: boolean;
  workspaceName?: string;
}

export function ThinkingBlock({
  thinkingText,
  isThinkingActive = false,
  isPending = false,
  workspaceName,
}: ThinkingBlockProps) {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState<boolean>(true);
  const [userToggled, setUserToggled] = useState<boolean>(false);
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
  const startTimeRef = useRef<number>(Date.now());
  const isActive = isThinkingActive || isPending;

  // Секундомер времени размышления (как в Antigravity / Claude)
  useEffect(() => {
    if (!isActive) return;

    const timer = setInterval(() => {
      const now = Date.now();
      const diff = Math.max(0.1, Number(((now - startTimeRef.current) / 1000).toFixed(1)));
      setElapsedSeconds(diff);
    }, 100);

    return () => clearInterval(timer);
  }, [isActive]);

  // Во время активных размышлений блок открыт, если пользователь явно не свернул его
  useEffect(() => {
    if (isActive && !userToggled) {
      setIsExpanded(true);
    }
  }, [isActive, userToggled]);

  const toggleExpand = () => {
    setUserToggled(true);
    setIsExpanded((prev) => !prev);
  };

  const hasThoughts = Boolean(thinkingText && thinkingText.length > 0);
  if (!isActive && !hasThoughts) {
    return null;
  }

  const durationDisplay =
    elapsedSeconds > 0
      ? isActive
        ? t('chat.thoughtDuration', { seconds: elapsedSeconds.toFixed(1) })
        : t('chat.thoughtFor', { seconds: elapsedSeconds.toFixed(1) })
      : null;

  const titleText = isPending
    ? t('chat.thinking')
    : isActive
      ? workspaceName
        ? t('chat.thinkingAnalyzingWorkspace', { name: workspaceName })
        : t('chat.thinkingActive')
      : durationDisplay ?? t('chat.thinkingProcess');

  return (
    <div
      className={cn(
        'my-2.5 overflow-hidden rounded-xl border transition-[border-color,background-color,box-shadow] duration-300',
        isActive
          ? 'border-accent/35 bg-surface-2/70 shadow-[0_0_28px_-10px_var(--accent)]'
          : 'border-stroke bg-surface-2/40 hover:border-stroke-strong',
      )}
    >
      <button
        type="button"
        onClick={toggleExpand}
        className="flex min-h-10 w-full items-center justify-between px-3.5 py-2 text-left text-[13px] select-none transition-colors hover:bg-surface-2 max-md:min-h-11"
        aria-expanded={isExpanded}
      >
        <span className="flex min-w-0 items-center gap-2.5 text-text">
          <BrainIcon
            className={cn(
              'size-4 shrink-0 transition-transform duration-200',
              isActive ? 'animate-pulse text-accent' : 'text-subtle',
            )}
          />
          <span role="status" className={cn('truncate font-medium', isActive && 'text-shimmer')}>
            {titleText}
          </span>
          {isActive ? (
            <span className="flex shrink-0 items-center gap-1.5 rounded-md border border-accent/25 bg-accent-soft px-1.5 py-0.5 font-mono text-[11px] font-semibold text-accent tabular-nums">
              <span aria-hidden="true" className="size-1.5 rounded-full bg-accent animate-pulse" />
              {elapsedSeconds > 0 ? `${elapsedSeconds.toFixed(1)}s` : '0.1s'}
            </span>
          ) : null}
        </span>

        <span className="flex items-center gap-2 text-subtle">
          <ChevronDownIcon
            className={cn('size-3.5 transition-transform duration-200', isExpanded && 'rotate-180')}
          />
        </span>
      </button>

      {isExpanded ? (
        <div className="border-t border-stroke bg-canvas/50 px-4 py-3 text-[13px] leading-6 text-muted">
          <div className="border-l-2 border-accent/40 pl-3">
            {hasThoughts ? (
              <div className="whitespace-pre-wrap break-words text-muted">
                {thinkingText}
                {isActive ? (
                  <span
                    className="ml-1 inline-block h-3.5 w-1.5 animate-pulse bg-accent align-middle"
                    aria-hidden="true"
                  />
                ) : null}
              </div>
            ) : isActive ? (
              <div className="animate-pulse space-y-1.5 text-xs text-subtle">
                <p>• {t('chat.thinking')}</p>
                <p>• {workspaceName ? t('chat.thinkingAnalyzingWorkspace', { name: workspaceName }) : t('chat.thinkStepAnalyse')}</p>
                <p>• {t('chat.thinkStepCompose')}</p>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
