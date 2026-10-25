import { useEffect, useRef, useState } from 'react';
import { GithubRepoPicker, type PickedRepo } from '@/components/github/github-repo-picker';
import { FolderIcon, GitHubIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Modal, ModalHeader } from '@/components/ui/modal';
import { fetchGitHubRepo } from '@/features/chat/git-repo-reader';
import { pickFolderNative, readFolderFromFiles } from '@/features/chat/local-folder-reader';
import { useWorkspace } from '@/features/chat/workspace-store';
import { useTranslation } from '@/i18n';
import { cn } from '@/lib/cn';

export type LinkWorkspaceTab = 'folder' | 'git';

interface LinkWorkspaceModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Какую вкладку открыть: пункт меню «Папка» или «GitHub». */
  initialTab?: LinkWorkspaceTab;
}

export function LinkWorkspaceModal({
  isOpen,
  onClose,
  initialTab = 'folder',
}: LinkWorkspaceModalProps) {
  const { t } = useTranslation();
  const setWorkspace = useWorkspace((state) => state.setWorkspace);
  const [tab, setTab] = useState<LinkWorkspaceTab>(initialTab);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setTab(initialTab);
      setError(null);
    }
  }, [isOpen, initialTab]);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  if (!isOpen) return null;

  // 1. Привязка локальной папки
  const handleLinkLocalFolder = async () => {
    setError(null);
    setLoading(true);
    try {
      // Сначала пробуем современный native API
      const ws = await pickFolderNative();
      setWorkspace(ws);
      setLoading(false);
      onClose();
    } catch (err) {
      if (err instanceof Error && err.message === 'showDirectoryPicker_not_supported') {
        // Fallback к input webkitdirectory
        fileInputRef.current?.click();
      } else if (err instanceof Error && err.name === 'AbortError') {
        // Пользователь отменил диалог
        setLoading(false);
      } else {
        // Пробуем фоллбек через input
        fileInputRef.current?.click();
      }
    }
  };

  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) {
      setLoading(false);
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const ws = await readFolderFromFiles(files);
      setWorkspace(ws);
      setLoading(false);
      onClose();
    } catch (err) {
      setError((err instanceof Error && err.message) || t('linkWs.errReadFolder'));
      setLoading(false);
    }
  };

  // 2. Привязка репозитория из подключённого аккаунта GitHub (приватные тоже)
  const handleLinkGitRepo = async ({ owner, repo, branch }: PickedRepo) => {
    setError(null);
    setLoading(true);
    try {
      const ws = await fetchGitHubRepo(owner, repo, branch);
      setWorkspace(ws);
      setLoading(false);
      onClose();
    } catch (err) {
      setError((err instanceof Error && err.message) || t('linkWs.errLoadRepo'));
      setLoading(false);
    }
  };

  return (
    <Modal labelledBy="link-workspace-title" onClose={onClose} size="md">
      <ModalHeader
        titleId="link-workspace-title"
        icon={<FolderIcon className="size-5" />}
        title={t('linkWs.title')}
        description={t('linkWs.desc')}
        onClose={onClose}
      />

      <div className="min-h-0 overflow-y-auto p-5">
        {/* Скрытый input для фоллбека директорий */}
        <input
          ref={fileInputRef}
          type="file"
          // @ts-expect-error webkitdirectory non-standard attribute
          webkitdirectory=""
          directory=""
          multiple
          className="hidden"
          onChange={handleFileInputChange}
        />

        {/* Переключатель вкладок */}
        <div className="mb-5 flex rounded-xl border border-stroke bg-canvas p-1">
          {(
            [
              {
                id: 'folder',
                label: t('linkWs.tabFolder'),
                icon: <FolderIcon className="size-4 text-accent" />,
              },
              { id: 'git', label: t('linkWs.tabGit'), icon: <GitHubIcon className="size-4" /> },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={tab === item.id}
              onClick={() => {
                setTab(item.id);
                setError(null);
              }}
              className={cn(
                'flex min-h-11 flex-1 flex-col items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-center text-[13px] leading-tight font-medium transition-[background-color,color,box-shadow] duration-200 sm:flex-row sm:gap-2',
                tab === item.id
                  ? 'bg-surface-2 text-text shadow-sm ring-1 ring-stroke-strong'
                  : 'text-muted hover:text-text',
              )}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>

        {error ? (
          <div
            role="alert"
            className="mb-4 rounded-xl border border-danger/30 bg-danger-soft p-3 text-[13px] break-words text-danger"
          >
            {error}
          </div>
        ) : null}

        {tab === 'folder' ? (
          <div className="flex flex-col gap-4 py-2 text-center">
            <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-accent-soft text-accent ring-1 ring-accent/20">
              <FolderIcon className="size-7" />
            </div>

            <div className="space-y-1.5">
              <h3 className="text-sm font-semibold text-text">{t('linkWs.folderTitle')}</h3>
              <p className="mx-auto max-w-sm text-[13px] leading-5 text-muted">
                {t('linkWs.folderDesc')}
              </p>
            </div>

            <Button
              size="lg"
              loading={loading}
              onClick={handleLinkLocalFolder}
              className="mt-2 w-full gap-2"
            >
              <FolderIcon className="size-4" />
              {loading ? t('linkWs.indexing') : t('linkWs.pickFolder')}
            </Button>
          </div>
        ) : (
          <GithubRepoPicker
            intent="link-repo"
            busy={loading}
            submitLabel={t('linkWs.submit')}
            busyLabel={t('linkWs.connecting')}
            onPick={(picked) => void handleLinkGitRepo(picked)}
          />
        )}
      </div>
    </Modal>
  );
}
