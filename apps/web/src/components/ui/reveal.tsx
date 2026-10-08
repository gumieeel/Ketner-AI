import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { useInView } from '@/lib/use-in-view';

export interface RevealProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  delayMs?: number;
  /**
   * Для первого экрана: содержимое видно с первой отрисовки (не ждёт JS и
   * IntersectionObserver), анимируется только сдвиг. Так крупный текст hero
   * сразу становится LCP-кандидатом, а не через полсекунды после проявления.
   */
  eager?: boolean;
}

export function Reveal({
  children,
  delayMs = 0,
  eager = false,
  className,
  style,
  ...props
}: RevealProps) {
  const [ref, inView] = useInView<HTMLDivElement>();

  if (eager) {
    return (
      <div
        className={cn('reveal-eager', className)}
        style={{ animationDelay: delayMs > 0 ? `${delayMs}ms` : undefined, ...style }}
        {...props}
      >
        {children}
      </div>
    );
  }

  return (
    <div
      ref={ref}
      data-visible={inView ? 'true' : 'false'}
      className={cn('reveal', className)}
      style={{
        transitionDelay: delayMs > 0 ? `${delayMs}ms` : undefined,
        ...style,
      }}
      {...props}
    >
      {children}
    </div>
  );
}
