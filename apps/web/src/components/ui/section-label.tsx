import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface SectionLabelProps extends HTMLAttributes<HTMLDivElement> {
  index?: string;
  children: ReactNode;
}

export function SectionLabel({
  index,
  children,
  className,
  ...props
}: SectionLabelProps) {
  return (
    <div
      className={cn(
        'inline-flex items-center gap-2 font-mono text-xs uppercase tracking-[0.08em] text-muted',
        className,
      )}
      {...props}
    >
      {index && (
        <span className="text-accent font-semibold">[{index}]</span>
      )}
      <span>{children}</span>
    </div>
  );
}
