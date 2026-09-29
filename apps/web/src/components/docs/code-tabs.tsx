import { useState } from 'react';
import { CopyButton } from '@/components/ui/copy-button';
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

export function CodeTabs({ tabs, defaultTabId, className }: CodeTabsProps) {
  const initialIndex = defaultTabId
    ? Math.max(0, tabs.findIndex((t) => t.id === defaultTabId))
    : 0;
  const [activeIndex, setActiveIndex] = useState(initialIndex);
  const activeTab = tabs[activeIndex] ?? tabs[0];

  if (!activeTab) return null;

  return (
    <div className={cn('my-4 overflow-hidden rounded-lg border border-stroke bg-surface', className)}>
      <div className="flex h-10 items-center justify-between border-b border-stroke bg-surface-2 px-2">
        <div className="flex items-center gap-1 overflow-x-auto">
          {tabs.map((tab, i) => (
            <button
              key={tab.label}
              type="button"
              onClick={() => setActiveIndex(i)}
              className={cn(
                'rounded-md px-2.5 py-1 text-xs font-mono transition-colors',
                activeIndex === i
                  ? 'bg-surface text-text font-medium border border-stroke shadow-xs'
                  : 'text-muted hover:text-text hover:bg-surface/50',
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <CopyButton value={activeTab.code} label="Копировать код" size="sm" />
      </div>
      <div className="overflow-x-auto p-4 text-xs font-mono leading-relaxed text-text">
        <pre className="selection:bg-accent-soft selection:text-text">
          <code>{activeTab.code}</code>
        </pre>
      </div>
    </div>
  );
}
