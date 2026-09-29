import type { ElementType, ReactNode } from 'react';
import { HashIcon } from '@/components/icons';
import { cn } from '@/lib/cn';

export interface DocHeadingProps {
  id: string;
  level?: 2 | 3 | 4;
  children: ReactNode;
  className?: string;
}

export function DocHeading({ id, level = 2, children, className }: DocHeadingProps) {
  const Component: ElementType = `h${level}`;

  return (
    <Component
      id={id}
      className={cn(
        'group relative flex items-center gap-2 scroll-mt-24 font-semibold text-text',
        level === 2 && 'text-xl tracking-tight mt-10 mb-4 first:mt-0',
        level === 3 && 'text-lg tracking-tight mt-8 mb-3',
        level === 4 && 'text-base mt-6 mb-2',
        className,
      )}
    >
      <a
        href={`#${id}`}
        className="inline-flex items-center gap-2 hover:underline decoration-muted/40 underline-offset-4"
      >
        <span
          className="absolute -left-5 text-muted opacity-0 transition-opacity group-hover:opacity-100 hidden sm:inline-flex items-center"
          aria-hidden="true"
        >
          <HashIcon className="size-4" />
        </span>
        {children}
      </a>
    </Component>
  );
}
