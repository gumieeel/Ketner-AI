import { useState } from 'react';
import { CloseIcon, CodeIcon, CopyIcon, CheckIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { generateLineDiff, type DiffLine } from '@/features/chat/file-operations';
import type { FileChangeItem } from '@/features/chat/types';
import { cn } from '@/lib/cn';

interface FileDiffModalProps {
  isOpen: boolean;
  onClose: () => void;
  changes: FileChangeItem[];
  initialFileIndex?: number;
}

export function FileDiffModal({
  isOpen,
  onClose,
  changes,
  initialFileIndex = 0,
}: FileDiffModalProps) {
  const [selectedIndex, setSelectedIndex] = useState(initialFileIndex);
  const [copied, setCopied] = useState(false);

  if (!isOpen || changes.length === 0) return null;

  const currentChange = changes[selectedIndex] || changes[0];
  const original = currentChange.originalContent || '';
  const modified = currentChange.modifiedContent ?? currentChange.content ?? '';

  const diffResult = generateLineDiff(original, modified, currentChange.path);

  const handleCopyNewContent = () => {
    navigator.clipboard.writeText(modified);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 sm:p-6 backdrop-blur-sm animate-in fade-in duration-200"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex h-[90vh] w-full max-w-5xl flex-col rounded-2xl border border-stroke bg-canvas shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-stroke bg-surface px-5 py-3.5">
          <div className="flex items-center gap-3">
            <span className="flex size-8 items-center justify-center rounded-lg bg-accent-soft text-accent">
              <CodeIcon className="size-4" />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-mono text-sm font-semibold text-text">{currentChange.path}</h3>
                <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-mono text-muted">
                  {currentChange.action.toUpperCase()}
                </span>
              </div>
              <div className="flex items-center gap-3 text-xs text-muted mt-0.5">
                <span className="text-emerald-500 font-mono">+{diffResult.additions} строк</span>
                <span className="text-rose-500 font-mono">-{diffResult.deletions} строк</span>
                {currentChange.description && (
                  <span className="truncate max-w-sm text-subtle">• {currentChange.description}</span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleCopyNewContent}
              className="gap-1.5 text-xs font-medium"
            >
              {copied ? <CheckIcon className="size-3.5 text-emerald-500" /> : <CopyIcon className="size-3.5" />}
              {copied ? 'Скопировано' : 'Копировать код'}
            </Button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-text transition"
              title="Закрыть"
            >
              <CloseIcon className="size-4" />
            </button>
          </div>
        </div>

        {/* Content body: Sidebar with file list + Diff code area */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* File selector sidebar (if multiple files) */}
          {changes.length > 1 && (
            <div className="w-56 shrink-0 border-r border-stroke bg-surface/40 p-2 overflow-y-auto hidden sm:block">
              <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted">
                Файлы ({changes.length})
              </div>
              <div className="mt-1 space-y-1">
                {changes.map((c, idx) => (
                  <button
                    key={c.path}
                    type="button"
                    onClick={() => setSelectedIndex(idx)}
                    className={cn(
                      'w-full text-left rounded-lg px-2.5 py-1.5 text-xs font-mono transition flex flex-col',
                      selectedIndex === idx
                        ? 'bg-accent-soft text-accent font-semibold border border-accent/20'
                        : 'text-text hover:bg-surface-2',
                    )}
                  >
                    <span className="truncate">{c.path.split('/').pop()}</span>
                    <span className="text-[10px] text-muted truncate">{c.path}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Unified Diff Area */}
          <div className="flex-1 overflow-auto bg-canvas font-mono text-xs leading-5">
            <div className="min-w-full inline-block">
              {diffResult.lines.map((line: DiffLine, idx: number) => {
                const isAdd = line.type === 'add';
                const isDelete = line.type === 'delete';

                return (
                  <div
                    key={idx}
                    className={cn(
                      'flex items-start px-2 py-0.5 select-text transition-colors',
                      isAdd && 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/15',
                      isDelete && 'bg-rose-500/10 text-rose-400 hover:bg-rose-500/15',
                      !isAdd && !isDelete && 'text-text/80 hover:bg-surface-2/40',
                    )}
                  >
                    {/* Line numbers */}
                    <div className="w-16 shrink-0 flex justify-between pr-3 select-none text-[10px] text-muted/60 font-mono">
                      <span className="w-7 text-right">{line.oldLineNumber ?? ''}</span>
                      <span className="w-7 text-right">{line.newLineNumber ?? ''}</span>
                    </div>

                    {/* Diff indicator (+/-/space) */}
                    <span
                      className={cn(
                        'w-4 shrink-0 font-bold select-none text-center',
                        isAdd && 'text-emerald-500',
                        isDelete && 'text-rose-500',
                        !isAdd && !isDelete && 'text-muted/40',
                      )}
                    >
                      {isAdd ? '+' : isDelete ? '-' : ' '}
                    </span>

                    {/* Code text */}
                    <pre className="flex-1 whitespace-pre-wrap break-all font-mono">
                      {line.text || ' '}
                    </pre>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
