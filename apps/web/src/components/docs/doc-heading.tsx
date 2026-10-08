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
        'group relative flex items-center gap-2 scroll-mt-32 font-semibold text-text xl:scroll-mt-24',
        level === 2 && 'text-xl tracking-tight mt-10 mb-4 first:mt-0 md:text-2xl',
        level === 3 && 'text-lg tracking-tight mt-8 mb-3',
        level === 4 && 'text-base mt-6 mb-2',
        className,
      )}
    >
      <a
        href={`#${id}`}
        className="-my-2 inline-flex min-h-11 items-center gap-2 decoration-muted/40 underline-offset-4 hover:underline"
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
