import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

type BadgeTone = 'neutral' | 'brand' | 'outline';

const toneClasses: Record<BadgeTone, string> = {
  neutral: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200',
  brand: 'bg-brand-500/15 text-brand-700 dark:text-brand-300',
  outline: 'border border-zinc-300 text-zinc-600 dark:border-zinc-600 dark:text-zinc-300',
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
}

export function Badge({ tone = 'neutral', className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        toneClasses[tone],
        className,
      )}
      {...props}
    />
  );
}
