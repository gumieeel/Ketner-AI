import { useMemo, useState, type FormEvent } from 'react';
import { ChevronDownIcon, ChevronRightIcon, EditIcon, FileTextIcon, FolderIcon, PlusIcon, TrashIcon } from '@/components/icons';
import { IconButton } from '@/components/ui/icon-button';
import { useCode, type ChangeKind } from '@/features/code/code-store';
import { buildTree, formatBytes, type TreeNode } from '@/features/code/tree';
import { useTranslation } from '@/i18n';
import { cn } from '@/lib/cn';

const CHANGE_MARK: Record<ChangeKind, string> = { create: 'A', modify: 'M', delete: 'D', move: 'R' };
const CHANGE_TONE: Record<ChangeKind, string> = {
  create: 'text-success',
  modify: 'text-warning',
  delete: 'text-danger',
  move: 'text-info',
};

/** Дерево файлов проекта: раскрытие каталогов, открытие, создание, переименование и удаление. */
export function FileTree({ disabled }: { disabled?: boolean }) {
  const { t } = useTranslation();
  const files = useCode((state) => state.files);
  const activePath = useCode((state) => state.activePath);
  const expanded = useCode((state) => state.expanded);
  const changed = useCode((state) => state.changed);
  const openFile = useCode((state) => state.openFile);
  const toggleDir = useCode((state) => state.toggleDir);
  const createFile = useCode((state) => state.createFile);
  const deleteEntry = useCode((state) => state.deleteEntry);
  const renameEntry = useCode((state) => state.renameEntry);

  const [creating, setCreating] = useState(false);
  const [newPath, setNewPath] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const tree = useMemo(() => buildTree(files), [files]);

  const submitCreate = (event: FormEvent): void => {
    event.preventDefault();
    const path = newPath.trim();
    if (!path) return;
    setCreating(false);
    setNewPath('');
    void createFile(path);
  };

  const submitRename = (event: FormEvent): void => {
    event.preventDefault();
    const target = renameValue.trim();
    const from = renaming;
    setRenaming(null);
    if (from && target && target !== from) void renameEntry(from, target);
  };

  const confirmDelete = (path: string): void => {
    if (window.confirm(t('code.ws.confirmDelete', { path }))) void deleteEntry(path);
  };

  const renderNode = (node: TreeNode, depth: number) => {
    const open = expanded[node.path] ?? depth === 0;
    const padding = { paddingLeft: `${depth * 12 + 8}px` };

    if (node.kind === 'dir') {
      return (
        <li key={node.path}>
          <div className="group flex items-center">
            <button
              type="button"
              onClick={() => toggleDir(node.path)}
              aria-expanded={open}
              style={padding}
              className="flex min-h-8 min-w-0 flex-1 items-center gap-1.5 rounded-md pr-2 text-left text-[13px] text-muted hover:bg-surface-2 hover:text-text"
            >
              {open ? <ChevronDownIcon className="size-3.5 shrink-0" /> : <ChevronRightIcon className="size-3.5 shrink-0" />}
              <FolderIcon className="size-3.5 shrink-0 text-accent" />
              <span className="truncate">{node.name}</span>
            </button>
          </div>
          {open ? <ul>{node.children.map((child) => renderNode(child, depth + 1))}</ul> : null}
        </li>
      );
    }

    const change = changed[node.path];
    if (renaming === node.path) {
      return (
        <li key={node.path} style={padding} className="pr-2">
          <form onSubmit={submitRename}>
            <input
              autoFocus
              value={renameValue}
              onChange={(event) => setRenameValue(event.target.value)}
              onBlur={() => setRenaming(null)}
              aria-label={t('code.ws.rename')}
              className="h-8 w-full rounded-md border border-accent/60 bg-canvas px-2 text-[13px] text-text outline-none"
            />
          </form>
        </li>
      );
    }
    return (
      <li key={node.path}>
        <div className="group flex items-center">
          <button
            type="button"
            onClick={() => void openFile(node.path)}
            aria-current={activePath === node.path ? 'true' : undefined}
            title={node.path}
            style={padding}
            className={cn(
              'flex min-h-8 min-w-0 flex-1 items-center gap-1.5 rounded-md pr-2 text-left text-[13px] transition-colors',
              activePath === node.path ? 'bg-surface-2 font-medium text-text' : 'text-muted hover:bg-surface-2 hover:text-text',
            )}
          >
            <FileTextIcon className="size-3.5 shrink-0 text-subtle" />
            <span className="truncate">{node.name}</span>
            {change ? (
              <span title={t('code.ws.changedByAgent')} className={cn('ml-auto shrink-0 font-mono text-[11px] font-semibold', CHANGE_TONE[change])}>
                {CHANGE_MARK[change]}
              </span>
            ) : (
              <span className="ml-auto hidden shrink-0 text-[11px] text-subtle group-hover:inline">{formatBytes(node.size ?? 0)}</span>
            )}
          </button>
          {!disabled ? (
            <span className="flex shrink-0 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 max-md:opacity-100">
              <IconButton
                label={t('code.ws.rename')}
                size="sm"
                onClick={() => {
                  setRenaming(node.path);
                  setRenameValue(node.path);
                }}
              >
                <EditIcon className="size-3.5" />
              </IconButton>
              <IconButton label={t('code.ws.delete')} size="sm" onClick={() => confirmDelete(node.path)}>
                <TrashIcon className="size-3.5" />
              </IconButton>
            </span>
          ) : null}
        </div>
      </li>
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-subtle">{t('code.ws.files')}</span>
        <IconButton label={t('code.ws.newFile')} size="sm" disabled={disabled} onClick={() => setCreating(true)}>
          <PlusIcon className="size-4" />
        </IconButton>
      </div>

      {creating ? (
        <form onSubmit={submitCreate} className="flex gap-1 px-2 pb-2">
          <input
            autoFocus
            value={newPath}
            onChange={(event) => setNewPath(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setCreating(false);
            }}
            placeholder={t('code.ws.newFilePlaceholder')}
            aria-label={t('code.ws.newFile')}
            className="h-8 min-w-0 flex-1 rounded-md border border-accent/60 bg-canvas px-2 text-[13px] text-text outline-none placeholder:text-subtle"
          />
        </form>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-3">
        {tree.length === 0 ? (
          <p className="px-3 py-6 text-center text-[13px] text-muted">{t('code.ws.emptyProject')}</p>
        ) : (
          <ul role="tree">{tree.map((node) => renderNode(node, 0))}</ul>
        )}
      </div>
    </div>
  );
}
