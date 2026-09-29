import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export interface DividerProps extends HTMLAttributes<HTMLDivElement> {
  variant?: 'solid' | 'dashed' | 'crosses';
  label?: string;
}

export function Divider({
  variant = 'solid',
  label,
  className,
  ...props
}: DividerProps) {
  if (label) {
    return (
      <div
        role="separator"
        className={cn('flex items-center gap-3 my-4', className)}
        {...props}
      >
        <div
          className={cn(
            'flex-1 h-px',
            variant === 'dashed'
              ? 'border-t border-dashed border-stroke-strong'
              : 'bg-stroke',
          )}
        />
        <span className="font-mono text-[11px] font-medium tracking-[0.08em] uppercase text-muted select-none">
          {label}
        </span>
        <div
          className={cn(
            'flex-1 h-px',
            variant === 'dashed'
              ? 'border-t border-dashed border-stroke-strong'
              : 'bg-stroke',
          )}
        />
      </div>
    );
  }

  if (variant === 'crosses') {
    return (
      <div
        role="separator"
        className={cn('section-rule w-full my-6', className)}
        {...props}
      />
    );
  }

  return (
    <hr
      className={cn(
        'w-full border-0 my-4',
        variant === 'dashed'
          ? 'border-t border-dashed border-stroke-strong'
          : 'h-px bg-stroke',
        className,
      )}
      {...props}
    />
  );
}
