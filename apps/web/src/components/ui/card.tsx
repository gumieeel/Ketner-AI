import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';
import { CornerMark } from './corner-mark';

export type CardVariant = 'default' | 'interactive' | 'highlight' | 'dashed';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
  corners?: boolean;
}

const variantClasses: Record<CardVariant, string> = {
  default: 'border-stroke bg-surface',
  interactive: 'border-stroke bg-surface hover:border-stroke-strong hover:bg-surface-2 cursor-pointer',
  highlight: 'border-stroke-strong bg-surface-2',
  dashed: 'border-stroke-strong border-dashed bg-surface',
};

export function Card({
  variant = 'default',
  corners = false,
  className,
  children,
  ...props
}: CardProps) {
  return (
    <div
      className={cn(
        'relative rounded-lg border p-6 transition-colors',
        variantClasses[variant],
        className,
      )}
      {...props}
    >
      {corners && (
        <>
          <CornerMark size={10} className="absolute top-1.5 left-1.5 text-stroke-strong" />
          <CornerMark size={10} className="absolute top-1.5 right-1.5 text-stroke-strong rotate-90" />
          <CornerMark size={10} className="absolute bottom-1.5 right-1.5 text-stroke-strong rotate-180" />
          <CornerMark size={10} className="absolute bottom-1.5 left-1.5 text-stroke-strong -rotate-90" />
        </>
      )}
      {children}
    </div>
  );
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn('text-base font-semibold text-text', className)} {...props} />;
}

export function CardText({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={cn('text-sm leading-relaxed text-muted', className)}
      {...props}
    />
  );
}
