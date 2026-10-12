import { cn } from '@/lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'ink';
export type ButtonSize = 'sm' | 'md' | 'lg';

const variantClasses: Record<ButtonVariant, string> = {
  // Пастельный нефрит с тёмным текстом. Без свечения и подпрыгивания: на hover — светлее.
  primary: 'bg-brand-gradient text-accent-text hover:bg-action-hover active:brightness-95',
  secondary: 'border border-stroke bg-surface-2 text-text hover:border-stroke-strong hover:bg-surface-3',
  outline: 'border border-stroke-strong bg-transparent text-text hover:border-muted/60 hover:bg-surface-2',
  ghost: 'text-muted hover:bg-surface-2 hover:text-text active:bg-surface-3',
  danger: 'bg-danger-solid text-danger-solid-text hover:bg-danger-solid-hover active:brightness-95',
  // Тёмная кнопка для нефритовых панелей — одинакова в обеих темах.
  ink: 'bg-[#0f1a16] text-[#ecefea] hover:bg-[#24302b] active:brightness-95',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'h-9 gap-1.5 px-3.5 text-[14px] max-md:min-h-11',
  md: 'h-10 gap-2 px-4 text-[14px] max-md:min-h-11',
  lg: 'h-12 gap-2.5 px-5 text-[16px]',
};

/** Классы кнопки для ссылок (`<Link>` / `<a>`), чтобы они выглядели и вели себя как Button. */
export function buttonClasses({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  className,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  className?: string;
} = {}): string {
  return cn(
    'inline-flex select-none items-center justify-center whitespace-nowrap rounded-md font-medium',
    'transition-[filter,background-color,border-color,color] duration-150 ease-out-expo',
    'disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none',
    variantClasses[variant],
    sizeClasses[size],
    fullWidth && 'w-full',
    className,
  );
}
