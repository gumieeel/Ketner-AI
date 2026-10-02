import { useState } from 'react';
import { CloseIcon, FolderIcon, GitHubIcon, PlusIcon } from '@/components/icons';
import { LinkWorkspaceModal } from './link-workspace-modal';
import { WorkspaceModal } from './workspace-modal';
import { useWorkspace } from '@/features/chat/workspace-store';

export function WorkspaceBar() {
  const activeWorkspace = useWorkspace((state) => state.activeWorkspace);
  const unlinkWorkspace = useWorkspace((state) => state.unlinkWorkspace);

  const [isLinkModalOpen, setIsLinkModalOpen] = useState(false);
  const [isViewModalOpen, setIsViewModalOpen] = useState(false);

  return (
    <>
      <div className="flex items-center gap-2 px-1 py-1">
        {activeWorkspace ? (
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
