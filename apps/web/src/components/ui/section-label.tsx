import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface SectionLabelProps extends HTMLAttributes<HTMLDivElement> {
  index?: string;
  children: ReactNode;
}

/** Эйбрау над заголовком секции: короткая цветная подпись с маркером. */
export function SectionLabel({ index, children, className, ...props }: SectionLabelProps) {
  return (
    <div
      className={cn(
        'inline-flex items-center gap-2 text-[13px] font-semibold tracking-wide text-accent',
        className,
      )}
      {...props}
    >
      {index ? (
        <span className="tabular rounded-full bg-accent-soft px-2 py-0.5 font-mono text-[11px] leading-4">
          {index}
        </span>
      ) : (
        <span aria-hidden="true" className="size-1.5 rounded-full bg-brand-gradient" />
      )}
      <span>{children}</span>
    </div>
  );
}
