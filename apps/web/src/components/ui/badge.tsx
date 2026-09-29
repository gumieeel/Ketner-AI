import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export type BadgeTone =
  | 'neutral'
  | 'brand'
  | 'outline'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info';

const toneClasses: Record<BadgeTone, string> = {
  neutral: 'bg-surface-2 text-muted border border-stroke',
  brand: 'bg-accent-soft text-accent border border-accent/20',
  outline: 'border border-stroke-strong text-muted',
  success: 'bg-success-soft text-success border border-success/20',
  warning: 'bg-warning-soft text-warning border border-warning/20',
  danger: 'bg-danger-soft text-danger border border-danger/20',
  info: 'bg-info-soft text-info border border-info/20',
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
}

export function Badge({ tone = 'neutral', className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-sm px-2 py-0.5 font-mono text-[11px] font-medium uppercase tracking-[0.06em]',
        toneClasses[tone],
        className,
      )}
      {...props}
    />
  );
}
