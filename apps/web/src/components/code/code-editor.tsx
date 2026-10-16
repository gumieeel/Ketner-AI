import { useEffect, useMemo, useRef, type KeyboardEvent } from 'react';
import { cn } from '@/lib/cn';

interface CodeEditorProps {
  path: string;
  value: string;
  readOnly?: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
  className?: string;
}

/**
 * Редактор файла: textarea с номерами строк. Подсветки синтаксиса нет намеренно: правки идут
 * через агента, а ручной редактор нужен для быстрых исправлений. Tab вставляет отступ,
 * Ctrl/Cmd+S сохраняет.
 */
export function CodeEditor({
  path,
  value,
  readOnly,
  onChange,
  onSave,
  className,
}: CodeEditorProps) {
  const areaRef = useRef<HTMLTextAreaElement | null>(null);
  const gutterRef = useRef<HTMLPreElement | null>(null);

  const lineCount = useMemo(() => {
    let count = 1;
    for (let i = 0; i < value.length; i += 1) if (value.charCodeAt(i) === 10) count += 1;
    return count;
  }, [value]);

  const numbers = useMemo(
    () => Array.from({ length: lineCount }, (_, i) => i + 1).join('\n'),
    [lineCount],
  );

  useEffect(() => {
    if (areaRef.current) areaRef.current.scrollTop = 0;
    if (gutterRef.current) gutterRef.current.scrollTop = 0;
  }, [path]);

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      onSave();
      return;
    }
    if (event.key === 'Tab' && !event.shiftKey && !readOnly) {
      event.preventDefault();
      const area = event.currentTarget;
      const { selectionStart, selectionEnd } = area;
      const next = `${value.slice(0, selectionStart)}  ${value.slice(selectionEnd)}`;
      onChange(next);
      requestAnimationFrame(() => {
        area.selectionStart = area.selectionEnd = selectionStart + 2;
      });
    }
  };

  return (
    <div
      className={cn(
        'flex min-h-0 flex-1 overflow-hidden bg-canvas font-mono text-[13px] leading-5',
        className,
      )}
    >
      <pre
        ref={gutterRef}
        aria-hidden="true"
        className="m-0 w-12 shrink-0 select-none overflow-hidden border-r border-stroke bg-surface py-3 pr-2 text-right text-subtle"
      >
        {numbers}
      </pre>
      <textarea
        ref={areaRef}
        value={value}
        readOnly={readOnly}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        wrap="off"
        aria-label={path}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        onScroll={(event) => {
          if (gutterRef.current) gutterRef.current.scrollTop = event.currentTarget.scrollTop;
        }}
        className="min-w-0 flex-1 resize-none overflow-auto whitespace-pre bg-transparent py-3 pl-3 pr-4 text-text outline-none [tab-size:2]"
      />
    </div>
  );
}
