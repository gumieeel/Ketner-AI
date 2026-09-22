import type { InputHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export function Input({ invalid = false, className, ...props }: InputProps) {
  return (
    <input
      aria-invalid={invalid || undefined}
      className={cn(
        'h-11 w-full rounded-lg border bg-white px-3 text-sm text-zinc-900 transition-colors',
        'placeholder:text-zinc-400',
        'dark:bg-zinc-800 dark:text-zinc-50 dark:placeholder:text-zinc-500',
        invalid
          ? 'border-red-500 dark:border-red-500'
          : 'border-zinc-300 focus:border-brand-500 dark:border-zinc-600 dark:focus:border-brand-500',
        'disabled:cursor-not-allowed disabled:opacity-60',
        className,
      )}
      {...props}
    />
  );
}

interface FieldRenderProps {
  id: string;
  invalid: boolean;
  'aria-describedby': string | undefined;
}

interface FieldProps {
  label: string;
  /** Идентификатор поля; по нему же строятся id для подписи и текста ошибки. */
  id: string;
  error?: string;
  hint?: string;
  children: (props: FieldRenderProps) => ReactNode;
}

/**
 * Обёртка поля формы: подпись, подсказка и ошибка связаны с контролом
 * через id и aria-describedby — без ручной склейки атрибутов на стороне страницы.
 */
export function Field({ label, id, error, hint, children }: FieldProps) {
  const messageId = error ? `${id}-error` : hint ? `${id}-hint` : undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
        {label}
      </label>
      {children({ id, invalid: Boolean(error), 'aria-describedby': messageId })}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
      {!error && hint ? (
        <p id={`${id}-hint`} className="text-sm text-zinc-500 dark:text-zinc-400">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
