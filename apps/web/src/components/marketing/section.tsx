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
  align = 'center',
}: SectionProps) {
  return (
    <section id={id} className={cn('w-full scroll-mt-20 py-12 md:py-20', className)}>
      <Reveal>
        <div
          className={cn(
            'mb-10 flex flex-col gap-4 md:mb-14',
            align === 'center' ? 'items-center text-center' : 'items-start text-left',
          )}
        >
          {(index || label) && <SectionLabel index={index}>{label}</SectionLabel>}
          <h2 className="t-headline max-w-[22ch] text-text">{title}</h2>
          {description && (
            <p className="max-w-[60ch] text-[15px] leading-relaxed text-muted text-balance sm:text-base md:text-[17px]">
              {description}
            </p>
          )}
        </div>
      </Reveal>
      {children}
    </section>
  );
}
