import { useEffect, useState } from 'react';
import { GitHubIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal, ModalHeader } from '@/components/ui/modal';
import {
  commitDirectlyToGitHub,
  createGitHubPullRequest,
  type GitHubPRResponse,
  type GitHubCommitResponse,
} from '@/features/chat/file-operations';
import type { FileChangeItem, WorkspaceContext } from '@/features/chat/types';
import { useGithub } from '@/features/github/github-store';
import { useTranslation } from '@/i18n';
import { cn } from '@/lib/cn';

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
  const { t } = useTranslation();
  const githubStatus = useGithub((state) => state.status);
  const loadGithub = useGithub((state) => state.load);
  const connectGithub = useGithub((state) => state.connect);
  const connecting = useGithub((state) => state.busy);
  const connected = Boolean(githubStatus?.connected);

  useEffect(() => {
    if (isOpen) void loadGithub();
  }, [isOpen, loadGithub]);

  const [mode, setMode] = useState<'pr' | 'commit'>('pr');
  const [prTitle, setPrTitle] = useState(
    t('gh.defaultTitle', { files: changes.map((c) => c.path.split('/').pop()).join(', ') }),
  );
  const [targetBranch] = useState(workspace.branch || 'main');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  // Парсим owner и repo из имени workspace
  const [owner, repo] = workspace.name.split('/');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!connected) {
      setError(t('gh.needConnect'));
      return;
    }
    if (!owner || !repo) {
      setError(t('gh.errBadRepo'));
      return;
    }

    setLoading(true);
    setError(null);

    try {
      if (mode === 'pr') {
        const res: GitHubPRResponse = await createGitHubPullRequest({
          owner,
          repo,
          branch: targetBranch,
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
      setError(err?.message || t('gh.errApply'));
      setLoading(false);
    }
  };

  return (
    <Modal labelledBy="github-apply-title" onClose={onClose} size="md">
      <ModalHeader
        titleId="github-apply-title"
        icon={<GitHubIcon className="size-5" />}
        title={t('gh.title')}
        description={<span className="font-mono text-xs">{workspace.name}</span>}
        onClose={onClose}
      />

      <form onSubmit={handleSubmit} className="min-h-0 space-y-5 overflow-y-auto p-5">
        {error && (
          <div role="alert" className="rounded-xl border border-danger/30 bg-danger-soft p-3 text-[13px] leading-relaxed break-words text-danger">
            {error}
          </div>
        )}

        {/* Mode choice */}
        <fieldset className="space-y-2">
          <legend className="text-xs font-semibold text-muted">{t('gh.mode')}</legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {(
              [
                { id: 'pr', title: t('gh.prOption'), hint: t('gh.prHint') },
                { id: 'commit', title: t('gh.commitOption'), hint: t('gh.commitHint', { branch: targetBranch }) },
              ] as const
            ).map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={mode === option.id}
                onClick={() => setMode(option.id)}
                className={cn(
                  'min-h-14 rounded-xl border p-3 text-left transition-[border-color,background-color,box-shadow] duration-200',
                  mode === option.id
                    ? 'border-accent bg-accent-soft ring-2 ring-accent/20'
                    : 'border-stroke bg-canvas hover:border-stroke-strong',
                )}
              >
                <div className="text-[13px] font-semibold text-text">{option.title}</div>
                <div className="mt-0.5 text-xs leading-4 text-muted">{option.hint}</div>
              </button>
            ))}
          </div>
        </fieldset>

        {/* PR Title */}
        <div>
          <label htmlFor="gh-title" className="mb-1.5 block text-[13px] font-medium text-text">
            {mode === 'pr' ? t('gh.prLabel') : t('gh.commitLabel')}
          </label>
          <Input
            id="gh-title"
            value={prTitle}
            onChange={(e) => setPrTitle(e.target.value)}
            placeholder={t('gh.titlePlaceholder')}
            required
          />
        </div>

        {/* От чьего имени уйдут изменения */}
        {connected ? (
          <p className="flex items-center gap-2 rounded-xl border border-stroke bg-canvas px-3.5 py-3 text-[13px] text-muted">
            {githubStatus?.account?.avatarUrl ? (
              <img src={githubStatus.account.avatarUrl} alt="" className="size-5 rounded-full" />
            ) : (
              <GitHubIcon className="size-4" />
            )}
            <span className="min-w-0 truncate">{t('gh.account', { login: githubStatus?.account?.login ?? '' })}</span>
          </p>
        ) : (
          <div className="flex flex-col gap-3 rounded-xl border border-stroke bg-canvas p-3.5">
            <p className="text-[13px] leading-5 text-muted">{t('gh.needConnect')}</p>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              loading={connecting}
              onClick={() => void connectGithub()}
              leftIcon={<GitHubIcon className="size-3.5" />}
              className="self-start"
            >
              {t('gh.connect')}
            </Button>
          </div>
        )}

        <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
          <Button variant="outline" type="button" onClick={onClose} disabled={loading} className="max-sm:w-full">
            {t('common.cancel')}
          </Button>
          <Button variant="primary" type="submit" loading={loading} disabled={!connected} className="gap-1.5 max-sm:w-full">
            {loading ? t('gh.sending') : mode === 'pr' ? t('gh.prOption') : t('gh.submitCommit')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
