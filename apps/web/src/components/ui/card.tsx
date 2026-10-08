import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export type CardVariant = 'default' | 'interactive' | 'highlight' | 'dashed' | 'glass';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
}

const variantClasses: Record<CardVariant, string> = {
  default: 'border-stroke bg-surface shadow-sm',
  // Поднимается на 2px и подсвечивает границу — для кликабельных карточек.
  interactive:
    'lift cursor-pointer border-stroke bg-surface shadow-sm hover:border-stroke-strong hover:bg-surface-2 hover:shadow-lg',
  // Рекомендованный элемент: тонкая градиентная граница и мягкий акцентный ореол.
  highlight: 'gradient-border border-transparent bg-surface-2 shadow-highlight',
  dashed: 'border-stroke-strong border-dashed bg-surface',
  // Полупрозрачная поверхность: поверх аврор-фона и композера.
  glass: 'surface-glass border-stroke shadow-popover',
};

export function Card({ variant = 'default', className, children, ...props }: CardProps) {
  return (
    <div
      className={cn(
        'relative rounded-lg border p-6 transition-colors',
        variantClasses[variant],
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2 className={cn('text-base font-semibold tracking-tight text-text', className)} {...props} />
  );
}

export function CardText({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-sm leading-relaxed text-muted', className)} {...props} />;
}
