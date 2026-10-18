import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CodeInput } from '@/components/auth/code-input';

describe('CodeInput: клетки под цифры кода', () => {
  it('клетка под каждую цифру; вставка с пробелами и буквами даёт чистый код', () => {
    const onChange = vi.fn();
    const onComplete = vi.fn();
    const { container } = render(
      <>
        <label htmlFor="code">Код</label>
        <CodeInput id="code" value="" onChange={onChange} onComplete={onComplete} />
      </>,
    );
    expect(container.querySelectorAll('.aspect-square')).toHaveLength(6);

    const input = screen.getByLabelText('Код') as HTMLInputElement;
    expect(input).toHaveAttribute('autocomplete', 'one-time-code');
    expect(input).toHaveAttribute('inputmode', 'numeric');

    fireEvent.change(input, { target: { value: '12 34-5a6' } });
    expect(onChange).toHaveBeenLastCalledWith('123456');
    expect(onComplete).toHaveBeenCalledWith('123456');
  });

  it('неполный код не завершает ввод; цифры видны в своих клетках', () => {
    const onComplete = vi.fn();
    const { container } = render(
      <CodeInput id="code" value="482" onChange={() => undefined} onComplete={onComplete} />,
    );
    const boxes = [...container.querySelectorAll('.aspect-square')].map((box) => box.textContent);
    expect(boxes).toEqual(['4', '8', '2', '', '', '']);
    expect(onComplete).not.toHaveBeenCalled();
  });
});
