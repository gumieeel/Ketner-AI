import type { ReactNode } from 'react';
import { AlertIcon, CheckIcon, InfoIcon, ShieldIcon } from '@/components/icons';
import { cn } from '@/lib/cn';

export type CalloutTone = 'info' | 'warning' | 'success' | 'danger';

export interface CalloutProps {
  tone?: CalloutTone;
  title?: string;
  children: ReactNode;
  className?: string;
}

const toneStyles: Record<
  CalloutTone,
  { container: string; icon: string; IconComponent: typeof InfoIcon }
> = {
  info: {
    container: 'border-info/25 bg-info-soft',
    icon: 'bg-info/15 text-info',
    IconComponent: InfoIcon,
  },
  warning: {
    container: 'border-warning/25 bg-warning-soft',
    icon: 'bg-warning/15 text-warning',
    IconComponent: AlertIcon,
  },
  success: {
    container: 'border-success/25 bg-success-soft',
    icon: 'bg-success/15 text-success',
    IconComponent: CheckIcon,
  },
  danger: {
    container: 'border-danger/25 bg-danger-soft',
    icon: 'bg-danger/15 text-danger',
    IconComponent: ShieldIcon,
  },
};

/** Врезка-пояснение: цветная подложка и иконка по тону. */
export function Callout({ tone = 'info', title, children, className }: CalloutProps) {
  const { container, icon, IconComponent } = toneStyles[tone];

  return (
    <div
      role="note"
      className={cn(
        'my-4 flex gap-3.5 rounded-xl border p-4 text-sm leading-relaxed text-text',
        container,
        className,
      )}
    >
      <span
        className={cn('mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg', icon)}
        aria-hidden="true"
      >
        <IconComponent className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        {title ? <p className="mb-1 font-semibold text-text">{title}</p> : null}
        <div className="leading-relaxed text-muted [&>p]:leading-relaxed">{children}</div>
      </div>
    </div>
  );
}
