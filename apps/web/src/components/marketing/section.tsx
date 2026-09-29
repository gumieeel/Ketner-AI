import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { SectionLabel } from '@/components/ui/section-label';
import { Reveal } from '@/components/ui/reveal';

export interface SectionProps {
  id?: string;
  index?: string;
  label?: string;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
  align?: 'left' | 'center';
}

export function Section({
  id,
  index,
  label,
  title,
  description,
  children,
  className,
  align = 'left',
}: SectionProps) {
  return (
    <section
      id={id}
      className={cn(
        'w-full py-20 md:py-28 scroll-mt-14',
        className,
      )}
    >
      <Reveal>
        <div
          className={cn(
            'flex flex-col gap-3 mb-12',
            align === 'center' ? 'items-center text-center' : 'items-start text-left',
          )}
        >
          {(index || label) && (
            <SectionLabel index={index}>{label}</SectionLabel>
          )}
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-semibold tracking-tight text-text">
            {title}
          </h2>
          {description && (
            <p className="text-sm sm:text-base text-muted max-w-[64ch] text-balance">
              {description}
            </p>
          )}
        </div>
        {children}
      </Reveal>
    </section>
  );
}
