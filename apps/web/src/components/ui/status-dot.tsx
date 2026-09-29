import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export type StatusDotTone = 'brand' | 'success' | 'warning' | 'danger' | 'neutral';

export interface StatusDotProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: StatusDotTone;
  pulse?: boolean;
}

const toneClasses: Record<StatusDotTone, { dot: string; ping: string }> = {
  brand: { dot: 'bg-accent', ping: 'bg-accent/40' },
  success: { dot: 'bg-success', ping: 'bg-success/40' },
  warning: { dot: 'bg-warning', ping: 'bg-warning/40' },
  danger: { dot: 'bg-danger', ping: 'bg-danger/40' },
  neutral: { dot: 'bg-muted', ping: 'bg-muted/40' },
};

export function StatusDot({
  tone = 'brand',
  pulse = false,
  className,
  ...props
}: StatusDotProps) {
  const { dot, ping } = toneClasses[tone];

  return (
    <span
      className={cn('relative inline-flex size-2 shrink-0 items-center justify-center', className)}
      aria-hidden="true"
      {...props}
    >
      {pulse && (
        <span
          className={cn(
            'absolute inset-0 rounded-full status-pulse',
            ping,
          )}
        />
      )}
      <span className={cn('size-1.5 rounded-full', dot)} />
    </span>
  );
}
