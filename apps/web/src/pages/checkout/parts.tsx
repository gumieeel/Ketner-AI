import type { ReactNode } from 'react';
import { AlertIcon, CheckIcon, CopyIcon, InfoIcon } from '@/components/icons';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useTranslation } from '@/i18n';
import { cn } from '@/lib/cn';

/** Общая оболочка панели способа оплаты: иконка, заголовок, пояснение и слот справа. */
export function PanelShell({
  icon,
  iconClassName,
  title,
  lead,
  aside,
  children,
}: {
  icon: ReactNode;
  iconClassName?: string;
  title: string;
  lead: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className="flex animate-fade-in flex-col gap-5 rounded-2xl p-4 sm:gap-6 sm:p-6">
      <header className="flex flex-col gap-3 border-b border-stroke pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={cn(
              'grid size-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent ring-1 ring-accent/20 ring-inset',
              iconClassName,
            )}
          >
            {icon}
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-semibold tracking-tight text-text">{title}</h2>
            <p className="mt-0.5 text-[13px] leading-5 text-muted">{lead}</p>
          </div>
        </div>
        {aside}
      </header>
      {children}
    </Card>
  );
}

/** Таймер счёта: подпись и обратный отсчёт табличными цифрами. */
export function TimerPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="inline-flex shrink-0 items-center gap-2 self-start rounded-full border border-stroke bg-canvas px-3 py-1.5 text-xs sm:self-auto">
      <span className="text-muted">{label}</span>
      <span className="font-semibold text-accent tabular-nums">{value}</span>
    </div>
  );
}

/** Строка статуса ожидания платежа с мягко пульсирующей точкой. */
export function StatusRow({
  status,
  hint,
  dotClassName = 'bg-warning',
  children,
}: {
  status: string;
  hint: string;
  dotClassName?: string;
  children?: ReactNode;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-stroke bg-canvas px-3.5 py-3 text-[13px]">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <span className="flex items-center gap-2">
          <span aria-hidden="true" className={cn('size-2 shrink-0 animate-pulse rounded-full', dotClassName)} />
          <span className="text-muted">
            {t('checkout.statusLabel')} <strong className="font-medium text-text">{status}</strong>
          </span>
        </span>
        <span className="text-xs text-subtle">{hint}</span>
      </div>
      {children}
    </div>
  );
}

const NOTICE_TONES = {
  warning: { box: 'border-warning/30 bg-warning-soft', icon: 'text-warning', Icon: AlertIcon },
  success: { box: 'border-success/30 bg-success-soft', icon: 'text-success', Icon: CheckIcon },
  info: { box: 'border-info/25 bg-info-soft', icon: 'text-info', Icon: InfoIcon },
} as const;

/**
 * Сообщение внутри панели. Текст всегда основного цвета (контраст AA в обеих темах),
 * тон передают подложка, рамка и иконка.
 */
export function Notice({
  tone,
  live = false,
  children,
  action,
}: {
  tone: keyof typeof NOTICE_TONES;
  /** Озвучить появление сообщения скринридером (результат проверки оплаты). */
  live?: boolean;
  children: ReactNode;
  action?: ReactNode;
}) {
  const { box, icon, Icon } = NOTICE_TONES[tone];

  return (
    <div
      role={live ? (tone === 'warning' ? 'alert' : 'status') : undefined}
      className={cn('flex items-start gap-2.5 rounded-xl border p-3.5 text-[13px] leading-5 text-text', box)}
    >
      <Icon className={cn('mt-0.5 size-4 shrink-0', icon)} />
      <div className="min-w-0 flex-1">{children}</div>
      {action}
    </div>
  );
}

/**
 * Белая рамка QR-кода (QR читается только на светлом фоне в любой теме).
 * Пока счёт создаётся — светлый скелетон того же размера, чтобы макет не прыгал.
 */
export function QrFrame({
  loading,
  loadingLabel,
  skeletonClassName,
  children,
}: {
  loading: boolean;
  loadingLabel: string;
  skeletonClassName: string;
  children: ReactNode;
}) {
  return (
    <div className="relative shrink-0 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
      {loading ? (
        <div role="status" aria-label={loadingLabel}>
          <Skeleton tone="light" className={cn('rounded-lg', skeletonClassName)} />
        </div>
      ) : (
        children
      )}
    </div>
  );
}

/** Плитка выбора (валюта, сеть, режим перевода): выбранная — с акцентной рамкой. */
export function ChoiceTile({
  selected,
  onClick,
  className,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        'flex min-h-11 flex-col items-start gap-1 rounded-xl border p-3 text-left',
        'transition-[border-color,background-color,box-shadow] duration-200',
        selected
          ? 'border-accent bg-accent-soft shadow-xs ring-1 ring-accent/30'
          : 'border-stroke bg-surface hover:border-stroke-strong hover:bg-surface-2',
        className,
      )}
    >
      {children}
    </button>
  );
}

/** Маленькая метка в углу плитки: на выбранной плитке становится акцентной. */
export function TileTag({ selected = false, tone, children }: { selected?: boolean; tone?: BadgeTone; children: ReactNode }) {
  return (
    <Badge
      tone={tone ?? (selected ? 'brand' : 'neutral')}
      className={cn('px-2 py-0 text-[11px] font-semibold', (selected || tone === 'brand') && 'bg-surface')}
    >
      {children}
    </Badge>
  );
}

/** Подпись шага формы с подсказкой справа. */
export function StepLabel({
  title,
  hint,
  htmlFor,
  id,
}: {
  title: string;
  hint?: string;
  htmlFor?: string;
  id?: string;
}) {
  const titleClass = 'text-[13px] font-semibold text-text';
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
      {htmlFor ? (
        <label id={id} htmlFor={htmlFor} className={titleClass}>
          {title}
        </label>
      ) : (
        <p id={id} className={titleClass}>
          {title}
        </p>
      )}
      {hint ? <span className="text-xs text-muted">{hint}</span> : null}
    </div>
  );
}

/** Кнопка копирования с подтверждением «Скопировано». */
export function CopyButton({
  copied,
  label,
  onCopy,
  variant = 'outline',
}: {
  copied: boolean;
  label: string;
  onCopy: () => void;
  variant?: 'outline' | 'ghost';
}) {
  const { t } = useTranslation();

  return (
    <Button
      type="button"
      variant={variant}
      size="sm"
      className="shrink-0"
      onClick={onCopy}
      leftIcon={
        copied ? <CheckIcon className="size-3.5 text-success" /> : <CopyIcon className="size-3.5 text-muted" />
      }
    >
      <span aria-live="polite">{copied ? t('checkout.cryptoCopied') : label}</span>
    </Button>
  );
}

/** Каркас страницы оформления, пока восстанавливается сессия. */
export function CheckoutSkeleton({ label }: { label: string }) {
  return (
    <div role="status" aria-label={label} className="mx-auto flex w-full max-w-5xl flex-col gap-6 md:gap-8">
      <div className="flex items-center gap-3.5 border-b border-stroke pb-6">
        <Skeleton className="size-11 rounded-xl" />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7 w-56 max-w-[60vw]" />
          <Skeleton className="h-3.5 w-72 max-w-[70vw]" />
        </div>
      </div>
      <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-[1fr_360px]">
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {[0, 1, 2].map((index) => (
              <Skeleton key={index} className="h-[104px] rounded-2xl" />
            ))}
          </div>
          <Skeleton className="h-96 rounded-2xl" />
        </div>
        <Skeleton className="h-80 rounded-2xl" />
      </div>
    </div>
  );
}
