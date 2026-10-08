import type { ReactNode } from 'react';
import { Kbd } from './kbd';

/**
 * Лёгкая разметка внутри переводимых строк, чтобы не дробить предложение на части:
 * `код`, **жирный** и [[Клавиша]]. Всё остальное выводится как обычный текст.
 */
const TOKEN = /(\*\*[^*]+\*\*|`[^`]+`|\[\[[^\]]+\]\])/g;

export function RichText({ text }: { text: string }): ReactNode {
  const parts = text.split(TOKEN);

  return (
    <>
      {parts.map((part, index) => {
        if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
          return (
            <strong key={index} className="font-semibold text-text">
              {part.slice(2, -2)}
            </strong>
          );
        }
        if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
          return (
            <code key={index} className="font-mono text-[0.92em] text-text break-words">
              {part.slice(1, -1)}
            </code>
          );
        }
        if (part.startsWith('[[') && part.endsWith(']]')) {
          return <Kbd key={index}>{part.slice(2, -2)}</Kbd>;
        }
        return part;
      })}
    </>
  );
}
