import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export type IconButtonSize = 'sm' | 'md';

const sizeClasses: Record<IconButtonSize, string> = {
  sm: 'size-[44px] text-base',
  md: 'size-[44px] text-lg',
};

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Обязательная текстовая подпись: нужна для скринридеров и как tooltip. */
  label: string;
  size?: IconButtonSize;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  {
    label,
    size = 'md',
    className,
    children,
    type = 'button',
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center rounded-md transition-colors',
        'text-muted hover:bg-surface-2 hover:text-text',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'after:absolute after:-inset-1.5 after:content-[""] max-md:after:block md:after:hidden',
        sizeClasses[size],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
});
