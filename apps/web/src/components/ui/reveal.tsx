import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { useInView } from '@/lib/use-in-view';

export interface RevealProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  delayMs?: number;
}

export function Reveal({
  children,
  delayMs = 0,
  className,
  style,
  ...props
}: RevealProps) {
  const [ref, inView] = useInView<HTMLDivElement>();

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
