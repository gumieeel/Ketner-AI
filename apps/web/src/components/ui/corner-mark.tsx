import { cn } from '@/lib/cn';

interface CornerMarkProps {
  className?: string;
  size?: number;
}

/**
 * Характерный Г-образный штрих с закруглённым углом («Открытый контур»).
 * Используется строго в трёх местах:
 * 1. Начало нового чата (ChatEmptyState)
 * 2. Активный диалог в сайдбаре (ConversationRow)
 * 3. Рамка поля ввода (Composer)
 */
export function CornerMark({ className, size = 12 }: CornerMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden="true"
      className={cn('shrink-0 text-accent', className)}
    >
      <path
        d="M2 10V4.5A2.5 2.5 0 0 1 4.5 2H10"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
