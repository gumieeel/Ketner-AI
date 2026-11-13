import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
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

/** Положение кольца фокуса вокруг активной клетки (в координатах ряда). */
interface RingRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Код из письма — клетка под каждую цифру.
 *
 * Под клетками лежит одно настоящее поле ввода (прозрачное, поверх клеток): так работают вставка
 * кода целиком, автоподстановка из письма на телефоне (`one-time-code`), Backspace и экранные
 * читалки. Клетки только показывают состояние. Анимации — как в OTP-инпуте Family: фокус — это
 * «кольцо», которое с пружиной перелетает с клетки на клетку при вводе, а цифра выскакивает в
 * освободившейся клетке; при ошибке кольцо краснеет и обратным перелётом возвращается к первой
 * клетке, гася цифры по пути, а ряд встряхивается; во время проверки клетки бегут волной, при
 * успехе вспыхивают акцентом.
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
  const [ring, setRing] = useState<RingRect | null>(null);
  // Кольцо появилось сразу на своём месте; последующие перемещения — перелёты с пружиной.
  const [ringSettled, setRingSettled] = useState(false);

  const rowRef = useRef<HTMLDivElement>(null);
  const boxRefs = useRef<Array<HTMLDivElement | null>>([]);

  const activeIndex = Math.min(value.length, length - 1);
  // При ошибке кольцо возвращается к первой клетке — как будто ввод начинается заново.
  const ringIndex = status === 'error' ? 0 : activeIndex;
  const ringShown = focused && !disabled && (status === 'idle' || status === 'error');

  const measureRing = useCallback(() => {
    const box = boxRefs.current[ringIndex];
    if (!box || box.offsetWidth === 0) return;
    // Кольцо на 4px больше клетки, чтобы целиком накрыть её рамку.
    setRing((prev) => {
      const next = {
        x: box.offsetLeft - 4,
        y: box.offsetTop - 4,
        w: box.offsetWidth + 8,
        h: box.offsetHeight + 8,
      };
      return prev &&
        prev.x === next.x &&
        prev.y === next.y &&
        prev.w === next.w &&
        prev.h === next.h
        ? prev
        : next;
    });
  }, [ringIndex]);

  useLayoutEffect(() => {
    measureRing();
  }, [measureRing, value, status, focused]);

  // Клетки меняют размер при ресайзе окна — кольцо следует за активной клеткой.
  useEffect(() => {
    const row = rowRef.current;
    if (!row || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => measureRing());
    observer.observe(row);
    return () => observer.disconnect();
  }, [measureRing]);

  // Первый кадр — кольцо на месте без анимации, дальше летает.
  useEffect(() => {
    if (ring && !ringSettled) {
      const frame = requestAnimationFrame(() => setRingSettled(true));
      return () => cancelAnimationFrame(frame);
    }
  }, [ring, ringSettled]);

  // Каждая новая ошибка встряхивает ряд заново. Поле при этом не пересоздаётся и не теряет фокус.
  useEffect(() => {
    if (errorKey > 0) setShaking(true);
  }, [errorKey]);

  return (
    <div className="relative w-full">
      <div
        ref={rowRef}
        aria-hidden="true"
        className={cn(
          'relative flex justify-between gap-2 sm:gap-3',
          shaking && 'animate-code-shake',
        )}
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
                ref={(node) => {
                  boxRefs.current[index] = node;
                }}
                style={{
                  animationDelay:
                    status === 'verifying' || status === 'success' ? `${index * 70}ms` : undefined,
                }}
                className={cn(
                  'relative grid aspect-square max-h-16 w-full place-items-center rounded-xl border-2 bg-surface',
                  'font-mono text-[26px] font-semibold text-text tabular-nums sm:text-[28px]',
                  'transition-[border-color,box-shadow,background-color] duration-200 ease-[var(--ease-out-expo)]',
                  digit ? 'border-stroke-strong' : 'border-stroke',
                  status === 'verifying' && 'animate-code-wave border-accent/60',
                  status === 'success' && 'animate-code-success border-accent bg-accent-soft',
                  disabled && status === 'idle' && 'opacity-60',
                )}
              >
                {digit ? (
                  status === 'error' ? (
                    // Красное кольцо гасит цифры по очереди, пробегая ряд справа налево.
                    <span
                      key={`${index}-${digit}-clear`}
                      style={{ animationDelay: `${(length - 1 - index) * 55}ms` }}
                      className="animate-code-digit-clear text-danger"
                    >
                      {digit}
                    </span>
                  ) : (
                    <span key={`${index}-${digit}`} className="animate-code-pop">
                      {digit}
                    </span>
                  )
                ) : isActive ? (
                  <span className="h-7 w-0.5 rounded-full bg-accent animate-caret-blink" />
                ) : (
                  <span className="size-1.5 rounded-full bg-stroke-strong" />
                )}
              </div>
            </div>
          );
        })}

        {/* Летающее кольцо фокуса: один элемент на весь ряд, перелетает с клетки на клетку. */}
        {ring && (
          <div
            aria-hidden="true"
            className={cn(
              'pointer-events-none absolute top-0 left-0 z-10 transition-opacity duration-150',
              ringShown ? 'opacity-100' : 'opacity-0',
            )}
            style={{
              width: ring.w,
              height: ring.h,
              transform: `translate(${ring.x}px, ${ring.y}px)`,
              transition: ringSettled
                ? 'transform 420ms var(--ease-spring), opacity 150ms ease-out'
                : 'opacity 150ms ease-out',
            }}
          >
            {/* Пружина перелёта: кольцо раздувается в полёте и оседает на клетке.
                Ключ перезапускает анимацию на каждом перемещении и смене статуса. */}
            <div
              key={`${ringIndex}-${status}`}
              className={cn(
                'h-full w-full rounded-[24px] border-2 animate-code-ring',
                status === 'error'
                  ? 'border-danger shadow-[0_0_0_4px_var(--danger-soft)]'
                  : 'border-accent shadow-[0_0_0_4px_var(--accent-soft),0_8px_24px_-12px_var(--accent)]',
              )}
            />
          </div>
        )}
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
