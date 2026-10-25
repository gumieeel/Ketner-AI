import { useState } from 'react';
import { CodeIcon, FileTextIcon, FolderIcon, GitHubIcon, SearchIcon, TrashIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Modal, ModalHeader } from '@/components/ui/modal';
import { formatFileSize, getFileExtension } from '@/features/chat/attachment-utils';
import { useChat } from '@/features/chat/chat-store';
import type { WorkspaceFile } from '@/features/chat/types';
import { useWorkspace } from '@/features/chat/workspace-store';
import { useTranslation } from '@/i18n';
import { cn } from '@/lib/cn';

interface WorkspaceModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function WorkspaceModal({ isOpen, onClose }: WorkspaceModalProps) {
  const { t } = useTranslation();
  const activeWorkspace = useWorkspace((state) => state.activeWorkspace);
  const unlinkWorkspace = useWorkspace((state) => state.unlinkWorkspace);
  const setDraft = useChat((state) => state.setDraft);

  const [search, setSearch] = useState('');
  const [selectedFile, setSelectedFile] = useState<WorkspaceFile | null>(null);

  if (!isOpen || !activeWorkspace) return null;

  const filteredFiles = activeWorkspace.files.filter((file) =>
    file.path.toLowerCase().includes(search.toLowerCase()),
  );

  const handleAskAboutFile = (file: WorkspaceFile) => {
    setDraft(t('wsView.askDraft', { path: file.path, name: activeWorkspace.name }));
    onClose();
  };

  const handleUnlink = () => {
    unlinkWorkspace();
    onClose();
  };

  return (
    <Modal labelledBy="workspace-modal-title" onClose={onClose} size="lg" className="h-[85dvh]">
      {/* Шапка модального окна */}
      <ModalHeader
        titleId="workspace-modal-title"
        icon={
          activeWorkspace.type === 'git_repo' ? <GitHubIcon className="size-5" /> : <FolderIcon className="size-5" />
        }
        title={
          <span className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="min-w-0 break-all">{activeWorkspace.name}</span>
            <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent">
              {activeWorkspace.type === 'git_repo' ? t('linkWs.tabGit') : t('linkWs.tabFolder')}
            </span>
            {activeWorkspace.branch ? (
              <span className="rounded-full border border-stroke px-2 py-0.5 font-mono text-[11px] font-normal text-muted">
                {activeWorkspace.branch}
              </span>
            ) : null}
          </span>
        }
        description={t('wsView.indexed', { count: activeWorkspace.filesCount })}
        actions={
          <Button
            variant="ghost"
            size="sm"
            onClick={handleUnlink}
            className="text-danger hover:bg-danger-soft hover:text-danger"
          >
            <TrashIcon className="size-3.5" />
            <span className="max-sm:sr-only">{t('wsView.unlink')}</span>
          </Button>
        }
        onClose={onClose}
      />

      {/* Тело: список файлов слева, просмотр содержимого справа */}
      <div className="flex min-h-0 flex-1">
        {/* Левая панель: поиск и список файлов */}
        <div className={cn('flex w-full flex-col bg-surface sm:w-80 sm:shrink-0 sm:border-r sm:border-stroke', selectedFile && 'max-sm:hidden')}>
          <div className="border-b border-stroke p-3">
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
              <input
                type="search"
                aria-label={t('wsView.searchPlaceholder')}
                placeholder={t('wsView.searchPlaceholder')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-10 w-full rounded-xl border border-stroke bg-canvas pr-3 pl-9 text-sm text-text outline-none transition-[border-color,box-shadow] placeholder:text-subtle focus:border-accent/60 focus:ring-4 focus:ring-accent-soft max-md:h-11"
              />
            </div>
          </div>

          <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-2">
            {filteredFiles.length === 0 ? (
              <div className="p-6 text-center text-[13px] text-muted">{t('wsView.notFound')}</div>
            ) : (
              filteredFiles.map((file) => {
                const ext = getFileExtension(file.path).toUpperCase();
                const isSelected = selectedFile?.path === file.path;

                return (
                  <button
                    key={file.path}
                    type="button"
                    aria-current={isSelected}
                    onClick={() => setSelectedFile(file)}
                    className={cn(
                      'flex min-h-10 w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs transition-colors max-md:min-h-11',
                      isSelected ? 'bg-accent-soft font-medium text-accent' : 'text-text hover:bg-surface-2',
                    )}
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <FileTextIcon className="size-3.5 shrink-0 text-subtle" />
                      <span className="truncate">{file.path}</span>
                    </div>
                    <span className="ml-2 shrink-0 font-mono text-[11px] text-subtle">
                      {ext || formatFileSize(file.size)}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Правая панель: просмотр файла */}
        <div className={cn('min-h-0 min-w-0 flex-1 flex-col bg-surface-2/40', selectedFile ? 'flex' : 'flex max-sm:hidden')}>
          {selectedFile ? (
            <div className="flex h-full min-h-0 flex-col">
              <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-stroke bg-surface px-4 py-2.5 text-xs">
                <div className="flex min-w-0 items-center gap-2">
                  <CodeIcon className="size-4 shrink-0 text-accent" />
                  <span className="truncate font-mono font-medium text-text">{selectedFile.path}</span>
                  <span className="shrink-0 text-muted">({formatFileSize(selectedFile.size)})</span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={t('wsView.back')}
                    onClick={() => setSelectedFile(null)}
                    className="sm:hidden"
                  >
                    ←
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => handleAskAboutFile(selectedFile)}>
                    {t('wsView.ask')}
                  </Button>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-auto bg-canvas p-4 font-mono text-xs text-text">
                {selectedFile.content ? (
                  <pre className="leading-relaxed whitespace-pre-wrap">{selectedFile.content}</pre>
                ) : (
                  <div className="flex h-full items-center justify-center text-center text-muted">
                    {t('wsView.noContent')}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center p-6 text-center">
              <span className="mb-3 grid size-12 place-items-center rounded-2xl bg-accent-soft text-accent ring-1 ring-accent/20">
                <CodeIcon className="size-6" />
              </span>
              <p className="text-sm font-medium text-text">{t('wsView.pick')}</p>
              <p className="mt-1 max-w-sm text-xs leading-5 text-muted">{t('wsView.pickHint')}</p>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
