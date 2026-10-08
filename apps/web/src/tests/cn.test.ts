import { describe, expect, it } from 'vitest';
import { cn } from '@/lib/cn';

describe('cn: слияние классов', () => {
  it('отбрасывает пустые значения и сохраняет порядок', () => {
    expect(cn('a', false, null, undefined, 'b')).toBe('a b');
  });

  it('последний класс группы переопределяет предыдущий', () => {
    expect(cn('rounded-md text-muted', 'rounded-xl text-danger')).toBe('rounded-xl text-danger');
    expect(cn('relative size-9', 'absolute size-11')).toBe('absolute size-11');
    expect(cn('text-[12px] px-2.5 py-0.5', 'text-[10px] px-1 py-0')).toBe('text-[10px] px-1 py-0');
  });

  it('учитывает варианты: hover и базовое состояние не конфликтуют', () => {
    expect(cn('text-muted hover:text-text', 'text-danger hover:text-danger')).toBe(
      'text-danger hover:text-danger',
    );
    expect(cn('hover:text-text', 'text-danger')).toBe('hover:text-text text-danger');
    expect(cn('w-full', 'max-sm:w-full')).toBe('w-full max-sm:w-full');
  });

  it('внешние отступы переопределяются, отрицательные — отдельный класс', () => {
    expect(cn('mt-10 mb-4 first:mt-0', 'mt-0 mb-0')).toBe('first:mt-0 mt-0 mb-0');
    expect(cn('mx-auto', 'mx-4')).toBe('mx-4');
    expect(cn('-mx-4', 'mx-4')).toBe('-mx-4 mx-4');
  });

  it('размер и цвет текста — разные группы', () => {
    expect(cn('text-sm text-muted', 'text-accent')).toBe('text-sm text-accent');
    expect(cn('text-sm', 'text-xs')).toBe('text-xs');
  });

  it('не трогает собственные и незнакомые классы', () => {
    expect(cn('surface-glass bg-surface', 'bg-surface-2/95 text-shimmer text-gradient')).toBe(
      'surface-glass bg-surface bg-surface-2/95 text-shimmer text-gradient',
    );
    expect(cn('text-pretty text-left', 'text-balance')).toBe('text-pretty text-left text-balance');
  });

  it('не заходит внутрь произвольных значений', () => {
    expect(cn('[mask-image:linear-gradient(to_bottom,black,transparent)]', 'text-text')).toBe(
      '[mask-image:linear-gradient(to_bottom,black,transparent)] text-text',
    );
  });
});
