import { useId, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/i18n';

/** Поля настроек помощника и бота: страница решения и шаг 2 мастера. */

export const inputClass =
  'h-11 w-full rounded-xl border border-stroke bg-surface px-4 text-[16px] text-text placeholder:text-subtle focus:border-stroke-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40';
export const textareaClass =
  'block w-full resize-y rounded-xl border border-stroke bg-surface px-4 py-3 text-[16px] leading-6 text-text placeholder:text-subtle focus:border-stroke-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40';

export function Field({
  label,
  hint,
  max,
  value,
  children,
}: {
  label: string;
  hint?: string;
  max?: number;
  value: string;
  children: (props: { id: string; maxLength?: number; 'aria-describedby'?: string }) => ReactNode;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-[14px] font-medium text-text">
          {label}
        </label>
        {max ? (
          <span className="text-[12px] text-subtle tabular-nums">
            {value.length} / {max}
          </span>
        ) : null}
      </div>
      {hint ? (
        <p id={hintId} className="text-[13px] leading-5 text-subtle">
          {hint}
        </p>
      ) : null}
      {children({
        id,
        ...(max ? { maxLength: max } : {}),
        ...(hint ? { 'aria-describedby': hintId } : {}),
      })}
    </div>
  );
}

export function ListEditor<T>({
  title,
  hint,
  items,
  max,
  addLabel,
  onChange,
  render,
  empty,
}: {
  title: string;
  hint: string;
  items: T[];
  max: number;
  addLabel: string;
  onChange: (items: T[]) => void;
  render: (value: T, index: number, set: (value: T) => void) => ReactNode;
  empty: T;
}) {
  const { t } = useTranslation();
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-[14px] font-medium text-text">{title}</legend>
      <p className="text-[13px] leading-5 text-subtle">{hint}</p>
      {items.map((value, index) => (
        <div key={index} className="flex items-start gap-2">
          {render(value, index, (next) =>
            onChange(items.map((item, at) => (at === index ? next : item))),
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`${t('builder.remove')} ${index + 1}`}
            onClick={() => onChange(items.filter((_, at) => at !== index))}
          >
            {t('builder.remove')}
          </Button>
        </div>
      ))}
      {items.length < max ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() => onChange([...items, structuredClone(empty)])}
        >
          {addLabel}
        </Button>
      ) : null}
    </fieldset>
  );
}
