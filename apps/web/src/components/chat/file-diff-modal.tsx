import { useState } from 'react';
import { CodeIcon, CopyIcon, CheckIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Modal, ModalHeader } from '@/components/ui/modal';
import { generateLineDiff, type DiffLine } from '@/features/chat/file-operations';
import type { FileChangeItem } from '@/features/chat/types';
import { useTranslation } from '@/i18n';
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
  const { t } = useTranslation();
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
    <Modal labelledBy="file-diff-title" onClose={onClose} size="xl" className="h-[90dvh]">
      <ModalHeader
        titleId="file-diff-title"
        icon={<CodeIcon className="size-5" />}
        title={
          <span className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="min-w-0 font-mono text-sm break-all">{currentChange.path}</span>
            <span className="rounded-full bg-surface-2 px-2 py-0.5 font-mono text-[11px] font-medium text-muted">
              {currentChange.action.toUpperCase()}
            </span>
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
            <span className="font-mono text-success">{t('diff.added', { count: diffResult.additions })}</span>
            <span className="font-mono text-danger">{t('diff.removed', { count: diffResult.deletions })}</span>
            {currentChange.description && (
              <span className="min-w-0 truncate text-subtle">• {currentChange.description}</span>
            )}
          </span>
        }
        actions={
          <Button variant="outline" size="sm" onClick={handleCopyNewContent} className="mr-1">
            {copied ? <CheckIcon className="size-3.5 text-success" /> : <CopyIcon className="size-3.5" />}
            <span className="max-sm:sr-only">{copied ? t('diff.copied') : t('diff.copy')}</span>
          </Button>
        }
        onClose={onClose}
      />

      {/* Content body: Sidebar with file list + Diff code area */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* File selector sidebar (if multiple files) */}
        {changes.length > 1 && (
          <div className="hidden w-56 shrink-0 overflow-y-auto border-r border-stroke bg-surface-2/40 p-2 sm:block">
            <div className="px-2 py-1.5 text-xs font-semibold text-subtle">
              {t('diff.files', { count: changes.length })}
            </div>
            <div className="mt-1 space-y-1">
              {changes.map((c, idx) => (
                <button
                  key={c.path}
                  type="button"
                  aria-current={selectedIndex === idx}
                  onClick={() => setSelectedIndex(idx)}
                  className={cn(
                    'flex w-full flex-col rounded-lg border px-2.5 py-1.5 text-left font-mono text-xs transition-colors',
                    selectedIndex === idx
                      ? 'border-accent/25 bg-accent-soft font-semibold text-accent'
                      : 'border-transparent text-text hover:bg-surface-2',
                  )}
                >
                  <span className="truncate">{c.path.split('/').pop()}</span>
                  <span className="truncate text-[11px] font-normal text-muted">{c.path}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Unified Diff Area */}
        <div tabIndex={0} className="flex-1 overflow-auto bg-canvas font-mono text-xs leading-5 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent">
          <div className="inline-block min-w-full">
            {diffResult.lines.map((line: DiffLine, idx: number) => {
              const isAdd = line.type === 'add';
              const isDelete = line.type === 'delete';

              return (
                <div
                  key={idx}
                  className={cn(
                    'flex items-start px-2 py-0.5 select-text transition-colors',
                    isAdd && 'bg-success-soft text-success hover:bg-success-soft',
                    isDelete && 'bg-danger-soft text-danger hover:bg-danger-soft',
                    !isAdd && !isDelete && 'text-text hover:bg-surface-2/50',
                  )}
                >
                  {/* Line numbers */}
                  <div aria-hidden="true" className="flex w-16 shrink-0 select-none justify-between pr-3 font-mono text-[11px] text-subtle">
                    <span className="w-7 text-right">{line.oldLineNumber ?? ''}</span>
                    <span className="w-7 text-right">{line.newLineNumber ?? ''}</span>
                  </div>

                  {/* Diff indicator (+/-/space) */}
                  <span
                    aria-hidden="true"
                    className={cn(
                      'w-4 shrink-0 select-none text-center font-bold',
                      !isAdd && !isDelete && 'text-subtle',
                    )}
                  >
                    {isAdd ? '+' : isDelete ? '−' : ' '}
                  </span>

                  {/* Code text */}
                  <pre className="flex-1 font-mono break-all whitespace-pre-wrap">{line.text || ' '}</pre>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </Modal>
  );
}
