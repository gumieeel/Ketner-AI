import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export type KbdProps = HTMLAttributes<HTMLElement>;

export function Kbd({ className, children, ...props }: KbdProps) {
  return (
    <kbd
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded-sm border border-stroke-strong bg-surface-2 px-1 font-mono text-[11px] text-muted select-none',
        className,
      )}
      {...props}
    >
      {children}
    </kbd>
  );
}
