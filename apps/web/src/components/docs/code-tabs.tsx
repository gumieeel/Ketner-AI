import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { CopyButton } from '@/components/ui/copy-button';
import { highlight, type TokenKind } from '@/features/chat/markdown/highlight';
import { useTranslation } from '@/i18n';
import { cn } from '@/lib/cn';

export interface CodeTab {
  id?: string;
  label: string;
  language: string;
  code: string;
}

export interface CodeTabsProps {
  tabs: CodeTab[];
  defaultTabId?: string;
  className?: string;
}

const TOKEN_CLASSES: Record<TokenKind, string> = {
  plain: '',
  keyword: 'text-[color:var(--syn-keyword)]',
  string: 'text-[color:var(--syn-string)]',
  comment: 'text-[color:var(--syn-comment)] italic',
  number: 'text-[color:var(--syn-number)]',
  function: 'text-[color:var(--syn-function)]',
  punctuation: 'text-[color:var(--syn-punct)]',
};

/** Блок кода с вкладками: подсветка, копирование, переключение стрелками. */
export function CodeTabs({ tabs, defaultTabId, className }: CodeTabsProps) {
  const { t } = useTranslation();
  const baseId = useId();
  const initialIndex = defaultTabId ? Math.max(0, tabs.findIndex((tab) => tab.id === defaultTabId)) : 0;
  const [activeIndex, setActiveIndex] = useState(initialIndex);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const activeTab = tabs[activeIndex] ?? tabs[0];
  const tokens = useMemo(
    () => (activeTab ? highlight(activeTab.code, activeTab.language) : []),
    [activeTab],
  );

  if (!activeTab) return null;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    let next = activeIndex;
    if (event.key === 'ArrowRight') next = (activeIndex + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (activeIndex - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else return;
    event.preventDefault();
    setActiveIndex(next);
    tabRefs.current[next]?.focus();
  };

  return (
    <div className={cn('code-block my-4 overflow-hidden rounded-xl border border-stroke bg-surface shadow-xs', className)}>
      <div className="flex min-h-10 items-center justify-between gap-2 border-b border-stroke bg-surface-2/80 pr-1.5 pl-2">
        {tabs.length > 1 ? (
          <div
            role="tablist"
            onKeyDown={onKeyDown}
            className="flex items-center gap-1 overflow-x-auto py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {tabs.map((tab, index) => {
              const selected = activeIndex === index;
              return (
                <button
                  key={tab.label}
                  ref={(element) => {
                    tabRefs.current[index] = element;
                  }}
                  id={`${baseId}-tab-${index}`}
                  role="tab"
                  type="button"
                  aria-selected={selected}
                  aria-controls={`${baseId}-panel`}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => setActiveIndex(index)}
                  className={cn(
                    'min-h-8 shrink-0 rounded-md px-2.5 text-xs font-medium whitespace-nowrap transition-colors max-md:min-h-11',
                    selected
                      ? 'bg-surface text-text shadow-xs ring-1 ring-stroke ring-inset'
                      : 'text-muted hover:text-text',
                  )}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        ) : (
          <span className="flex items-center gap-2 pl-1.5 font-mono text-xs text-muted">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-accent/70" />
            {activeTab.label}
          </span>
        )}
        <CopyButton value={activeTab.code} label={t('chat.copyCode')} size="sm" />
      </div>
      <pre
        id={`${baseId}-panel`}
        role={tabs.length > 1 ? 'tabpanel' : undefined}
        aria-labelledby={tabs.length > 1 ? `${baseId}-tab-${activeIndex}` : undefined}
        tabIndex={0}
        className="overflow-x-auto p-4 font-mono text-[13px] leading-[22px] text-text selection:bg-accent-soft focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
      >
        <code>
          {tokens.map((token, index) => (
            <span key={index} className={TOKEN_CLASSES[token.kind]}>
              {token.text}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}
