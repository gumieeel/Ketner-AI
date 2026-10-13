import { useEffect, useId, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { GitBranchIcon, GitHubIcon, LockIcon, SearchIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { buttonClasses } from '@/components/ui/button-classes';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/features/auth/auth-store';
import { parseGitHubUrl } from '@/features/chat/git-repo-reader';
import { githubApi, GithubConnectionError, type GithubRepo } from '@/features/github/api';
import { useGithub, type GithubIntent } from '@/features/github/github-store';
import { useTranslation } from '@/i18n';
import { cn } from '@/lib/cn';

export interface PickedRepo {
  owner: string;
  repo: string;
  branch: string;
}

interface GithubRepoPickerProps {
  /** Куда вернуться после подключения GitHub: picker откроется снова. */
  intent: GithubIntent;
  submitLabel: string;
  busyLabel: string;
  busy: boolean;
  onPick: (picked: PickedRepo) => void;
}

const SELECT_CLASS =
  'h-12 w-full rounded-md border border-stroke bg-surface px-3 text-base text-text focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft disabled:opacity-60 md:h-11 md:text-[15px]';

/**
 * Выбор репозитория из привязанного аккаунта GitHub (включая приватные) и ветки.
 * Без подключения показывает кнопку «Подключить GitHub»; токен в браузер не попадает.
 */
export function GithubRepoPicker({ intent, submitLabel, busyLabel, busy, onPick }: GithubRepoPickerProps) {
  const { t } = useTranslation();
  const authStatus = useAuth((state) => state.status);
  const status = useGithub((state) => state.status);
  const statusLoading = useGithub((state) => state.loading);
  const connecting = useGithub((state) => state.busy);
  const connectError = useGithub((state) => state.error);
  const load = useGithub((state) => state.load);
  const connect = useGithub((state) => state.connect);
  const searchId = useId();
  const branchId = useId();

  const [repos, setRepos] = useState<GithubRepo[] | null>(null);
  const [reposError, setReposError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<{ owner: string; name: string; defaultBranch?: string } | null>(null);
  const [branches, setBranches] = useState<string[] | null>(null);
  const [branch, setBranch] = useState('');
  const [branchesError, setBranchesError] = useState<string | null>(null);

  const signedIn = authStatus === 'authenticated';
  const connected = Boolean(status?.connected);

  useEffect(() => {
    if (signedIn) void load();
  }, [signedIn, load]);

  useEffect(() => {
    if (!connected) return;
    let cancelled = false;
    setReposError(null);
    githubApi
      .repos()
      .then((list) => {
        if (!cancelled) setRepos(list);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof GithubConnectionError && error.code === 'github_reauth_required') void load(true);
        setReposError(error instanceof Error ? error.message : t('linkWs.errLoadRepo'));
        setRepos([]);
      });
    return () => {
      cancelled = true;
    };
    // t меняется вместе с языком — список перезагружать не нужно
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, status?.account?.login]);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    setBranches(null);
    setBranchesError(null);
    setBranch(selected.defaultBranch ?? '');
    Promise.all([
      githubApi.branches(selected.owner, selected.name),
      selected.defaultBranch
        ? Promise.resolve(selected.defaultBranch)
        : githubApi.defaultBranch(selected.owner, selected.name).catch(() => ''),
    ])
      .then(([list, preferred]) => {
        if (cancelled) return;
        // Ветка по умолчанию — первой и выбранной, даже если её нет на первой странице списка.
        const all = preferred ? [preferred, ...list.filter((name) => name !== preferred)] : list;
        setBranches(all);
        setBranch(preferred || all[0] || '');
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setBranches([]);
        setBranchesError(error instanceof Error ? error.message : t('linkWs.errLoadRepo'));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.owner, selected?.name]);

  const typed = useMemo(() => parseGitHubUrl(query), [query]);
  const filtered = useMemo(() => {
    if (!repos) return [];
    const needle = (typed ? `${typed.owner}/${typed.repo}` : query.trim()).toLowerCase();
    if (!needle) return repos;
    return repos.filter(
      (r) => r.fullName.toLowerCase().includes(needle) || (!typed && Boolean(r.description?.toLowerCase().includes(needle))),
    );
  }, [repos, query, typed]);
  // Ссылка на репозиторий, которого нет в списке (например, чужой публичный): его тоже можно открыть.
  const typedOutsideList =
    typed && repos !== null && !repos.some((r) => r.fullName.toLowerCase() === `${typed.owner}/${typed.repo}`.toLowerCase());

  if (!signedIn) {
    return (
      <div className="flex flex-col items-center gap-3 py-4 text-center">
        <GithubBadge />
        <p className="max-w-sm text-[14px] leading-6 text-muted">{t('linkWs.signInDesc')}</p>
        <Link to="/login" className={buttonClasses({ size: 'md' })}>
          {t('linkWs.signIn')}
        </Link>
      </div>
    );
  }

  if (!status && statusLoading) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true">
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (!connected) {
    const unavailable = status ? !status.available : false;
    return (
      <div className="flex flex-col items-center gap-3 py-2 text-center">
        <GithubBadge />
        <div className="space-y-1.5">
          <h3 className="text-sm font-semibold text-text">{t('linkWs.connectTitle')}</h3>
          <p className="mx-auto max-w-sm text-[13px] leading-5 text-muted">
            {unavailable ? t('linkWs.unavailable') : t('linkWs.connectDesc')}
          </p>
        </div>
        {connectError ? (
          <p role="alert" className="text-[13px] text-danger">
            {connectError}
          </p>
        ) : null}
        {!unavailable ? (
          <Button
            size="lg"
            className="mt-1 w-full gap-2"
            loading={connecting}
            onClick={() => void connect(intent)}
            leftIcon={<GitHubIcon className="size-4" />}
          >
            {t('linkWs.connectCta')}
          </Button>
        ) : null}
      </div>
    );
  }

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (selected) onPick({ owner: selected.owner, repo: selected.name, branch: branch || selected.defaultBranch || 'main' });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-[13px] text-muted">
        <span className="inline-flex min-w-0 items-center gap-2">
          {status?.account?.avatarUrl ? (
            <img src={status.account.avatarUrl} alt="" className="size-5 rounded-full" />
          ) : (
            <GitHubIcon className="size-4" />
          )}
          <span className="truncate">{t('linkWs.connectedAs', { login: status?.account?.login ?? '' })}</span>
        </span>
        <Link to="/settings#github" className="inline-flex min-h-8 items-center text-accent hover:underline">
          {t('linkWs.manage')}
        </Link>
      </div>

      <div className="relative">
        <label htmlFor={searchId} className="sr-only">
          {t('linkWs.repoSearch')}
        </label>
        <SearchIcon className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-subtle" />
        <Input
          id={searchId}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('linkWs.repoSearchPlaceholder')}
          className="pl-10"
          autoComplete="off"
        />
      </div>

      <div
        role="radiogroup"
        aria-label={t('linkWs.repoSearch')}
        className="flex max-h-60 flex-col overflow-y-auto rounded-lg border border-stroke bg-canvas"
      >
        {repos === null ? (
          <div className="flex flex-col gap-2 p-3" aria-busy="true">
            <span className="text-[13px] text-muted">{t('linkWs.reposLoading')}</span>
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : null}
        {typedOutsideList ? (
          <RepoOption
            label={t('linkWs.useTyped', { repo: `${typed.owner}/${typed.repo}` })}
            checked={selected?.owner === typed.owner && selected?.name === typed.repo}
            onSelect={() => setSelected({ owner: typed.owner, name: typed.repo, defaultBranch: typed.branch })}
          />
        ) : null}
        {filtered.slice(0, 200).map((repo) => (
          <RepoOption
            key={repo.fullName}
            label={repo.fullName}
            description={repo.description}
            isPrivate={repo.private}
            privateLabel={t('linkWs.private')}
            checked={selected?.owner === repo.owner && selected?.name === repo.name}
            onSelect={() => setSelected({ owner: repo.owner, name: repo.name, defaultBranch: repo.defaultBranch })}
          />
        ))}
        {repos !== null && filtered.length === 0 && !typedOutsideList ? (
          <p className="p-3 text-[13px] leading-5 text-muted">{reposError ?? t('linkWs.reposEmpty')}</p>
        ) : null}
      </div>

      <p className="text-xs leading-5 text-subtle">{t('linkWs.orgHint')}</p>

      {selected ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={branchId} className="inline-flex items-center gap-1.5 text-[13px] font-medium text-text">
            <GitBranchIcon className="size-3.5 text-muted" />
            {t('linkWs.branch')}
          </label>
          {branches && branches.length > 0 ? (
            <select id={branchId} value={branch} onChange={(event) => setBranch(event.target.value)} className={SELECT_CLASS}>
              {branches.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          ) : (
            <Input
              id={branchId}
              value={branch}
              onChange={(event) => setBranch(event.target.value)}
              placeholder={branches === null ? t('linkWs.branchesLoading') : 'main'}
              disabled={branches === null}
            />
          )}
          {branchesError ? <p className="text-[13px] text-danger">{branchesError}</p> : null}
        </div>
      ) : null}

      <Button type="submit" disabled={!selected || busy} loading={busy} className="mt-1 w-full gap-2">
        {busy ? busyLabel : submitLabel}
      </Button>
    </form>
  );
}

function GithubBadge() {
  return (
    <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-surface-2 text-text ring-1 ring-stroke">
      <GitHubIcon className="size-7" />
    </div>
  );
}

function RepoOption({
  label,
  description,
  isPrivate,
  privateLabel,
  checked,
  onSelect,
}: {
  label: string;
  description?: string | null;
  isPrivate?: boolean;
  privateLabel?: string;
  checked: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onSelect}
      className={cn(
        'flex min-h-11 w-full items-center gap-3 border-b border-stroke px-3 py-2 text-left last:border-b-0',
        'transition-[background-color] duration-150',
        checked ? 'bg-accent-soft' : 'hover:bg-surface-2',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'grid size-4 shrink-0 place-items-center rounded-full border',
          checked ? 'border-accent' : 'border-stroke-strong',
        )}
      >
        {checked ? <span className="size-2 rounded-full bg-accent" /> : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-mono text-[13px] text-text">{label}</span>
        {description ? <span className="block truncate text-xs text-muted">{description}</span> : null}
      </span>
      {isPrivate ? (
        <span className="inline-flex shrink-0 items-center gap-1 rounded-xs border border-stroke px-1.5 py-0.5 text-[11px] text-muted">
          <LockIcon className="size-3" />
          {privateLabel}
        </span>
      ) : null}
    </button>
  );
}
