import { useRef, useState } from 'react';
import { FolderIcon, GitHubIcon, RefreshIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal, ModalHeader } from '@/components/ui/modal';
import { fetchGitHubRepo, parseGitHubUrl } from '@/features/chat/git-repo-reader';
import { pickFolderNative, readFolderFromFiles } from '@/features/chat/local-folder-reader';
import { useWorkspace } from '@/features/chat/workspace-store';
import { useTranslation } from '@/i18n';
import { cn } from '@/lib/cn';

interface LinkWorkspaceModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function LinkWorkspaceModal({ isOpen, onClose }: LinkWorkspaceModalProps) {
  const { t } = useTranslation();
  const setWorkspace = useWorkspace((state) => state.setWorkspace);
  const [tab, setTab] = useState<'folder' | 'git'>('folder');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Git repo fields
  const [repoUrl, setRepoUrl] = useState('');
  const [branch, setBranch] = useState('main');
  const [token, setToken] = useState('');

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
    } catch (err: any) {
      if (err?.message === 'showDirectoryPicker_not_supported') {
        // Fallback к input webkitdirectory
        fileInputRef.current?.click();
      } else if (err?.name === 'AbortError') {
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
    } catch (err: any) {
      setError(err?.message || t('linkWs.errReadFolder'));
      setLoading(false);
    }
  };

  // 2. Привязка Git-репозитория
  const handleLinkGitRepo = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const parsed = parseGitHubUrl(repoUrl);
    if (!parsed) {
      setError(t('linkWs.errBadUrl'));
      return;
    }

    setLoading(true);
    try {
      const targetBranch = parsed.branch || branch || 'main';
      const ws = await fetchGitHubRepo(parsed.owner, parsed.repo, targetBranch, token);
      setWorkspace(ws);
      setLoading(false);
      onClose();
    } catch (err: any) {
      setError(err?.message || t('linkWs.errLoadRepo'));
      setLoading(false);
    }
  };

  // 3. Подключение тестового демо-репозитория
  const handleConnectSampleRepo = async () => {
    setRepoUrl('https://github.com/gumieeel/Ketner-AI');
    setBranch('main');
    setError(null);
    setLoading(true);
    try {
      const ws = await fetchGitHubRepo('gumieeel', 'Ketner-AI', 'main');
      setWorkspace(ws);
      setLoading(false);
      onClose();
    } catch {
      // Создаем локальную структуру проекта, если лимит API исчерпан
      setWorkspace({
        id: `sample-${Date.now()}`,
        type: 'git_repo',
        name: 'Ketner-AI',
        pathOrUrl: 'https://github.com/gumieeel/Ketner-AI',
        branch: 'main',
        filesCount: 48,
        files: [
          { path: 'package.json', size: 1820, language: 'json', content: '{\n  "name": "ketner-ai",\n  "version": "1.0.0"\n}' },
          { path: 'apps/web/src/pages/chat-page.tsx', size: 3500, language: 'tsx', content: '// ChatPage implementation' },
          { path: 'apps/web/src/features/chat/chat-store.ts', size: 8200, language: 'ts', content: '// Chat store' },
          { path: 'apps/mock-api/src/ai/gateway.ts', size: 12000, language: 'ts', content: '// AI Gateway' },
        ],
        indexedAt: new Date().toISOString(),
      });
      setLoading(false);
      onClose();
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
              { id: 'folder', label: t('linkWs.tabFolder'), icon: <FolderIcon className="size-4 text-accent" /> },
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
          <div role="alert" className="mb-4 rounded-xl border border-danger/30 bg-danger-soft p-3 text-[13px] break-words text-danger">
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
              <p className="mx-auto max-w-sm text-[13px] leading-5 text-muted">{t('linkWs.folderDesc')}</p>
            </div>

            <Button size="lg" loading={loading} onClick={handleLinkLocalFolder} className="mt-2 w-full gap-2">
              <FolderIcon className="size-4" />
              {loading ? t('linkWs.indexing') : t('linkWs.pickFolder')}
            </Button>
          </div>
        ) : (
          <form onSubmit={handleLinkGitRepo} className="flex flex-col gap-4">
            <div>
              <label htmlFor="repoUrl" className="mb-1.5 block text-[13px] font-medium text-muted">
                {t('linkWs.repoLabel')}
              </label>
              <Input
                id="repoUrl"
                placeholder={t('linkWs.repoPlaceholder')}
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                autoFocus
                required
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="branch" className="mb-1.5 block text-[13px] font-medium text-muted">
                  {t('linkWs.branch')}
                </label>
                <Input id="branch" placeholder="main" value={branch} onChange={(e) => setBranch(e.target.value)} />
              </div>
              <div>
                <label htmlFor="token" className="mb-1.5 block text-[13px] font-medium text-muted">
                  {t('linkWs.token')}
                </label>
                <Input
                  id="token"
                  type="password"
                  placeholder={t('linkWs.tokenPlaceholder')}
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                />
              </div>
            </div>

            <div className="mt-1 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
              <button
                type="button"
                onClick={handleConnectSampleRepo}
                className="inline-flex min-h-10 items-center gap-1.5 self-start rounded-lg px-1 text-[13px] font-medium text-accent hover:underline max-md:min-h-11"
              >
                <RefreshIcon className="size-3.5" />
                {t('linkWs.sample')}
              </button>
              <Button type="submit" loading={loading} className="max-sm:w-full">
                {loading ? t('linkWs.connecting') : t('linkWs.submit')}
              </Button>
            </div>
          </form>
        )}
      </div>
    </Modal>
  );
}
