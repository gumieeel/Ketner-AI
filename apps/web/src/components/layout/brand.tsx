import { Link } from 'react-router-dom';
import { cn } from '@/lib/cn';

interface BrandProps {
  className?: string;
  to?: string;
  /** Скрывает название и оставляет только знак — для узких мест вроде сайдбара. */
  iconOnly?: boolean;
}

export function Brand({ className, to = '/', iconOnly = false }: BrandProps) {
  return (
    <Link
      to={to}
      className={cn(
        'inline-flex min-h-11 shrink-0 items-center gap-2.5 rounded-md font-semibold whitespace-nowrap text-text',
        className,
      )}
    >
      <img src="/logo-mark-160.png" alt="Ketner AI" className="size-8 shrink-0 object-contain" />
      <span className={cn('text-base font-semibold tracking-tight', iconOnly && 'sr-only')}>
        Ketner AI
      </span>
    </Link>
  );
}
