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
        'inline-flex items-center gap-2.5 rounded-lg font-semibold text-zinc-900 dark:text-zinc-50',
        className,
      )}
    >
      <img src="/logo-mark.png" alt="Ketner AI" className="size-8 shrink-0 object-contain" />
      <span className={cn('text-base font-bold tracking-tight', iconOnly && 'sr-only')}>
        Ketner AI
      </span>
    </Link>
  );
}
