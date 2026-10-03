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
        'my-2.5 overflow-hidden rounded-lg border transition-all duration-200',
        isActive
          ? 'border-accent/30 bg-surface-2/60 shadow-[0_0_15px_-4px_rgba(255,255,255,0.08)]'
          : 'border-stroke/30 bg-surface-2/30 hover:border-stroke/50',
      )}
    >
      <button
        type="button"
        onClick={toggleExpand}
        className="flex w-full items-center justify-between px-3.5 py-2 text-left font-mono text-xs select-none transition-colors hover:bg-white/[0.03]"
        aria-expanded={isExpanded}
      >
        <span className="flex items-center gap-2.5 text-text/85">
          <BrainIcon
            className={cn(
              'size-4 shrink-0 transition-transform duration-200',
              isActive ? 'animate-pulse text-accent drop-shadow-[0_0_6px_rgba(255,255,255,0.35)]' : 'text-subtle',
            )}
          />
          <span role="status" className="font-medium tracking-wide">
            {titleText}
          </span>
          {isActive ? (
            <span className="flex items-center gap-1.5 rounded bg-surface px-1.5 py-0.5 font-mono text-[10px] text-accent font-semibold border border-accent/20">
              <span className="size-1.5 rounded-full bg-accent animate-ping" />
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
        <div className="border-t border-stroke/20 bg-canvas/50 px-4 py-3 font-mono text-[12.5px] leading-relaxed text-subtle">
          <div className="border-l-2 border-accent/40 pl-3">
            {hasThoughts ? (
              <div className="whitespace-pre-wrap break-words text-text/80">
                {thinkingText}
                {isActive ? (
                  <span
                    className="inline-block w-1.5 h-3.5 bg-accent ml-1 align-middle animate-pulse"
                    aria-hidden="true"
                  />
                ) : null}
              </div>
            ) : isActive ? (
              <div className="space-y-1.5 text-subtle text-xs animate-pulse">
                <p>• {t('chat.thinking')}</p>
                <p>• {workspaceName ? t('chat.thinkingAnalyzingWorkspace', { name: workspaceName }) : 'Анализ запроса и контекста…'}</p>
                <p>• Формирование решения и синтез ответа…</p>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
