import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface SectionHeadProps {
  id: string;
  title: string;
  lead?: ReactNode;
  className?: string;
}

/**
 * Шапка секции главной: крупный заголовок слева, пояснение справа внизу —
 * без надзаголовков и меток. На мобильных — одна колонка.
 */
export function SectionHead({ id, title, lead, className }: SectionHeadProps) {
  return (
    <div className={cn('grid grid-cols-1 gap-5 md:grid-cols-12 md:items-end md:gap-8', className)}>
      <h2 id={id} className="t-headline max-w-[16ch] text-text md:col-span-7">
        {title}
      </h2>
      {lead ? (
        <div className="max-w-[46ch] text-[17px] leading-relaxed text-muted text-pretty md:col-span-5 md:justify-self-end">
          {lead}
        </div>
      ) : null}
    </div>
  );
}
