import { useEffect, useState } from 'react';
import {
  AlertIcon,
  CheckIcon,
  CodeIcon,
  FolderIcon,
  GitHubIcon,
  RefreshIcon,
  SparkleIcon,
} from '@/components/icons';
import { Button } from '@/components/ui/button';
import {
  applyLocalChanges,
} from '@/features/chat/file-operations';
import type { FileProposal, WorkspaceContext } from '@/features/chat/types';
import { useWorkspace } from '@/features/chat/workspace-store';
import { useTranslation } from '@/i18n';
import { cn } from '@/lib/cn';
import { FileDiffModal } from './file-diff-modal';
import { GitHubApplyModal } from './github-apply-modal';

interface FileProposalCardProps {
  proposal: FileProposal;
  workspace?: WorkspaceContext | null;
}

export function FileProposalCard({ proposal: initialProposal, workspace }: FileProposalCardProps) {
  const { t } = useTranslation();
  const autoApply = useWorkspace((state) => state.autoApply);
  const [proposal, setProposal] = useState<FileProposal>(initialProposal);
  const [isDiffOpen, setIsDiffOpen] = useState(false);
  const [isGitModalOpen, setIsGitModalOpen] = useState(false);
  const [activeDiffIndex, setActiveDiffIndex] = useState(0);

  const totalAdditions = proposal.changes.reduce((acc, c) => acc + (c.additions || 0), 0);
  const totalDeletions = proposal.changes.reduce((acc, c) => acc + (c.deletions || 0), 0);

  const handleOpenDiff = (idx = 0) => {
    setActiveDiffIndex(idx);
    setIsDiffOpen(true);
  };

  const handleApply = async () => {
    if (!workspace) {
      setProposal((prev) => ({
        ...prev,
        status: 'error',
        error: t('proposal.noWorkspaceError'),
      }));
      return;
    }

    if (workspace.type === 'git_repo') {
      setIsGitModalOpen(true);
      return;
    }

    // Локальная папка
    setProposal((prev) => ({ ...prev, status: 'applying', error: undefined }));
    try {
      const res = await applyLocalChanges(workspace, proposal.changes);
      if (res.success) {
        setProposal((prev) => ({
          ...prev,
          status: 'applied',
          appliedAt: new Date().toISOString(),
        }));
      } else {
        setProposal((prev) => ({
          ...prev,
          status: 'error',
          error: res.errors.join('; '),
        }));
      }
    } catch (err: any) {
      setProposal((prev) => ({
        ...prev,
        status: 'error',
        error: err?.message || t('proposal.applyError'),
      }));
    }
  };

  useEffect(() => {
    if (autoApply && proposal.status === 'pending' && workspace?.type === 'local_folder') {
      void handleApply();
    }
  }, [autoApply, proposal.status, workspace?.type]);

  const handleGitSuccess = (result: {
    type: 'commit' | 'pull_request';
    url: string;
    branch: string;
    commitSha: string;
    prNumber?: number;
  }) => {
    setProposal((prev) => ({
      ...prev,
      status: 'applied',
      appliedAt: new Date().toISOString(),
      gitResult: result,
    }));
  };

  const handleDiscard = () => {
    setProposal((prev) => ({ ...prev, status: 'discarded' }));
  };

  const rejected = proposal.rejected ?? [];

  // Ничего безопасного применить нельзя: объясняем почему, вместо кнопки «Применить».
  if (proposal.changes.length === 0) {
    return (
      <div
        role="alert"
        className="mt-3 max-w-2xl rounded-2xl border border-warning/30 bg-warning-soft p-4 text-[13px] text-text"
      >
        <h2 className="flex items-center gap-2 font-semibold text-warning">
          <AlertIcon className="size-4 shrink-0" aria-hidden="true" />
          {t('proposal.notAppliedTitle')}
        </h2>
        <ul className="mt-2 space-y-1">
          {rejected.map((item, idx) => (
            <li key={`${item.path}-${idx}`} className="break-words">
              <span className="font-mono text-text">{item.path}</span> — {item.reason}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-muted">{t('proposal.nothingWritten')}</p>
      </div>
    );
  }

  if (proposal.status === 'discarded') {
    return (
      <div className="mt-3 flex max-w-2xl items-center justify-between gap-3 rounded-xl border border-dashed border-stroke-strong bg-surface/50 py-1.5 pr-1.5 pl-3.5 text-[13px] text-muted">
        <span>{t('proposal.discarded')}</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setProposal((prev) => ({ ...prev, status: 'pending' }))}
          className="text-accent hover:text-accent"
        >
          {t('proposal.restore')}
        </Button>
      </div>
    );
  }

  return (
    <>
      <div className="mt-3 max-w-2xl rounded-2xl border border-stroke bg-surface-2/60 p-4 shadow-sm transition-colors hover:border-stroke-strong">
        {/* Шапка карточки */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stroke pb-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
              <CodeIcon className="size-4" />
            </span>
            <div className="min-w-0">
              <h2 className="text-[13px] font-semibold text-text">{t('proposal.title')}</h2>
              <p className="mt-0.5 font-mono text-[11px] text-muted">
                {t(proposal.changes.length === 1 ? 'proposal.fileOne' : 'proposal.fileMany', {
                  count: proposal.changes.length,
                })}{' '}
                • <span className="font-medium text-success">+{totalAdditions}</span> /{' '}
                <span className="font-medium text-danger">−{totalDeletions}</span>
              </p>
            </div>
          </div>

          <Button variant="outline" size="sm" onClick={() => handleOpenDiff(0)}>
            {t('proposal.viewDiff')}
          </Button>
        </div>

        {/* Список файлов */}
        <div className="space-y-1.5 py-3">
          {proposal.changes.map((change, idx) => (
            <div
              key={change.path}
              className="flex min-h-11 items-center gap-2.5 rounded-lg bg-surface/80 px-2.5 py-1.5 text-xs transition-colors hover:bg-surface"
            >
              <span
                className={cn(
                  'shrink-0 rounded-xs px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase',
                  change.action === 'write'
                    ? 'bg-success-soft text-success'
                    : change.action === 'replace'
                      ? 'bg-info-soft text-info'
                      : 'bg-danger-soft text-danger',
                )}
              >
                {change.action}
              </span>

              <div className="min-w-0 flex-1">
                <span className="block truncate font-mono text-[12px] text-text" title={change.path}>
                  {change.path}
                </span>
                {change.description ? (
                  <span className="block truncate text-[11px] text-muted">{change.description}</span>
                ) : null}
                {change.warning ? (
                  <span className="flex items-center gap-1 text-[11px] text-warning" title={change.warning}>
                    <AlertIcon className="size-3 shrink-0" aria-hidden="true" />
                    <span className="truncate">{change.warning}</span>
                  </span>
                ) : null}
              </div>

              <span className="shrink-0 font-mono text-[11px] text-muted">
                <span className="text-success">+{change.additions || 0}</span> /{' '}
                <span className="text-danger">−{change.deletions || 0}</span>
              </span>
              <button
                type="button"
                onClick={() => handleOpenDiff(idx)}
                className="inline-flex min-h-9 shrink-0 items-center rounded-md px-2 text-[12px] font-medium text-accent transition-colors hover:bg-accent-soft max-md:min-h-11 max-md:min-w-11 justify-center"
              >
                {t('proposal.diff')}
              </button>
            </div>
          ))}
        </div>

        {/* Правки, которые безопасно применить нельзя */}
        {rejected.length > 0 && proposal.status !== 'applied' && (
          <div className="mb-3 rounded-lg border border-warning/30 bg-warning-soft p-3 text-xs text-text">
            <p className="font-medium text-warning">{t('proposal.partRejected')}</p>
            <ul className="mt-1 space-y-0.5">
              {rejected.map((item, idx) => (
                <li key={`${item.path}-${idx}`} className="break-words">
                  <span className="font-mono text-text">{item.path}</span> — {item.reason}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Ошибки */}
        {proposal.status === 'error' && proposal.error && (
          <div
            role="alert"
            className="mb-3 rounded-lg border border-danger/30 bg-danger-soft p-3 text-xs break-words text-danger"
          >
            {proposal.error}
          </div>
        )}

        {/* Статус: успешно применено */}
        {proposal.status === 'applied' && (
          <div className="rounded-xl border border-success/30 bg-success-soft p-3 text-[13px] text-success">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
              <div className="flex items-center gap-2">
                <CheckIcon className="size-4 shrink-0" />
                <span className="font-medium">
                  {workspace?.type === 'git_repo' ? t('proposal.appliedGit') : t('proposal.appliedLocal')}
                </span>
              </div>
              {proposal.gitResult?.url && (
                <a
                  href={proposal.gitResult.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-9 items-center gap-1 font-semibold text-accent hover:underline max-md:min-h-11"
                >
                  {proposal.gitResult.type === 'pull_request'
                    ? t('proposal.openPr', { number: proposal.gitResult.prNumber || '' })
                    : t('proposal.openCommit')}
                </a>
              )}
            </div>
          </div>
        )}

        {/* Кнопки действий */}
        {proposal.status === 'pending' || proposal.status === 'error' ? (
          <>
            {proposal.status === 'pending' && !autoApply && (
              <div className="mb-3 flex items-start gap-2 rounded-lg border border-stroke bg-surface/90 px-3 py-2 text-xs leading-5 text-muted">
                <SparkleIcon className="mt-0.5 size-3.5 shrink-0 text-accent" aria-hidden="true" />
                <span>{t('proposal.hint')}</span>
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-stroke pt-3">
              <div className="min-w-0 text-xs text-muted">
                {workspace ? (
                  <span className="flex items-center gap-1.5">
                    {t('proposal.target')}
                    {workspace.type === 'git_repo' ? (
                      <GitHubIcon className="size-3.5 shrink-0 text-accent" />
                    ) : (
                      <FolderIcon className="size-3.5 shrink-0 text-accent" />
                    )}
                    <span className="truncate font-mono text-text">{workspace.name}</span>
                  </span>
                ) : (
                  t('proposal.needWorkspace')
                )}
              </div>

              <div className="flex w-full flex-col-reverse gap-2 sm:ml-auto sm:w-auto sm:flex-row sm:items-center">
                <Button variant="ghost" size="sm" onClick={handleDiscard} className="max-sm:w-full">
                  {t('proposal.discard')}
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleApply}
                  disabled={!workspace}
                  className="max-sm:w-full"
                >
                  {workspace?.type === 'git_repo' ? (
                    <>
                      <GitHubIcon className="size-3.5" />
                      {t('proposal.applyGit')}
                    </>
                  ) : (
                    <>
                      <CheckIcon className="size-3.5" />
                      {t('proposal.applyProject')}
                    </>
                  )}
                </Button>
              </div>
            </div>
          </>
        ) : null}

        {proposal.status === 'applying' && (
          <div role="status" className="flex items-center gap-2 pt-2 text-xs text-accent">
            <RefreshIcon className="size-3.5 animate-spin" />
            <span>{t('proposal.applying')}</span>
          </div>
        )}
      </div>

      {/* Модальное окно Diff */}
      <FileDiffModal
        isOpen={isDiffOpen}
        onClose={() => setIsDiffOpen(false)}
        changes={proposal.changes}
        initialFileIndex={activeDiffIndex}
      />

      {/* Модальное окно применения к GitHub */}
      {workspace && workspace.type === 'git_repo' && (
        <GitHubApplyModal
          isOpen={isGitModalOpen}
          onClose={() => setIsGitModalOpen(false)}
          workspace={workspace}
          changes={proposal.changes}
          onSuccess={handleGitSuccess}
        />
      )}
    </>
  );
}
