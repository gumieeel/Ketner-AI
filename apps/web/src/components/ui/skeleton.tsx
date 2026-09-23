import { cn } from '@/lib/cn';

interface SkeletonProps {
  className?: string;
}

/** Статичный скелетон без анимации (согласно направлению «Открытый контур»). */
export function Skeleton({ className }: SkeletonProps) {
  return <div aria-hidden="true" className={cn('rounded-[6px] bg-stroke/15', className)} />;
}
