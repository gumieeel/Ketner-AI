import { useState } from 'react';
import {
  CheckIcon,
  CodeIcon,
  FolderIcon,
  GitHubIcon,
  RefreshIcon,
} from '@/components/icons';
import { Button } from '@/components/ui/button';
import {
  applyLocalChanges,
} from '@/features/chat/file-operations';
import type { FileProposal, WorkspaceContext } from '@/features/chat/types';
import { FileDiffModal } from './file-diff-modal';
import { GitHubApplyModal } from './github-apply-modal';

interface FileProposalCardProps {
  proposal: FileProposal;
  workspace?: WorkspaceContext | null;
}

export function FileProposalCard({ proposal: initialProposal, workspace }: FileProposalCardProps) {
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
        error: 'Проект не привязан к текущему чату. Привяжите папку или репозиторий.',
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
        error: err?.message || 'Ошибка применения изменений',
      }));
    }
  };

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

  if (proposal.status === 'discarded') {
    return (
      <div className="mt-3 rounded-xl border border-stroke bg-surface/50 p-3 text-xs text-muted flex items-center justify-between">
        <span>Предложенные изменения в коде отклонены</span>
        <button
          type="button"
          onClick={() => setProposal((prev) => ({ ...prev, status: 'pending' }))}
          className="text-accent hover:underline text-xs"
        >
          Вернуть
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="mt-3 rounded-2xl border border-stroke bg-surface-2/60 backdrop-blur-sm p-4 shadow-sm transition hover:border-stroke-strong max-w-2xl">
        {/* Шапка карточки */}
        <div className="flex items-center justify-between gap-3 border-b border-stroke/70 pb-3">
          <div className="flex items-center gap-2.5">
            <span className="flex size-7 items-center justify-center rounded-lg bg-accent-soft text-accent">
              <CodeIcon className="size-4" />
            </span>
            <div>
              <h4 className="text-xs font-semibold text-text">
                Предложены изменения в кодовой базе
              </h4>
              <p className="text-[11px] text-muted font-mono mt-0.5">
                {proposal.changes.length} {proposal.changes.length === 1 ? 'файл' : 'файлов'} •{' '}
                <span className="text-emerald-500 font-medium">+{totalAdditions}</span> /{' '}
                <span className="text-rose-500 font-medium">-{totalDeletions}</span>
              </p>
            </div>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => handleOpenDiff(0)}
            className="text-xs gap-1.5 h-7"
          >
            Посмотреть Diff
          </Button>
        </div>

        {/* Список файлов */}
        <div className="py-2.5 space-y-1.5">
          {proposal.changes.map((change, idx) => (
            <div
              key={change.path}
              className="flex items-center justify-between rounded-lg bg-surface/80 px-2.5 py-1.5 text-xs transition hover:bg-surface"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className={`rounded px-1.5 py-0.2 text-[9px] font-mono font-bold uppercase ${
                    change.action === 'write'
                      ? 'bg-emerald-500/15 text-emerald-400'
                      : change.action === 'replace'
                        ? 'bg-blue-500/15 text-blue-400'
                        : 'bg-rose-500/15 text-rose-400'
                  }`}
                >
                  {change.action}
                </span>
                <span className="font-mono text-[11px] text-text truncate">{change.path}</span>
                {change.description && (
                  <span className="text-[10px] text-muted truncate hidden sm:inline">
                    — {change.description}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2 pl-2 shrink-0">
                <span className="text-[10px] font-mono text-muted">
                  +{change.additions || 0} / -{change.deletions || 0}
                </span>
                <button
                  type="button"
                  onClick={() => handleOpenDiff(idx)}
                  className="text-accent hover:underline text-[11px]"
                >
                  Diff
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Ошибки */}
        {proposal.status === 'error' && proposal.error && (
          <div className="mb-2.5 rounded-lg border border-danger/30 bg-danger-soft p-2.5 text-xs text-danger">
            {proposal.error}
          </div>
        )}

        {/* Статус: успешно применено */}
        {proposal.status === 'applied' && (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-400">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckIcon className="size-4 text-emerald-500" />
                <span className="font-medium">
                  {workspace?.type === 'git_repo'
                    ? 'Изменения успешно отправлены в GitHub!'
                    : 'Изменения успешно записаны на локальный диск!'}
                </span>
              </div>
              {proposal.gitResult?.url && (
                <a
                  href={proposal.gitResult.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-semibold text-accent hover:underline ml-2"
                >
                  {proposal.gitResult.type === 'pull_request'
                    ? `Открыть PR #${proposal.gitResult.prNumber || ''} ↗`
                    : 'Открыть коммит ↗'}
                </a>
              )}
            </div>
          </div>
        )}

        {/* Кнопки действий */}
        {proposal.status === 'pending' || proposal.status === 'error' ? (
          <div className="flex items-center justify-between pt-2 border-t border-stroke/70">
            <div className="text-[11px] text-muted">
              {workspace ? (
                <span className="flex items-center gap-1">
                  Цель:{' '}
                  {workspace.type === 'git_repo' ? (
                    <GitHubIcon className="size-3 text-accent inline" />
                  ) : (
                    <FolderIcon className="size-3 text-accent inline" />
                  )}
                  <span className="font-mono text-text">{workspace.name}</span>
                </span>
              ) : (
                'Требуется привязка проекта'
              )}
            </div>

            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={handleDiscard} className="text-xs h-7.5">
                Отклонить
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleApply}
                disabled={!workspace}
                className="text-xs h-7.5 gap-1.5"
              >
                {workspace?.type === 'git_repo' ? (
                  <>
                    <GitHubIcon className="size-3.5" />
                    Применить к GitHub
                  </>
                ) : (
                  <>
                    <CheckIcon className="size-3.5" />
                    Применить к проекту
                  </>
                )}
              </Button>
            </div>
          </div>
        ) : null}

        {proposal.status === 'applying' && (
          <div className="flex items-center gap-2 text-xs text-accent pt-2">
            <RefreshIcon className="size-3.5 animate-spin" />
            <span>Запись изменений в файлы проекта...</span>
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
