import { useId, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface TooltipProps {
  content: ReactNode;
  children: (props: { 'aria-describedby': string }) => ReactNode;
  className?: string;
  side?: 'top' | 'bottom';
}

export function Tooltip({
  content,
  children,
  className,
  side = 'top',
}: TooltipProps) {
  const tooltipId = useId();

  return (
    <span className="relative inline-flex group/tooltip">
      {children({ 'aria-describedby': tooltipId })}
      <span
        role="tooltip"
        id={tooltipId}
        className={cn(
          'pointer-events-none absolute left-1/2 -translate-x-1/2 z-[var(--z-dropdown)] whitespace-nowrap rounded-md border border-stroke-strong bg-surface-2 px-2 py-1 font-mono text-[11px] text-text shadow-popover opacity-0 transition-opacity duration-150 group-hover/tooltip:opacity-100 group-focus-within/tooltip:opacity-100',
          side === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5',
          className,
        )}
      >
        {content}
      </span>
    </span>
  );
}
