import { useRef, useState } from 'react';
import { CloseIcon, FolderIcon, GitHubIcon, RefreshIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { fetchGitHubRepo, parseGitHubUrl } from '@/features/chat/git-repo-reader';
import { pickFolderNative, readFolderFromFiles } from '@/features/chat/local-folder-reader';
import { useWorkspace } from '@/features/chat/workspace-store';

interface LinkWorkspaceModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function LinkWorkspaceModal({ isOpen, onClose }: LinkWorkspaceModalProps) {
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
      setError(err?.message || 'Не удалось прочитать выбранную папку');
      setLoading(false);
    }
  };

  // 2. Привязка Git-репозитория
  const handleLinkGitRepo = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const parsed = parseGitHubUrl(repoUrl);
    if (!parsed) {
      setError('Укажите корректную ссылку на GitHub или формат owner/repo (например, facebook/react)');
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
      setError(err?.message || 'Не удалось загрузить репозиторий');
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
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm animate-in fade-in duration-200"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-2xl border border-stroke bg-canvas p-6 shadow-2xl"
      >
        <div className="flex items-center justify-between pb-4 border-b border-stroke">
          <div>
            <h2 className="text-lg font-semibold text-text">Привязать кодовую базу к чату</h2>
            <p className="text-xs text-muted mt-0.5">
              ИИ будет видеть структуру проекта и файлы, искать код и отвечать с учётом репозитория
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted hover:bg-surface hover:text-text transition"
          >
            <CloseIcon className="size-4" />
          </button>
        </div>

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
        <div className="flex rounded-lg border border-stroke bg-surface p-1 my-5">
          <button
            type="button"
            onClick={() => { setTab('folder'); setError(null); }}
            className={`flex-1 flex items-center justify-center gap-2 rounded-md py-2 text-xs font-medium transition ${
              tab === 'folder'
                ? 'bg-canvas text-text shadow-sm'
                : 'text-muted hover:text-text'
            }`}
          >
            <FolderIcon className="size-4 text-accent" />
            Локальная папка
          </button>
          <button
            type="button"
            onClick={() => { setTab('git'); setError(null); }}
            className={`flex-1 flex items-center justify-center gap-2 rounded-md py-2 text-xs font-medium transition ${
              tab === 'git'
                ? 'bg-canvas text-text shadow-sm'
                : 'text-muted hover:text-text'
            }`}
          >
            <GitHubIcon className="size-4" />
            GitHub Репозиторий
          </button>
        </div>

        {error ? (
          <div className="mb-4 rounded-lg border border-danger/30 bg-danger-soft p-3 text-xs text-danger">
            {error}
          </div>
        ) : null}

        {tab === 'folder' ? (
          <div className="flex flex-col gap-4 text-center py-2">
            <div className="mx-auto flex size-14 items-center justify-center rounded-2xl border border-stroke bg-surface-2 text-accent">
              <FolderIcon className="size-7" />
            </div>

            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-text">Выберите папку проекта на вашем компьютере</h3>
              <p className="text-xs text-muted max-w-sm mx-auto">
                Браузер безопасно прочитает файлы кода (js, ts, py, rs, go, json и др.), исключая node_modules и бинарники.
              </p>
            </div>

            <Button
              size="lg"
              loading={loading}
              onClick={handleLinkLocalFolder}
              className="mt-2 w-full gap-2"
            >
              <FolderIcon className="size-4" />
              {loading ? 'Индексация проекта…' : 'Выбрать локальную папку'}
            </Button>
          </div>
        ) : (
          <form onSubmit={handleLinkGitRepo} className="flex flex-col gap-3 py-1">
            <div>
              <label htmlFor="repoUrl" className="block text-xs font-medium text-muted mb-1.5">
                Ссылка на репозиторий GitHub или owner/repo
              </label>
              <Input
                id="repoUrl"
                placeholder="https://github.com/facebook/react или owner/repo"
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                autoFocus
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="branch" className="block text-xs font-medium text-muted mb-1.5">
                  Ветка
                </label>
                <Input
                  id="branch"
                  placeholder="main"
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="token" className="block text-xs font-medium text-muted mb-1.5">
                  Token (опционально)
                </label>
                <Input
                  id="token"
                  type="password"
                  placeholder="ghp_... для приватных"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                />
              </div>
            </div>

            <div className="mt-2 flex items-center justify-between pt-1">
              <button
                type="button"
                onClick={handleConnectSampleRepo}
                className="text-xs text-accent hover:underline flex items-center gap-1"
              >
                <RefreshIcon className="size-3" />
                Подключить репозиторий Ketner AI
              </button>
              <Button type="submit" loading={loading}>
                {loading ? 'Подключение…' : 'Привязать репозиторий'}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
