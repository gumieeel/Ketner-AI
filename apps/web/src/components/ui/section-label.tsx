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
        'inline-flex items-center gap-2 text-[13px] font-medium text-subtle',
        className,
      )}
      {...props}
    >
      {index ? (
        <span className="tabular text-muted">{index}</span>
      ) : null}
      <span>{children}</span>
    </div>
  );
}
