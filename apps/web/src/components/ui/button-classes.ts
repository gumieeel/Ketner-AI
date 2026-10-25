import { cn } from '@/lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

const variantClasses: Record<ButtonVariant, string> = {
  // Градиент бренда + мягкое свечение; на hover — чуть ярче и выше, на active — вдавливается.
  primary: [
    'bg-brand-gradient text-accent-text shadow-glow',
    'hover:brightness-[1.07] hover:shadow-glow-lg hover:-translate-y-px',
    'active:translate-y-0 active:scale-[0.985] active:brightness-95',
  ].join(' '),
  secondary: [
    'bg-surface-2 text-text border border-stroke shadow-xs',
    'hover:border-stroke-strong hover:bg-surface-3',
    'active:scale-[0.985]',
  ].join(' '),
  outline: [
    'border border-stroke-strong text-text bg-transparent',
    'hover:bg-surface-2 hover:border-muted/50',
    'active:scale-[0.985]',
  ].join(' '),
  ghost: 'text-muted hover:text-text hover:bg-surface-2 active:bg-surface-3 active:scale-[0.985]',
  danger: [
    'bg-danger text-danger-text shadow-xs',
    'hover:brightness-110 active:scale-[0.985] active:brightness-95',
  ].join(' '),
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'h-9 px-3.5 text-[13px] gap-1.5 max-md:min-h-11',
  md: 'h-10 px-4 text-sm gap-2 max-md:min-h-11',
  lg: 'h-12 px-6 text-[15px] gap-2.5',
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
    'transition-[transform,box-shadow,filter,background-color,border-color,color] duration-200 ease-out-expo',
    'disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none',
    variantClasses[variant],
    sizeClasses[size],
    fullWidth && 'w-full',
    className,
  );
}
