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
          'pointer-events-none absolute left-1/2 z-[var(--z-dropdown)] -translate-x-1/2 whitespace-nowrap rounded-md border border-stroke-strong bg-surface-3 px-2.5 py-1.5 text-xs font-medium text-text shadow-popover opacity-0',
          'transition-[opacity,transform] duration-200 ease-out-expo group-hover/tooltip:opacity-100 group-focus-within/tooltip:opacity-100',
          side === 'top'
            ? 'bottom-full mb-2 translate-y-1 group-hover/tooltip:translate-y-0 group-focus-within/tooltip:translate-y-0'
            : 'top-full mt-2 -translate-y-1 group-hover/tooltip:translate-y-0 group-focus-within/tooltip:translate-y-0',
          className,
        )}
      >
        {content}
      </span>
    </span>
  );
}
