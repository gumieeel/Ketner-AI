import { cn } from '@/lib/cn';

/** Показывает патч агента: строки с префиксом `+` зелёным, `-` красным, `@@` — заголовки блоков. */
export function DiffView({ patch, className }: { patch: string; className?: string }) {
  const lines = patch.split('\n');
  return (
    <pre
      className={cn(
        'max-h-72 overflow-auto rounded-lg border border-stroke bg-canvas py-1.5 font-mono text-[12px] leading-[18px]',
        className,
      )}
    >
      {lines.map((line, index) => {
        const kind = line.startsWith('@@') ? 'hunk' : line[0] === '+' ? 'add' : line[0] === '-' ? 'del' : 'ctx';
        return (
          <div
            key={index}
            data-diff={kind}
            className={cn(
              'min-w-max whitespace-pre px-3',
              kind === 'add' && 'bg-success-soft text-success',
              kind === 'del' && 'bg-danger-soft text-danger',
              kind === 'hunk' && 'text-subtle',
              kind === 'ctx' && 'text-muted',
            )}
          >
            {line || ' '}
          </div>
        );
      })}
    </pre>
  );
}
