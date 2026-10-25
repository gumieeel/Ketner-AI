import { useState } from 'react';
import { BoltIcon, CloseIcon, FolderIcon, GitHubIcon } from '@/components/icons';
import { WorkspaceModal } from './workspace-modal';
import { useWorkspace } from '@/features/chat/workspace-store';
import { useTranslation } from '@/i18n';
import { cn } from '@/lib/cn';

export function WorkspaceBar() {
  const { t } = useTranslation();
  const activeWorkspace = useWorkspace((state) => state.activeWorkspace);
  const unlinkWorkspace = useWorkspace((state) => state.unlinkWorkspace);
  const autoApply = useWorkspace((state) => state.autoApply);
  const setAutoApply = useWorkspace((state) => state.setAutoApply);

  const [isViewModalOpen, setIsViewModalOpen] = useState(false);

  // Без привязанной папки полоса не показывается: привязать можно через скрепку в поле ввода.
  if (!activeWorkspace) {
    return null;
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 px-0.5">
        {activeWorkspace ? (
          <>
            <div className="flex min-h-9 items-center rounded-xl border border-stroke bg-surface-2/70 pl-1 text-xs text-text shadow-sm transition-colors hover:border-stroke-strong max-md:min-h-11">
              <button
                type="button"
                onClick={() => setIsViewModalOpen(true)}
                className="flex min-h-9 items-center gap-1.5 rounded-lg px-1.5 text-left font-medium text-text transition-colors hover:text-accent max-md:min-h-11"
                title={t('workspace.openFiles')}
              >
                <span className="flex size-4 items-center justify-center text-accent">
                  {activeWorkspace.type === 'git_repo' ? (
                    <GitHubIcon className="size-3.5" />
                  ) : (
                    <FolderIcon className="size-3.5" />
                  )}
                </span>
                <span className="max-w-[130px] truncate font-mono text-[11px] sm:max-w-[240px]">
                  {activeWorkspace.name}
                </span>
                <span className="rounded-xs bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent">
                  {t('workspace.filesCount', { count: activeWorkspace.filesCount })}
                </span>
              </button>

              <button
                type="button"
                onClick={unlinkWorkspace}
                className="mx-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-3 hover:text-text max-md:size-10"
                aria-label={t('workspace.unlink')}
                title={t('workspace.unlink')}
              >
                <CloseIcon className="size-3" />
              </button>
            </div>

            <button
              type="button"
              onClick={() => setAutoApply(!autoApply)}
              aria-pressed={autoApply}
              className={cn(
                'inline-flex min-h-9 items-center gap-1.5 rounded-xl border px-3 text-[11px] font-medium shadow-sm transition-colors max-md:min-h-11',
                autoApply
                  ? 'border-success/40 bg-success-soft font-semibold text-success'
                  : 'border-stroke bg-surface-2/70 text-muted hover:border-stroke-strong hover:text-text',
              )}
              title={autoApply ? t('workspace.autoOnHint') : t('workspace.autoOffHint')}
            >
              {autoApply ? (
                <BoltIcon className="size-3.5" />
              ) : (
                <span aria-hidden="true" className="size-1.5 rounded-full bg-subtle" />
              )}
              <span>{autoApply ? t('workspace.autoOn') : t('workspace.autoOff')}</span>
            </button>
          </>
        ) : null}
      </div>

      <WorkspaceModal isOpen={isViewModalOpen} onClose={() => setIsViewModalOpen(false)} />
    </>
  );
}
