import { useState } from 'react';
import { CloseIcon, CodeIcon, FileTextIcon, FolderIcon, GitHubIcon, SearchIcon, TrashIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { formatFileSize, getFileExtension } from '@/features/chat/attachment-utils';
import { useChat } from '@/features/chat/chat-store';
import type { WorkspaceFile } from '@/features/chat/types';
import { useWorkspace } from '@/features/chat/workspace-store';

interface WorkspaceModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function WorkspaceModal({ isOpen, onClose }: WorkspaceModalProps) {
  const activeWorkspace = useWorkspace((state) => state.activeWorkspace);
  const unlinkWorkspace = useWorkspace((state) => state.unlinkWorkspace);
  const setDraft = useChat((state) => state.setDraft);

  const [search, setSearch] = useState('');
  const [selectedFile, setSelectedFile] = useState<WorkspaceFile | null>(null);

  if (!isOpen || !activeWorkspace) return null;

  const filteredFiles = activeWorkspace.files.filter((file) =>
    file.path.toLowerCase().includes(search.toLowerCase()),
  );

  const handleAskAboutFile = (file: WorkspaceFile) => {
    setDraft(`Объясни назначение файла ${file.path} и как он работает в проекте ${activeWorkspace.name}:`);
    onClose();
  };

  const handleUnlink = () => {
    unlinkWorkspace();
    onClose();
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm animate-in fade-in duration-200"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex h-[85vh] w-full max-w-4xl flex-col rounded-2xl border border-stroke bg-canvas shadow-2xl overflow-hidden"
      >
        {/* Шапка модального окна */}
        <div className="flex items-center justify-between border-b border-stroke bg-surface px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-lg bg-surface-2 text-accent border border-stroke">
              {activeWorkspace.type === 'git_repo' ? (
                <GitHubIcon className="size-5" />
              ) : (
                <FolderIcon className="size-5" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold text-text">{activeWorkspace.name}</h2>
                <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-medium text-accent">
                  {activeWorkspace.type === 'git_repo' ? 'GitHub Репозиторий' : 'Локальная папка'}
                </span>
                {activeWorkspace.branch ? (
                  <span className="rounded-full border border-stroke px-2 py-0.5 font-mono text-[10px] text-muted">
                    {activeWorkspace.branch}
                  </span>
                ) : null}
              </div>
              <p className="text-xs text-muted mt-0.5">
                Проиндексировано: {activeWorkspace.filesCount} файлов кодовой базы
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleUnlink}
              className="text-danger hover:bg-danger-soft hover:text-danger gap-1.5"
            >
              <TrashIcon className="size-3.5" />
              Отвязать
            </Button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-text transition"
            >
              <CloseIcon className="size-4" />
            </button>
          </div>
        </div>

        {/* Тело: список файлов слева, просмотр содержимого справа */}
        <div className="flex min-h-0 flex-1">
          {/* Левая панель: поиск и список файлов */}
          <div className="flex w-72 sm:w-80 flex-col border-r border-stroke bg-canvas">
            <div className="p-3 border-b border-stroke">
              <div className="relative">
                <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted" />
                <input
                  type="text"
                  placeholder="Поиск по файлам..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full rounded-md border border-stroke bg-surface py-1.5 pl-8 pr-3 text-xs text-text outline-none placeholder:text-muted focus:border-accent"
                />
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-2 space-y-1">
              {filteredFiles.length === 0 ? (
                <div className="p-4 text-center text-xs text-muted">
                  Файлы не найдены
                </div>
              ) : (
                filteredFiles.map((file) => {
                  const ext = getFileExtension(file.path).toUpperCase();
                  const isSelected = selectedFile?.path === file.path;

                  return (
                    <button
                      key={file.path}
                      type="button"
                      onClick={() => setSelectedFile(file)}
                      className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs transition ${
                        isSelected
                          ? 'bg-accent-soft text-accent font-medium'
                          : 'text-text hover:bg-surface'
                      }`}
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <FileTextIcon className="size-3.5 shrink-0 text-muted" />
                        <span className="truncate">{file.path}</span>
                      </div>
                      <span className="shrink-0 font-mono text-[10px] text-muted ml-2">
                        {ext || formatFileSize(file.size)}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Правая панель: просмотр файла */}
          <div className="flex min-h-0 flex-1 flex-col bg-surface-2/40">
            {selectedFile ? (
              <div className="flex h-full flex-col">
                <div className="flex items-center justify-between border-b border-stroke bg-surface px-4 py-2.5 text-xs">
                  <div className="flex items-center gap-2 overflow-hidden">
                    <CodeIcon className="size-4 text-accent shrink-0" />
                    <span className="font-mono font-medium text-text truncate">{selectedFile.path}</span>
                    <span className="text-muted">({formatFileSize(selectedFile.size)})</span>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleAskAboutFile(selectedFile)}
                    className="shrink-0 text-xs"
                  >
                    Спросить ИИ об этом файле
                  </Button>
                </div>

                <div className="min-h-0 flex-1 overflow-auto p-4 font-mono text-xs text-text bg-canvas">
                  {selectedFile.content ? (
                    <pre className="whitespace-pre-wrap leading-relaxed">{selectedFile.content}</pre>
                  ) : (
                    <div className="flex h-full items-center justify-center text-muted">
                      Содержимое файла не предзагружено (файл доступен по пути в структуре проекта)
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex h-full flex-col items-center justify-center p-6 text-center text-muted">
                <CodeIcon className="size-10 mb-2 opacity-40 text-accent" />
                <p className="text-sm font-medium text-text">Выберите файл для просмотра</p>
                <p className="text-xs max-w-sm mt-1">
                  ИИ видит структуру всего проекта и использует его код при ответах на ваши вопросы в чате
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
