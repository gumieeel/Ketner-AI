import { useEffect, useState } from 'react';
import { cn } from '@/lib/cn';

export type CodeInputStatus = 'idle' | 'verifying' | 'error' | 'success';

export interface CodeInputProps {
  id: string;
  value: string;
  onChange: (digits: string) => void;
  /** Введены все цифры (набраны или вставлены). */
  onComplete?: (digits: string) => void;
  length?: number;
  status?: CodeInputStatus;
  /** Меняется при каждой ошибке — клетки встряхиваются заново. */
  errorKey?: number;
  disabled?: boolean;
  /** Ввод временно не принимается (идёт проверка), но поле не теряет фокус. */
  readOnly?: boolean;
  autoFocus?: boolean;
  'aria-describedby'?: string;
}

/**
 * Код из письма — клетка под каждую цифру.
 *
 * Под клетками лежит одно настоящее поле ввода (прозрачное, поверх клеток): так работают вставка
 * кода целиком, автоподстановка из письма на телефоне (`one-time-code`), Backspace и экранные
 * читалки. Клетки только показывают состояние: появляются по очереди, цифра «выпрыгивает»,
 * активная клетка подсвечена и мигает курсором, при ошибке ряд встряхивается, во время проверки
 * клетки бегут волной, при успехе вспыхивают акцентом.
 */
export function CodeInput({
  id,
  value,
  onChange,
  onComplete,
  length = 6,
  status = 'idle',
  errorKey = 0,
  disabled,
  readOnly,
  autoFocus,
  'aria-describedby': describedBy,
}: CodeInputProps) {
  const [focused, setFocused] = useState(false);
  const [shaking, setShaking] = useState(false);
  const activeIndex = Math.min(value.length, length - 1);

  // Каждая новая ошибка встряхивает ряд заново. Поле при этом не пересоздаётся и не теряет фокус.
  useEffect(() => {
    if (errorKey > 0) setShaking(true);
  }, [errorKey]);

  return (
    <div className="relative w-full">
      <div
        aria-hidden="true"
        className={cn('flex justify-between gap-2 sm:gap-3', shaking && 'animate-code-shake')}
        onAnimationEnd={(event) => {
          if (event.animationName === 'codeShake') setShaking(false);
        }}
      >
        {Array.from({ length }, (_, index) => {
          const digit = value[index] ?? '';
          const isActive =
            focused && !disabled && !readOnly && index === activeIndex && status === 'idle';
          return (
            <div
              key={index}
              style={{ animationDelay: `${index * 55}ms` }}
              className="flex-1 animate-code-box-in"
            >
              <div
                style={{
                  animationDelay:
                    status === 'verifying' || status === 'success' ? `${index * 70}ms` : undefined,
                }}
                className={cn(
                  'relative grid aspect-square max-h-16 w-full place-items-center rounded-xl border-2 bg-surface',
                  'font-mono text-[26px] font-semibold text-text tabular-nums sm:text-[28px]',
                  'transition-[border-color,box-shadow,background-color,transform] duration-200 ease-[var(--ease-out-expo)]',
                  digit ? 'border-stroke-strong' : 'border-stroke',
                  isActive &&
                    '-translate-y-0.5 border-accent shadow-[0_0_0_4px_var(--accent-soft),0_8px_24px_-12px_var(--accent)]',
                  status === 'error' && 'border-danger bg-danger-soft text-danger',
                  status === 'verifying' && 'animate-code-wave border-accent/60',
                  status === 'success' && 'animate-code-success border-accent bg-accent-soft',
                  disabled && status === 'idle' && 'opacity-60',
                )}
              >
                {digit ? (
                  <span key={`${index}-${digit}`} className="animate-code-pop">
                    {digit}
                  </span>
                ) : isActive ? (
                  <span className="h-7 w-0.5 rounded-full bg-accent animate-caret-blink" />
                ) : (
                  <span className="size-1.5 rounded-full bg-stroke-strong" />
                )}
              </div>
            </div>
          );
        })}
      </div>

      <input
        id={id}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="one-time-code"
        autoFocus={autoFocus}
        maxLength={length}
        value={value}
        disabled={disabled}
        readOnly={readOnly}
        aria-describedby={describedBy}
        aria-invalid={status === 'error' || undefined}
        className="absolute inset-0 h-full w-full cursor-text rounded-xl bg-transparent text-base text-transparent caret-transparent outline-none selection:bg-transparent disabled:cursor-not-allowed"
        onFocus={(event) => {
          setFocused(true);
          const end = event.currentTarget.value.length;
          event.currentTarget.setSelectionRange(end, end);
        }}
        onBlur={() => setFocused(false)}
        // Курсор всегда в конце: цифры вводятся и стираются по порядку, как в клетках.
        onSelect={(event) => {
          const end = event.currentTarget.value.length;
          if (event.currentTarget.selectionStart !== end) {
            event.currentTarget.setSelectionRange(end, end);
          }
        }}
        onChange={(event) => {
          const digits = event.target.value.replace(/\D/g, '').slice(0, length);
          onChange(digits);
          if (digits.length === length) onComplete?.(digits);
        }}
      />
    </div>
  );
}
