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
  className?: string;
  children: ReactNode;
}

const sizeClasses: Record<StubSize, string> = {
  sm: 'size-8 justify-center text-base',
  md: 'size-10 justify-center text-lg',
};

const HINT_TIMEOUT_MS = 2500;

/**
 * Кнопка-заглушка: полноценная по виду и доступности, но вместо действия
 * показывает пояснение. Такие кнопки отмечают места будущих интеграций
 * (шаринг, вложения, OAuth, выход) — их перечень ведётся в docs/*-integration-todo.md.
 */
export function StubAction({
  label,
  hint,
  size = 'md',
  block = false,
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
          'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900',
          'dark:text-zinc-300 dark:hover:bg-zinc-700 dark:hover:text-zinc-50',
          block ? 'h-10 w-full justify-start gap-2 px-3 text-sm' : sizeClasses[size],
          className,
        )}
      >
        {children}
      </button>
      {visible ? (
        <span
          role="status"
          className="absolute bottom-full right-0 z-20 mb-1 w-60 rounded-lg border border-zinc-200 bg-white p-2 text-xs text-zinc-600 shadow-lg dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
        >
          {hint ?? t('common.soon')}
        </span>
      ) : null}
    </span>
  );
}
