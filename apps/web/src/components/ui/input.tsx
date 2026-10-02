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
        'h-12 text-base w-full rounded-md border border-stroke bg-surface px-3 text-base text-text placeholder:text-subtle transition-colors',
        'hover:border-stroke-strong focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent-soft',
        'disabled:cursor-not-allowed disabled:opacity-60',
        invalid && 'border-danger focus:border-danger focus:ring-danger-soft',
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
      <label htmlFor={id} className="text-[13px] font-medium text-text">
        {label}
      </label>
      {children({ id, invalid: Boolean(error), 'aria-describedby': messageId })}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      ) : null}
      {!error && hint ? (
        <p id={`${id}-hint`} className="text-[13px] text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
