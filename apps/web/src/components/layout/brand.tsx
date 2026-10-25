import { Link } from 'react-router-dom';
import { cn } from '@/lib/cn';

interface BrandProps {
  className?: string;
  to?: string;
  /** Скрывает название и оставляет только знак — для узких мест вроде сайдбара. */
  iconOnly?: boolean;
  /** `lg` — крупный знак для шапки витрины. */
  size?: 'md' | 'lg';
}

export function Brand({ className, to = '/', iconOnly = false, size = 'md' }: BrandProps) {
  const large = size === 'lg';
  return (
    <Link
      to={to}
      className={cn(
        'inline-flex min-h-11 shrink-0 items-center gap-2.5 rounded-md font-semibold whitespace-nowrap text-text',
        className,
      )}
    >
      <img
        src="/logo-mark-160.png"
        alt="Ketner AI"
        className={cn('shrink-0 object-contain', large ? 'size-9 md:size-10' : 'size-8')}
      />
      <span
        className={cn(
          large
            ? 'text-[20px] font-normal tracking-[-0.01em] md:text-[22px]'
            : 'text-base font-semibold tracking-tight',
          iconOnly && 'sr-only',
        )}
      >
        Ketner AI
      </span>
    </Link>
  );
}
