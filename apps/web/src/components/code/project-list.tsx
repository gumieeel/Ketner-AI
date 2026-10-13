import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CodeIcon, FolderIcon, PlusIcon, TrashIcon } from '@/components/icons';
import { GithubRepoPicker } from '@/components/github/github-repo-picker';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/input';
import { IconButton } from '@/components/ui/icon-button';
import { Skeleton } from '@/components/ui/skeleton';
import { useCode } from '@/features/code/code-store';
import { useGithub } from '@/features/github/github-store';
import { formatBytes } from '@/features/code/tree';
import { useTranslation, type TranslationKey } from '@/i18n';
import { formatShortDate } from '@/lib/format-date';

const TEMPLATE_KEYS: Record<string, TranslationKey> = {
  empty: 'code.template.empty',
  node: 'code.template.node',
  python: 'code.template.python',
  web: 'code.template.web',
};

type ImportMode = 'folder' | 'zip' | 'github';

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? (error.message === 'no_files' ? fallback : error.message) : fallback;
}

/** Создание проекта: название и шаблон. */
function CreateForm() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const capabilities = useCode((state) => state.capabilities);
  const createProject = useCode((state) => state.createProject);
  const [name, setName] = useState('');
  const [template, setTemplate] = useState('empty');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const templates = capabilities?.templates ?? ['empty', 'node', 'python', 'web'];

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const project = await createProject(name.trim() || t('code.projects.namePlaceholder'), template);
      navigate(`/code/${project.id}`);
    } catch (e) {
      setError(messageOf(e, t('code.projects.loadError')));
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-3">
      <Field label={t('code.projects.name')} id="code-project-name">
        {(props) => (
          <Input
            {...props}
            value={name}
            maxLength={80}
            onChange={(event) => setName(event.target.value)}
            placeholder={t('code.projects.namePlaceholder')}
          />
        )}
      </Field>
      <Field label={t('code.projects.template')} id="code-project-template">
        {(props) => (
          <select
            {...props}
            value={template}
            onChange={(event) => setTemplate(event.target.value)}
            className="h-12 w-full rounded-md border border-stroke bg-surface px-3 text-base text-text focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent-soft md:h-11 md:text-[15px]"
          >
            {templates.map((id) => (
              <option key={id} value={id}>
                {TEMPLATE_KEYS[id] ? t(TEMPLATE_KEYS[id]) : id}
              </option>
            ))}
          </select>
        )}
      </Field>
      {error ? (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      ) : null}
      <Button type="submit" loading={busy} leftIcon={<PlusIcon className="size-4" />}>
        {busy ? t('code.projects.creating') : t('code.projects.create')}
      </Button>
    </form>
  );
}

/** Импорт кода: папка, ZIP или репозиторий из подключённого GitHub (приватные тоже). */
function ImportForm() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const importFromFolder = useCode((state) => state.importFromFolder);
  const importFromZip = useCode((state) => state.importFromZip);
  const importGithub = useCode((state) => state.importGithub);
  const [mode, setMode] = useState<ImportMode>('folder');
  const resumeIntent = useGithub((state) => state.resumeIntent);
  const consumeGithubIntent = useGithub((state) => state.consumeIntent);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const folderRef = useRef<HTMLInputElement | null>(null);
  const zipRef = useRef<HTMLInputElement | null>(null);

  const run = async (action: () => Promise<{ id: string }>): Promise<void> => {
    setBusy(true);
    setError('');
    try {
      const project = await action();
      navigate(`/code/${project.id}`);
    } catch (e) {
      setError(messageOf(e, t('code.import.noFiles')));
      setBusy(false);
    }
  };

  const onFolder = (event: ChangeEvent<HTMLInputElement>): void => {
    const list = event.target.files;
    if (list && list.length > 0) void run(() => importFromFolder(list));
    event.target.value = '';
  };
  const onZip = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    if (file) void run(() => importFromZip(file));
    event.target.value = '';
  };
  useEffect(() => {
    // Вернулись после подключения GitHub из этой формы — сразу показываем выбор репозитория.
    if (resumeIntent === 'code-import' && consumeGithubIntent('code-import')) setMode('github');
  }, [resumeIntent, consumeGithubIntent]);

  const onGithub = ({ owner, repo, branch }: { owner: string; repo: string; branch: string }): void => {
    void run(() => importGithub(`https://github.com/${owner}/${repo}/tree/${encodeURIComponent(branch)}`));
  };

  const modes: Array<{ id: ImportMode; label: string }> = [
    { id: 'folder', label: t('code.import.folder') },
    { id: 'zip', label: t('code.import.zip') },
    { id: 'github', label: t('code.import.github') },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div role="group" aria-label={t('code.import.title')} className="grid grid-cols-3 gap-1 rounded-lg bg-surface-2 p-1">
        {modes.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={mode === item.id}
            disabled={busy}
            onClick={() => {
              setMode(item.id);
              setError('');
            }}
            className={
              mode === item.id
                ? 'min-h-9 rounded-md bg-surface text-[13px] font-medium text-text shadow-xs'
                : 'min-h-9 rounded-md text-[13px] text-muted hover:text-text'
            }
          >
            {item.label}
          </button>
        ))}
      </div>

      {mode === 'folder' ? (
        <>
          <input
            ref={folderRef}
            type="file"
            className="sr-only"
            aria-label={t('code.import.folder')}
            onChange={onFolder}
            // @ts-expect-error webkitdirectory не описан в типах React
            webkitdirectory=""
            multiple
          />
          <Button variant="secondary" loading={busy} onClick={() => folderRef.current?.click()} leftIcon={<FolderIcon className="size-4" />}>
            {busy ? t('code.import.working') : t('code.import.folder')}
          </Button>
        </>
      ) : null}

      {mode === 'zip' ? (
        <>
          <input ref={zipRef} type="file" accept=".zip,application/zip" className="sr-only" aria-label={t('code.import.zip')} onChange={onZip} />
          <Button variant="secondary" loading={busy} onClick={() => zipRef.current?.click()} leftIcon={<FolderIcon className="size-4" />}>
            {busy ? t('code.import.working') : t('code.import.zip')}
          </Button>
        </>
      ) : null}

      {mode === 'github' ? (
        <GithubRepoPicker
          intent="code-import"
          busy={busy}
          submitLabel={t('code.import.go')}
          busyLabel={t('code.import.working')}
          onPick={onGithub}
        />
      ) : null}

      {error ? (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      ) : null}
      <p className="text-xs leading-5 text-subtle">{t('code.import.note')}</p>
    </div>
  );
}

/** Экран «Ketner Code»: список проектов, создание и импорт. */
export function ProjectList() {
  const { t, language } = useTranslation();
  const projects = useCode((state) => state.projects);
  const status = useCode((state) => state.projectsStatus);
  const deleteProject = useCode((state) => state.deleteProject);
  const loadProjects = useCode((state) => state.loadProjects);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-6 px-4 py-6 md:px-6 lg:grid-cols-[1fr_20rem]">
      <section aria-labelledby="code-projects-title" className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 id="code-projects-title" className="text-lg font-semibold tracking-tight text-text">
              {t('code.projects.title')}
            </h2>
            <p className="text-[13px] text-muted">{t('code.subtitle')}</p>
          </div>
        </div>

        {status === 'loading' || status === 'idle' ? (
          <div className="flex flex-col gap-2" aria-busy="true">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : null}

        {status === 'error' ? (
          <div className="rounded-xl border border-danger/30 bg-danger-soft p-4 text-center">
            <p className="text-sm text-danger">{t('code.projects.loadError')}</p>
            <Button variant="outline" size="sm" className="mt-2" onClick={() => void loadProjects()}>
              {t('common.retry')}
            </Button>
          </div>
        ) : null}

        {status === 'ready' && projects.length === 0 ? (
          <div className="rounded-xl border border-dashed border-stroke-strong p-8 text-center">
            <span className="mx-auto mb-3 grid size-10 place-items-center rounded-xl bg-accent-soft text-accent">
              <CodeIcon className="size-5" />
            </span>
            <p className="text-sm font-medium text-text">{t('code.projects.empty')}</p>
            <p className="mx-auto mt-1 max-w-sm text-[13px] leading-5 text-muted">{t('code.projects.emptyHint')}</p>
          </div>
        ) : null}


        <ul className="flex flex-col gap-2">
          {projects.map((project) => (
            <li key={project.id} className="flex items-center gap-2 rounded-xl border border-stroke bg-surface p-1 pr-2 transition-colors hover:border-stroke-strong">
              <Link to={`/code/${project.id}`} className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-3 py-2.5">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
                  <FolderIcon className="size-4" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-text">{project.name}</span>
                  <span className="block truncate text-xs text-muted">
                    {t('code.projects.files', { count: project.fileCount })} · {formatBytes(project.totalBytes)} · {formatShortDate(project.updatedAt, language)}
                  </span>
                </span>
              </Link>
              {pendingDelete === project.id ? (
                <div className="flex shrink-0 items-center gap-1">
                  <span className="hidden text-xs text-danger sm:inline">{t('code.projects.confirmDelete', { name: project.name })}</span>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => {
                      setPendingDelete(null);
                      void deleteProject(project.id);
                    }}
                  >
                    {t('code.projects.delete')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setPendingDelete(null)}>
                    {t('code.ws.cancel')}
                  </Button>
                </div>
              ) : (
                <IconButton label={`${t('code.projects.delete')}: ${project.name}`} size="sm" onClick={() => setPendingDelete(project.id)}>
                  <TrashIcon className="size-4" />
                </IconButton>
              )}
            </li>
          ))}
        </ul>
      </section>

      <aside className="flex flex-col gap-4">
        <Card className="p-4">
          <CardTitle className="mb-3 text-sm">{t('code.projects.new')}</CardTitle>
          <CreateForm />
        </Card>
        <Card className="p-4">
          <CardTitle className="mb-3 text-sm">{t('code.import.title')}</CardTitle>
          <ImportForm />
        </Card>
      </aside>
    </div>
  );
}
