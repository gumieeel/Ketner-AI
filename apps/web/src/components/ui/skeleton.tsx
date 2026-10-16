import { cn } from '@/lib/cn';

interface SkeletonProps {
  className?: string;
  /**
   * `light` — для заглушек на всегда светлой подложке (рамка QR-кода),
   * где тёмный shimmer тёмной темы выглядел бы чёрной дырой.
   */
  tone?: 'default' | 'light';
}

export function Skeleton({ className, tone = 'default' }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'rounded-md',
        tone === 'light' ? 'bg-slate-200 skeleton-shimmer-light' : 'bg-surface-2 skeleton-shimmer',
        className,
      )}
    />
  );
}

/** Несколько строк-заглушек; последняя короче — похоже на абзац текста. */
export function SkeletonLines({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div aria-hidden="true" className={cn('flex flex-col gap-2.5', className)}>
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton
          key={index}
          className={cn('h-3.5', index === lines - 1 && lines > 1 ? 'w-2/3' : 'w-full')}
        />
      ))}
    </div>
  );
}
