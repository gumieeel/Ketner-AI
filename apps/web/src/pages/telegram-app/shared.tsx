import { createContext, useContext, useEffect, useId, useRef, type ReactNode } from 'react';
import { CloseIcon } from '@/components/icons';
import type { MiniAppPayment, MiniAppState } from '@/features/telegram/api';
import type { TelegramWebApp } from '@/features/telegram/webapp';
import { cn } from '@/lib/cn';

export const DAY_MS = 24 * 3600 * 1000;
export const BOT_URL = 'https://t.me/Robo_kassa_bot';
export const SUPPORT_URL = 'https://t.me/ketner_support_bot';

/** Вкладка кредитов называется `plans` по-прежнему: на этот id ссылаются кнопки бота. */
export type TabId = 'home' | 'plans' | 'payments' | 'profile' | 'admin';

export interface MiniApp {
  app: TelegramWebApp;
  token: string;
  state: MiniAppState;
  setState: (state: MiniAppState) => void;
  refresh: () => Promise<void>;
  notify: (tone: 'success' | 'danger' | 'info', text: string) => void;
  goTo: (tab: TabId) => void;
  /** Открыть сайт уже войдя в аккаунт (одноразовая ссылка). */
  openSite: (path: string) => Promise<void>;
}

const MiniAppContext = createContext<MiniApp | null>(null);
export const MiniAppProvider = MiniAppContext.Provider;

export function useMiniApp(): MiniApp {
  const value = useContext(MiniAppContext);
  if (!value) throw new Error('useMiniApp вне кабинета');
  return value;
}

const locale = (language: string) => (language === 'en' ? 'en-US' : 'ru-RU');

export function formatDate(
  iso: string | null | undefined,
  language: string,
  withYear = false,
): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(locale(language), {
    day: 'numeric',
    month: 'long',
    ...(withYear ? { year: 'numeric' } : {}),
  });
}

export function formatDateTime(iso: string, language: string): string {
  return new Date(iso).toLocaleString(locale(language), {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatStars(stars: number, language: string): string {
  return stars.toLocaleString(locale(language));
}

export function formatAmount(
  payment: Pick<MiniAppPayment, 'amount' | 'currency'>,
  language: string,
): string {
  return payment.currency === 'XTR'
    ? `${formatStars(payment.amount, language)} ⭐`
    : `$${payment.amount}`;
}

/** Прежняя подписка «на сейчас»: действует ли, сколько осталось дней. Новых подписок нет. */
export function subscriptionInfo(state: MiniAppState, now = Date.now()) {
  const { user, subscription } = state;
  const end = subscription.renewsAt ? Date.parse(subscription.renewsAt) : NaN;
  const running = user.isVip || (subscription.plan !== 'free' && Number.isFinite(end) && end > now);
  const plan = user.isVip ? 'ultra' : running ? subscription.plan : 'free';
  const daysLeft =
    running && Number.isFinite(end) ? Math.max(1, Math.ceil((end - now) / DAY_MS)) : 0;
  return { running, plan, daysLeft, endsAt: running && !user.isVip ? subscription.renewsAt : null };
}

export function Panel({
  children,
  className,
  ...props
}: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLElement>) {
  return (
    <section className={cn('rounded-xl border border-stroke bg-surface p-4', className)} {...props}>
      {children}
    </section>
  );
}

export function SectionTitle({
  id,
  children,
  aside,
}: {
  id?: string;
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2 px-1">
      <h2 id={id} className="text-[15px] font-semibold">
        {children}
      </h2>
      {aside ? <span className="text-[12px] text-subtle">{aside}</span> : null}
    </div>
  );
}

/** Переключатель (role="switch"): подпись слева, ползунок справа. */
export function Toggle({
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <div className="min-w-0">
        <p id={`${id}-label`} className="text-[14px] font-medium text-text">
          {label}
        </p>
        {description ? (
          <p id={`${id}-desc`} className="mt-0.5 text-[13px] leading-5 text-muted">
            {description}
          </p>
        ) : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={`${id}-label`}
        aria-describedby={description ? `${id}-desc` : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors duration-150',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50',
          checked ? 'border-accent bg-accent' : 'border-stroke-strong bg-surface-3',
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            'inline-block size-5 rounded-full shadow-sm transition-transform duration-150',
            checked ? 'translate-x-[22px] bg-accent-text' : 'translate-x-[3px] bg-text/80',
          )}
        />
      </button>
    </div>
  );
}

/** Сегментированный выбор из двух-трёх вариантов. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="grid grid-flow-col gap-1 rounded-lg border border-stroke bg-surface-2 p-1"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            'min-h-9 rounded-md px-3 text-[14px] font-medium transition-colors duration-150',
            'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
            value === option.value
              ? 'bg-surface text-text shadow-sm ring-1 ring-stroke'
              : 'text-muted hover:text-text',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Notice({
  tone,
  children,
}: {
  tone: 'success' | 'danger' | 'info' | 'warning';
  children: ReactNode;
}) {
  return (
    <p
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn(
        'rounded-lg border px-3 py-2.5 text-[14px] leading-5',
        tone === 'success' && 'border-accent/40 bg-accent-soft text-text',
        tone === 'danger' && 'border-danger/30 bg-danger-soft text-danger',
        tone === 'info' && 'border-stroke bg-surface-2 text-text',
        tone === 'warning' && 'border-warning/30 bg-warning-soft text-text',
      )}
    >
      {children}
    </p>
  );
}

/** Строка «подпись — значение» в чеке. */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 text-[14px]">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="min-w-0 text-right font-medium text-text">{children}</dd>
    </div>
  );
}

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Нижняя шторка. Закрывается системной кнопкой «Назад» Telegram, Escape и тапом по затемнению.
 */
export function Sheet({
  title,
  onClose,
  closeLabel,
  app,
  children,
}: {
  title: ReactNode;
  onClose: () => void;
  closeLabel: string;
  app: TelegramWebApp | null;
  children: ReactNode;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    const back = () => onCloseRef.current();
    try {
      app?.BackButton?.onClick(back);
      app?.BackButton?.show();
    } catch {
      // старый клиент без кнопки «Назад»
    }
    const onKeyDown = (event: KeyboardEvent) => {
      const panel = panelRef.current;
      if (event.key === 'Escape') {
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (
        event.shiftKey &&
        (document.activeElement === first || document.activeElement === panel)
      ) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      try {
        app?.BackButton?.offClick(back);
        app?.BackButton?.hide();
      } catch {
        // нет кнопки «Назад»
      }
      previous?.focus?.();
    };
  }, [app]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={onClose}
      className="fixed inset-0 z-[var(--z-modal)] flex animate-fade-in items-end justify-center bg-black/60"
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[88dvh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl border border-b-0 border-stroke-strong bg-surface outline-none animate-slide-up"
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-stroke px-4 py-3">
          <h2 id={titleId} className="min-w-0 truncate text-[16px] font-semibold">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={closeLabel}
            className="grid size-10 shrink-0 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-text"
          >
            <CloseIcon className="size-4" />
          </button>
        </div>
        <div className="overflow-y-auto px-4 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          {children}
        </div>
      </div>
    </div>
  );
}
