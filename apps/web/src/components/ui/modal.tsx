import { useEffect, useRef, type ReactNode } from 'react';
import { CloseIcon } from '@/components/icons';
import { useTranslation } from '@/i18n';
import { cn } from '@/lib/cn';
import { IconButton } from './icon-button';

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl';

const sizeClasses: Record<ModalSize, string> = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-4xl',
  xl: 'max-w-5xl',
};

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export interface ModalProps {
  /** Идентификатор заголовка внутри окна: связывает диалог с его названием. */
  labelledBy: string;
  onClose: () => void;
  size?: ModalSize;
  /** Классы панели: например, фиксированная высота для окон с прокруткой внутри. */
  className?: string;
  children: ReactNode;
}

/**
 * Оболочка модального окна: затемнение с размытием, панель, Escape, возврат фокуса
 * и «ловушка» Tab внутри окна. Содержимое и логику окна задаёт вызывающий код.
 */
export function Modal({ labelledBy, onClose, size = 'md', className, children }: ModalProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    // Если внутри уже что-то сфокусировано (autoFocus поля), фокус не перехватываем.
    if (panel && !panel.contains(document.activeElement)) {
      panel.focus();
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !panel) {
        return;
      }
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === panel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previous?.focus?.();
    };
  }, []);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      onClick={onClose}
      className="fixed inset-0 z-[var(--z-modal)] flex animate-fade-in items-center justify-center bg-black/70 p-3 backdrop-blur-md sm:p-6"
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        className={cn(
          'relative flex max-h-[calc(100dvh-1.5rem)] w-full animate-scale-in flex-col overflow-hidden rounded-2xl',
          'border border-stroke-strong bg-surface shadow-2xl outline-none sm:max-h-[calc(100dvh-3rem)]',
          sizeClasses[size],
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}

export interface ModalHeaderProps {
  titleId: string;
  title: ReactNode;
  description?: ReactNode;
  /** Слева от заголовка: иконка или метка. */
  icon?: ReactNode;
  /** Дополнительные действия слева от кнопки закрытия. */
  actions?: ReactNode;
  onClose: () => void;
  className?: string;
}

/** Шапка модального окна: заголовок, пояснение и кнопка «Закрыть» размером с палец. */
export function ModalHeader({
  titleId,
  title,
  description,
  icon,
  actions,
  onClose,
  className,
}: ModalHeaderProps) {
  const { t } = useTranslation();

  return (
    <div
      className={cn(
        'flex shrink-0 items-start justify-between gap-3 border-b border-stroke px-5 py-4',
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        {icon ? (
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent ring-1 ring-accent/20">
            {icon}
          </span>
        ) : null}
        <div className="min-w-0">
          <h2 id={titleId} className="text-base font-semibold tracking-tight text-text">
            {title}
          </h2>
          {description ? (
            <div className="mt-0.5 text-[13px] leading-5 text-muted">{description}</div>
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {actions}
        <IconButton label={t('chat.close')} size="sm" onClick={onClose}>
          <CloseIcon className="size-4" />
        </IconButton>
      </div>
    </div>
  );
}
