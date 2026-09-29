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
    container: 'border-l-info bg-info-soft text-text',
    icon: 'text-info',
    IconComponent: InfoIcon,
  },
  warning: {
    container: 'border-l-warning bg-warning-soft text-text',
    icon: 'text-warning',
    IconComponent: AlertIcon,
  },
  success: {
    container: 'border-l-success bg-success-soft text-text',
    icon: 'text-success',
    IconComponent: CheckIcon,
  },
  danger: {
    container: 'border-l-danger bg-danger-soft text-text',
    icon: 'text-danger',
    IconComponent: ShieldIcon,
  },
};

export function Callout({ tone = 'info', title, children, className }: CalloutProps) {
  const { container, icon, IconComponent } = toneStyles[tone];

  return (
    <div
      role="note"
      className={cn(
        'my-4 flex gap-3 rounded-lg border border-stroke border-l-2 p-4 text-sm leading-relaxed',
        container,
        className,
      )}
    >
      <span className={cn('mt-0.5 shrink-0', icon)} aria-hidden="true">
        <IconComponent className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        {title ? <p className="mb-1 font-semibold text-text">{title}</p> : null}
        <div className="text-muted leading-relaxed [&>p]:leading-relaxed">{children}</div>
      </div>
    </div>
  );
}
