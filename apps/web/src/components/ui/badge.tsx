import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export type BadgeTone =
  | 'neutral'
  | 'brand'
  | 'outline'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'plus'
  | 'pro'
  | 'ultra';

const toneClasses: Record<BadgeTone, string> = {
  neutral: 'bg-surface-2 text-muted border-stroke',
  brand: 'bg-accent-soft text-accent border-accent/25',
  outline: 'border-stroke-strong text-muted bg-transparent',
  success: 'bg-success-soft text-success border-success/25',
  warning: 'bg-warning-soft text-warning border-warning/25',
  danger: 'bg-danger-soft text-danger border-danger/25',
  info: 'bg-info-soft text-info border-info/25',
  // Тарифные метки: единые цвета для Plus / Pro / Ultra по всему продукту.
  plus: 'bg-tier-plus/10 text-tier-plus border-tier-plus/30',
  pro: 'bg-tier-pro/10 text-tier-pro border-tier-pro/30',
  ultra: 'bg-tier-ultra/10 text-tier-ultra border-tier-ultra/30',
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
}

export function Badge({ tone = 'neutral', className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[12px] font-medium leading-5',
        toneClasses[tone],
        className,
      )}
      {...props}
    />
  );
}
