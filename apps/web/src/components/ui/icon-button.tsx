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
        'inline-flex shrink-0 items-center justify-center rounded-[6px] transition-colors',
        'text-muted hover:bg-surface hover:text-text',
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
