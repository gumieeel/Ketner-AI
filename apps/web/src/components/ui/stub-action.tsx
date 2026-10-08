import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { useTranslation } from '@/i18n';

type StubSize = 'sm' | 'md';

interface StubActionProps {
  label: string;
  /** Пояснение, которое появляется после клика: что именно ещё не подключено. */
  hint?: string;
  size?: StubSize;
  /** Растягивает кнопку на всю ширину — для текстовых кнопок вида «Выйти». */
  block?: boolean;
  /** Где показать пояснение: над кнопкой (по умолчанию) или под ней — для кнопок в шапке. */
  placement?: 'top' | 'bottom';
  className?: string;
  children: ReactNode;
}

const sizeClasses: Record<StubSize, string> = {
  sm: 'size-8 justify-center text-base',
  md: 'size-10 justify-center text-lg max-md:size-11',
};

const HINT_TIMEOUT_MS = 2500;

/**
 * Кнопка-заглушка: полноценная по виду и доступности, но вместо действия
 * показывает пояснение. Такие кнопки отмечают места будущих интеграций.
 */
export function StubAction({
  label,
  hint,
  size = 'md',
  block = false,
  placement = 'top',
  className,
  children,
}: StubActionProps) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  return (
    <span className={cn('relative', block ? 'block' : 'inline-flex')}>
      <button
        type="button"
        aria-label={label}
        title={label}
        onClick={() => {
          setVisible(true);
          window.clearTimeout(timerRef.current);
          timerRef.current = window.setTimeout(() => setVisible(false), HINT_TIMEOUT_MS);
        }}
        className={cn(
          'inline-flex items-center rounded-lg transition-colors',
          'text-muted hover:bg-surface-2 hover:text-text',
          block ? 'h-10 w-full justify-start gap-2 px-3 text-sm' : sizeClasses[size],
          className,
        )}
      >
        {children}
      </button>
      {visible ? (
        <span
          role="status"
          className={cn(
            'absolute right-0 z-[var(--z-dropdown)] w-60 rounded-xl border border-stroke-strong bg-surface-2 p-3 text-xs leading-5 text-muted shadow-popover',
            placement === 'top' ? 'bottom-full mb-1' : 'top-full mt-1',
          )}
        >
          {hint ?? t('common.soon')}
        </span>
      ) : null}
    </span>
  );
}
