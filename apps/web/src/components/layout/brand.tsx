import { Link } from 'react-router-dom';
import { SparkleIcon } from '@/components/icons';
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
        'inline-flex items-center gap-2 rounded-lg font-semibold text-zinc-900 dark:text-zinc-50',
        className,
      )}
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-500/15 text-brand-600 dark:text-brand-300">
        <SparkleIcon className="text-xl" />
      </span>
      <span className={cn('text-base', iconOnly && 'sr-only')}>Ketner AI</span>
    </Link>
  );
}
