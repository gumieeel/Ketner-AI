import { useState } from 'react';
import { CloseIcon, GitHubIcon, RefreshIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  commitDirectlyToGitHub,
  createGitHubPullRequest,
  type GitHubPRResponse,
  type GitHubCommitResponse,
} from '@/features/chat/file-operations';
import type { FileChangeItem, WorkspaceContext } from '@/features/chat/types';
import { useWorkspace } from '@/features/chat/workspace-store';

interface GitHubApplyModalProps {
  isOpen: boolean;
  onClose: () => void;
  workspace: WorkspaceContext;
  changes: FileChangeItem[];
  onSuccess: (result: {
    type: 'commit' | 'pull_request';
    url: string;
    branch: string;
    commitSha: string;
    prNumber?: number;
  }) => void;
}

export function GitHubApplyModal({
  isOpen,
  onClose,
  workspace,
  changes,
  onSuccess,
}: GitHubApplyModalProps) {
  const setGitToken = useWorkspace((state) => state.setGitToken);

  const [token, setToken] = useState(workspace.gitToken || '');
  const [mode, setMode] = useState<'pr' | 'commit'>('pr');
  const [prTitle, setPrTitle] = useState(
    `Ketner AI: правки для ${changes.map((c) => c.path.split('/').pop()).join(', ')}`,
  );
  const [targetBranch] = useState(workspace.branch || 'main');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  // Парсим owner и repo из имени workspace
  const [owner, repo] = workspace.name.split('/');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token.trim()) {
      setError('Укажите токен GitHub с правами на запись (scope: repo)');
      return;
    }
    if (!owner || !repo) {
      setError('Некорректное имя репозитория');
      return;
    }

    setLoading(true);
    setError(null);

    // Сохраняем токен в воркспейсе
    setGitToken(token.trim());

    try {
      if (mode === 'pr') {
        const res: GitHubPRResponse = await createGitHubPullRequest({
          owner,
          repo,
          branch: targetBranch,
          token: token.trim(),
          changes,
          title: prTitle,
        });
        setLoading(false);
        onSuccess({
          type: 'pull_request',
          url: res.url,
          branch: res.branch,
          commitSha: res.commitSha,
          prNumber: res.prNumber,
        });
        onClose();
      } else {
        const res: GitHubCommitResponse = await commitDirectlyToGitHub({
          owner,
          repo,
          branch: targetBranch,
          token: token.trim(),
          changes,
          commitMessage: prTitle,
        });
        setLoading(false);
        onSuccess({
          type: 'commit',
          url: res.url,
          branch: res.branch,
          commitSha: res.commitSha,
        });
        onClose();
      }
    } catch (err: any) {
      setError(err?.message || 'Не удалось применить изменения к GitHub');
      setLoading(false);
    }
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm animate-in fade-in duration-200"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-2xl border border-stroke bg-canvas shadow-2xl overflow-hidden"
      >
        <div className="flex items-center justify-between border-b border-stroke bg-surface px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-lg bg-surface-2 text-accent">
              <GitHubIcon className="size-4" />
            </span>
            <div>
              <h3 className="text-sm font-semibold text-text">Запись изменений в GitHub</h3>
              <p className="text-xs text-muted font-mono">{workspace.name}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-text transition"
          >
            <CloseIcon className="size-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <div className="rounded-lg border border-danger/30 bg-danger-soft p-3 text-xs text-danger leading-relaxed">
              {error}
            </div>
          )}

          {/* Mode choice */}
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-muted">
              Способ отправки
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setMode('pr')}
                className={`rounded-xl border p-3 text-left transition ${
                  mode === 'pr'
                    ? 'border-accent bg-accent-soft text-text'
                    : 'border-stroke bg-surface hover:border-stroke-strong text-muted'
                }`}
              >
                <div className="text-xs font-semibold text-text">Создать Pull Request</div>
                <div className="text-[11px] text-muted mt-0.5">В отдельную ветку с безопасным код-ревью</div>
              </button>

              <button
                type="button"
                onClick={() => setMode('commit')}
                className={`rounded-xl border p-3 text-left transition ${
                  mode === 'commit'
                    ? 'border-accent bg-accent-soft text-text'
                    : 'border-stroke bg-surface hover:border-stroke-strong text-muted'
                }`}
              >
                <div className="text-xs font-semibold text-text">Прямой коммит</div>
                <div className="text-[11px] text-muted mt-0.5">Сразу в ветку {targetBranch}</div>
              </button>
            </div>
          </div>

          {/* PR Title */}
          <div>
            <label className="text-xs font-medium text-text block mb-1">
              {mode === 'pr' ? 'Название Pull Request' : 'Сообщение коммита'}
            </label>
            <Input
              value={prTitle}
              onChange={(e) => setPrTitle(e.target.value)}
              placeholder="Кратко опишите суть изменений"
              required
            />
          </div>

          {/* GitHub Token */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium text-text">GitHub Personal Access Token</label>
              <a
                href="https://github.com/settings/tokens/new?description=KetnerAI&scopes=repo"
                target="_blank"
                rel="noreferrer"
                className="text-[11px] text-accent hover:underline"
              >
                Создать токен (права repo) ↗
              </a>
            </div>
            <Input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="ghp_xxxxxxxxxxxx"
              required
            />
            <p className="text-[11px] text-muted mt-1">
              Токен хранится локально в вашем браузере и используется только для отправки коммита.
            </p>
          </div>

          <div className="pt-2 flex justify-end gap-2">
            <Button variant="outline" type="button" onClick={onClose} disabled={loading}>
              Отмена
            </Button>
            <Button variant="primary" type="submit" disabled={loading} className="gap-1.5">
              {loading ? (
                <>
                  <RefreshIcon className="size-3.5 animate-spin" />
                  Отправка...
                </>
              ) : mode === 'pr' ? (
                'Создать Pull Request'
              ) : (
                'Сделать коммит'
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
