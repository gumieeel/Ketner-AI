import { useRef, useState, type ChangeEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeftIcon, CloseIcon, DownloadIcon, FileTextIcon, PlusIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Spinner } from '@/components/ui/spinner';
import { useCode } from '@/features/code/code-store';
import { useTranslation } from '@/i18n';
import { cn } from '@/lib/cn';
import { AgentPanel } from './agent-panel';
import { CodeEditor } from './code-editor';
import { FileTree } from './file-tree';

type MobilePane = 'files' | 'editor' | 'agent';

const baseName = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

function Notice() {
  const { t } = useTranslation();
  const notice = useCode((state) => state.notice);
  const dismiss = useCode((state) => state.dismissNotice);
  if (!notice) return null;
  const error = notice.kind === 'message' && notice.tone === 'error';
  return (
    <div
      role={error ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-2 border-b px-3 py-2 text-[13px]',
        error ? 'border-danger/30 bg-danger-soft text-danger' : 'border-stroke bg-surface-2 text-text',
      )}
    >
      <div className="min-w-0 flex-1">
        {notice.kind === 'message' ? (
          <p>{notice.text}</p>
        ) : (
          <>
            <p>{t('code.import.result', { written: notice.written, skipped: notice.skippedCount })}</p>
            {notice.details.length > 0 ? (
              <details className="mt-1">
                <summary className="cursor-pointer text-muted">{t('code.import.skippedTitle')}</summary>
                <ul className="mt-1 max-h-32 overflow-y-auto font-mono text-xs text-muted">
                  {notice.details.map((item) => (
                    <li key={item.path} className="truncate">
                      {item.path} — {item.reason}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </>
        )}
      </div>
      <IconButton label={t('code.notice.close')} size="sm" onClick={dismiss}>
        <CloseIcon className="size-3.5" />
      </IconButton>
    </div>
  );
}

function EditorPane() {
  const { t } = useTranslation();
  const openPaths = useCode((state) => state.openPaths);
  const activePath = useCode((state) => state.activePath);
  const buffers = useCode((state) => state.buffers);
  const running = useCode((state) => state.running);
  const setActive = useCode((state) => state.setActive);
  const closeFile = useCode((state) => state.closeFile);
  const editFile = useCode((state) => state.editFile);
  const saveFile = useCode((state) => state.saveFile);

  const buffer = activePath ? buffers[activePath] : undefined;
  const dirty = Boolean(buffer && buffer.status === 'ready' && buffer.content !== buffer.saved);

  if (openPaths.length === 0 || !activePath) {
    return (
      <div className="grid min-h-0 flex-1 place-items-center p-6 text-center">
        <div className="flex flex-col items-center gap-2 text-muted">
          <FileTextIcon className="size-8 text-subtle" />
          <p className="max-w-xs text-[13px] leading-5">{t('code.ws.noFile')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div role="tablist" className="flex shrink-0 overflow-x-auto border-b border-stroke bg-surface">
        {openPaths.map((path) => {
          const b = buffers[path];
          const isDirty = Boolean(b && b.status === 'ready' && b.content !== b.saved);
          const active = path === activePath;
          return (
            <div
              key={path}
              className={cn(
                'flex shrink-0 items-center border-r border-stroke',
                active ? 'bg-canvas text-text' : 'text-muted hover:bg-surface-2',
              )}
            >
              <button
                type="button"
                role="tab"
                aria-selected={active}
                title={path}
                onClick={() => setActive(path)}
                className="flex min-h-9 max-w-[12rem] items-center gap-1.5 pr-1 pl-3 text-[13px]"
              >
                <span className="truncate">{baseName(path)}</span>
                {isDirty ? <span aria-label={t('code.ws.unsaved')} className="size-1.5 shrink-0 rounded-full bg-warning" /> : null}
              </button>
              <IconButton label={t('code.ws.closeTab', { name: baseName(path) })} size="sm" onClick={() => closeFile(path)}>
                <CloseIcon className="size-3" />
              </IconButton>
            </div>
          );
        })}
      </div>

      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-stroke px-3 py-1.5">
        <span className="min-w-0 truncate font-mono text-xs text-muted" title={activePath}>
          {activePath}
        </span>
        <div className="flex shrink-0 items-center gap-2">
          <span className={cn('text-xs', dirty ? 'text-warning' : 'text-subtle')}>{dirty ? t('code.ws.unsaved') : t('code.ws.saved')}</span>
          <Button size="sm" variant="secondary" disabled={!dirty} onClick={() => void saveFile(activePath)}>
            {t('code.ws.save')}
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        {!buffer || buffer.status === 'loading' ? (
          <div className="flex items-center gap-2 p-4 text-[13px] text-muted">
            <Spinner className="size-4" /> {t('code.ws.loading')}
          </div>
        ) : buffer.status === 'binary' ? (
          <p className="p-4 text-[13px] text-muted">{t('code.ws.binary')}</p>
        ) : buffer.status === 'error' ? (
          <p role="alert" className="p-4 text-[13px] text-danger">
            {t('code.ws.loadError')}
            {buffer.error ? `: ${buffer.error}` : ''}
          </p>
        ) : (
          <CodeEditor
            key={activePath}
            path={activePath}
            value={buffer.content}
            readOnly={running}
            onChange={(value) => editFile(activePath, value)}
            onSave={() => void saveFile(activePath)}
            className="min-h-0 flex-1"
          />
        )}
      </div>
    </div>
  );
}

/** Рабочее пространство проекта: файлы, редактор и агент. На телефоне панели переключаются вкладками. */
export function Workspace() {
  const { t } = useTranslation();
  const project = useCode((state) => state.project);
  const files = useCode((state) => state.files);
  const running = useCode((state) => state.running);
  const exportZip = useCode((state) => state.exportZip);
  const importIntoProject = useCode((state) => state.importIntoProject);
  const [pane, setPane] = useState<MobilePane>('agent');
  const uploadRef = useRef<HTMLInputElement | null>(null);

  const onUpload = (event: ChangeEvent<HTMLInputElement>): void => {
    const list = event.target.files;
    if (list && list.length > 0) {
      const zip = list.length === 1 && /\.zip$/i.test(list[0].name);
      void importIntoProject(list, zip);
    }
    event.target.value = '';
  };

  const tabs: Array<{ id: MobilePane; label: string }> = [
    { id: 'files', label: t('code.ws.files') },
    { id: 'editor', label: t('code.ws.editor') },
    { id: 'agent', label: t('code.ws.agent') },
  ];

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-2 border-b border-stroke px-3 py-2">
        <Link
          to="/code"
          aria-label={t('code.ws.back')}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-[13px] text-muted transition-colors hover:bg-surface-2 hover:text-text"
        >
          <ArrowLeftIcon className="size-4" />
          <span className="hidden sm:inline">{t('code.ws.back')}</span>
        </Link>
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-text">{project?.name}</h2>
        <input ref={uploadRef} type="file" multiple className="sr-only" aria-label={t('code.ws.upload')} onChange={onUpload} />
        <Button size="sm" variant="ghost" disabled={running} onClick={() => uploadRef.current?.click()} leftIcon={<PlusIcon className="size-4" />}>
          <span className="max-sm:sr-only">{t('code.ws.upload')}</span>
        </Button>
        <Button size="sm" variant="ghost" disabled={files.length === 0} onClick={() => void exportZip()} leftIcon={<DownloadIcon className="size-4" />}>
          <span className="max-sm:sr-only">{t('code.ws.export')}</span>
        </Button>
      </div>

      <Notice />

      <div role="tablist" aria-label={project?.name} className="grid shrink-0 grid-cols-3 border-b border-stroke bg-surface xl:hidden">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={pane === tab.id}
            onClick={() => setPane(tab.id)}
            className={cn(
              'min-h-11 text-[13px] font-medium transition-colors',
              pane === tab.id ? 'border-b-2 border-accent text-text' : 'text-muted',
            )}
          >
            {tab.label}
            {tab.id === 'agent' && running ? <span className="ml-1.5 inline-block size-1.5 animate-pulse rounded-full bg-accent" /> : null}
          </button>
        ))}
      </div>

      <div className="flex min-h-0 min-w-0 flex-1">
        <section
          aria-label={t('code.ws.files')}
          className={cn('min-h-0 w-full min-w-0 flex-col border-stroke xl:flex xl:w-60 xl:shrink-0 xl:border-r', pane === 'files' ? 'flex' : 'hidden')}
        >
          <FileTree disabled={running} />
        </section>
        <section
          aria-label={t('code.ws.editor')}
          className={cn('min-h-0 min-w-0 flex-1 flex-col xl:flex', pane === 'editor' ? 'flex' : 'hidden')}
        >
          <EditorPane />
        </section>
        <section
          aria-label={t('code.ws.agent')}
          className={cn('min-h-0 w-full min-w-0 flex-col border-stroke xl:flex xl:w-[24rem] xl:shrink-0 xl:border-l 2xl:w-[28rem]', pane === 'agent' ? 'flex' : 'hidden')}
        >
          <AgentPanel />
        </section>
      </div>
    </div>
  );
}
