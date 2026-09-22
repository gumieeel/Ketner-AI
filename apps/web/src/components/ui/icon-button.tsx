import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

type IconButtonSize = 'sm' | 'md';

const sizeClasses: Record<IconButtonSize, string> = {
  sm: 'size-8 text-base',
  md: 'size-10 text-lg',
};

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Обязательная текстовая подпись: нужна для скринридеров и как tooltip. */
  label: string;
  size?: IconButtonSize;
}

export function IconButton({
  label,
  size = 'md',
  className,
  children,
  type = 'button',
  ...props
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-lg transition-colors',
        'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900',
        'dark:text-zinc-300 dark:hover:bg-zinc-700 dark:hover:text-zinc-50',
        'disabled:cursor-not-allowed disabled:opacity-50',
        sizeClasses[size],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
