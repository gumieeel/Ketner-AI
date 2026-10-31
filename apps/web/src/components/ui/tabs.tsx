import {
  createContext,
  useContext,
  useId,
  useRef,
  useState,
  type ReactNode,
  type KeyboardEvent,
  type HTMLAttributes,
} from 'react';
import { cn } from '@/lib/cn';

interface TabsContextValue {
  selected: string;
  selectTab: (id: string) => void;
  baseId: string;
}

const TabsContext = createContext<TabsContextValue | null>(null);

export interface TabsProps {
  defaultValue?: string;
  value?: string;
  onValueChange?: (val: string) => void;
  children: ReactNode;
  className?: string;
}

export function Tabs({ defaultValue = '', value, onValueChange, children, className }: TabsProps) {
  const [internalValue, setInternalValue] = useState(defaultValue);
  const isControlled = value !== undefined;
  const selected = isControlled ? value : internalValue;
  // useId, а не случайное число: id одинаковы в пререндере и после гидратации, а сборка
  // воспроизводима (CI сверяет закоммиченный dist со сборкой).
  const baseId = `tabs-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;

  const selectTab = (id: string) => {
    if (!isControlled) {
      setInternalValue(id);
    }
    onValueChange?.(id);
  };

  return (
    <TabsContext.Provider value={{ selected, selectTab, baseId }}>
      <div className={cn('flex flex-col', className)}>{children}</div>
    </TabsContext.Provider>
  );
}

export interface TabListProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function TabList({ className, children, ...props }: TabListProps) {
  const listRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!listRef.current) return;
    const tabs = Array.from(
      listRef.current.querySelectorAll<HTMLButtonElement>('[role="tab"]:not([disabled])'),
    );
    if (!tabs.length) return;
    const currentIndex = tabs.findIndex((t) => t === document.activeElement);

    let nextIndex = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      nextIndex = (currentIndex + 1) % tabs.length;
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    } else if (e.key === 'Home') {
      nextIndex = 0;
    } else if (e.key === 'End') {
      nextIndex = tabs.length - 1;
    }

    if (nextIndex >= 0) {
      e.preventDefault();
      tabs[nextIndex].focus();
      tabs[nextIndex].click();
    }
  };

  return (
    <div
      ref={listRef}
      role="tablist"
      onKeyDown={handleKeyDown}
      className={cn(
        'inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full bg-surface-2 p-1 text-sm',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export interface TabProps {
  value: string;
  children: ReactNode;
  disabled?: boolean;
  className?: string;
}

export function Tab({ value, children, disabled = false, className }: TabProps) {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error('Tab must be used within Tabs');

  const isSelected = ctx.selected === value;
  const tabId = `${ctx.baseId}-tab-${value}`;
  const panelId = `${ctx.baseId}-panel-${value}`;

  return (
    <button
      type="button"
      role="tab"
      id={tabId}
      aria-selected={isSelected}
      aria-controls={panelId}
      tabIndex={isSelected ? 0 : -1}
      disabled={disabled}
      onClick={() => ctx.selectTab(value)}
      className={cn(
        'inline-flex min-h-9 items-center justify-center whitespace-nowrap rounded-full px-4 py-1.5 text-[13px] font-medium select-none max-md:min-h-11',
        'transition-[background-color,color] duration-200',
        isSelected ? 'bg-surface-3 text-text' : 'text-muted hover:bg-surface-3/60 hover:text-text',
        disabled && 'opacity-40 cursor-not-allowed',
        className,
      )}
    >
      {children}
    </button>
  );
}

export interface TabPanelProps extends HTMLAttributes<HTMLDivElement> {
  value: string;
  children: ReactNode;
}

export function TabPanel({ value, children, className, ...props }: TabPanelProps) {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error('TabPanel must be used within Tabs');

  const isSelected = ctx.selected === value;
  const tabId = `${ctx.baseId}-tab-${value}`;
  const panelId = `${ctx.baseId}-panel-${value}`;

  if (!isSelected) return null;

  return (
    <div
      role="tabpanel"
      id={panelId}
      aria-labelledby={tabId}
      tabIndex={0}
      className={cn('mt-3', className)}
      {...props}
    >
      {children}
    </div>
  );
}
