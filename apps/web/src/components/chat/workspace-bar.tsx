import { useState } from 'react';
import { CloseIcon, FolderIcon, GitHubIcon, PlusIcon } from '@/components/icons';
import { LinkWorkspaceModal } from './link-workspace-modal';
import { WorkspaceModal } from './workspace-modal';
import { useWorkspace } from '@/features/chat/workspace-store';
import { cn } from '@/lib/cn';

export function WorkspaceBar() {
  const activeWorkspace = useWorkspace((state) => state.activeWorkspace);
  const unlinkWorkspace = useWorkspace((state) => state.unlinkWorkspace);
  const autoApply = useWorkspace((state) => state.autoApply);
  const setAutoApply = useWorkspace((state) => state.setAutoApply);

  const [isLinkModalOpen, setIsLinkModalOpen] = useState(false);
  const [isViewModalOpen, setIsViewModalOpen] = useState(false);

  return (
    <>
      <div className="flex items-center gap-2 px-1 py-1">
        {activeWorkspace ? (
          <>
            <div className="flex items-center gap-1.5 rounded-lg border border-stroke bg-surface-2/80 px-2.5 py-1 text-xs text-text shadow-sm backdrop-blur transition hover:border-stroke-strong">
              <button
                type="button"
                onClick={() => setIsViewModalOpen(true)}
                className="flex items-center gap-1.5 text-left font-medium text-text hover:text-accent transition"
                title="Открыть файлы проекта"
              >
                <span className="flex size-4 items-center justify-center text-accent">
                  {activeWorkspace.type === 'git_repo' ? (
                    <GitHubIcon className="size-3.5" />
                  ) : (
                    <FolderIcon className="size-3.5" />
                  )}
                </span>
                <span className="truncate max-w-[160px] sm:max-w-[240px] font-mono text-[11px]">
                  {activeWorkspace.name}
                </span>
                <span className="rounded-full bg-accent-soft px-1.5 py-0.2 text-[10px] font-medium text-accent">
                  {activeWorkspace.filesCount} файлов
                </span>
              </button>

              <button
                type="button"
                onClick={unlinkWorkspace}
                className="ml-1 inline-flex size-4 items-center justify-center rounded-full text-muted transition hover:bg-surface hover:text-text"
                aria-label="Отвязать проект"
                title="Отвязать проект"
              >
                <CloseIcon className="size-2.5" />
              </button>
            </div>

            <button
              type="button"
              onClick={() => setAutoApply(!autoApply)}
              className={cn(
                'flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-mono transition shadow-sm',
                autoApply
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400 font-semibold'
                  : 'border-stroke bg-surface-2/70 text-muted hover:border-stroke-strong hover:text-text',
              )}
              title={
                autoApply
                  ? 'Авто-запись включена: правки кода сразу сохраняются на диск'
                  : 'Нажмите, чтобы включить автоматическое сохранение правок кода без подтверждения'
              }
            >
              <span
                className={cn(
                  'size-1.5 rounded-full',
                  autoApply ? 'bg-emerald-400 animate-pulse' : 'bg-muted',
                )}
              />
              <span>{autoApply ? '⚡ Авто-запись: ВКЛ' : 'Авто-запись: ВЫКЛ'}</span>
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setIsLinkModalOpen(true)}
            className="flex items-center gap-1.5 rounded-lg border border-dashed border-stroke bg-transparent px-2.5 py-1 text-xs text-muted transition hover:border-accent hover:text-text hover:bg-surface/50"
            title="Привязать локальную папку или Git-репозиторий"
          >
            <PlusIcon className="size-3 text-accent" />
            <span>Привязать папку / репо</span>
          </button>
        )}
      </div>

      <LinkWorkspaceModal
        isOpen={isLinkModalOpen}
        onClose={() => setIsLinkModalOpen(false)}
      />

      <WorkspaceModal
        isOpen={isViewModalOpen}
        onClose={() => setIsViewModalOpen(false)}
      />
    </>
  );
}
