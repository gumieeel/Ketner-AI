import { create } from 'zustand';
import type { WorkspaceContext, WorkspaceFile } from './types';

const STORAGE_KEY = 'ketner.workspace';
const AUTO_APPLY_KEY = 'ketner.workspace.auto_apply';

interface WorkspaceStore {
  activeWorkspace: WorkspaceContext | null;
  selectedFile: WorkspaceFile | null;
  isLinking: boolean;
  linkError: string | null;
  autoApply: boolean;

  setWorkspace: (workspace: WorkspaceContext | null) => void;
  unlinkWorkspace: () => void;
  selectFile: (file: WorkspaceFile | null) => void;
  setIsLinking: (isLinking: boolean) => void;
  setLinkError: (error: string | null) => void;
  setAutoApply: (autoApply: boolean) => void;
  updateWorkspaceFiles: (updatedFiles: Array<{ path: string; content?: string }>) => void;
  removeWorkspaceFile: (path: string) => void;
}

function loadInitialAutoApply(): boolean {
  try {
    return localStorage.getItem(AUTO_APPLY_KEY) === 'true';
  } catch {
    return false;
  }
}

/**
 * Ранние версии хранили пути локальной папки вместе с именем корня (`my-app/src/a.ts`),
 * из-за чего правки создавали вложенную копию `my-app/my-app/...`. Здесь такие проекты
 * приводятся к путям относительно корня.
 */
export function normalizeWorkspacePaths(ws: WorkspaceContext): WorkspaceContext {
  if (ws.type !== 'local_folder' || !ws.name || !Array.isArray(ws.files) || ws.files.length === 0) return ws;
  const prefix = `${ws.name}/`;
  if (!ws.files.every((f) => f.path.startsWith(prefix))) return ws;
  return {
    ...ws,
    files: ws.files.map((f) => ({ ...f, path: f.path.slice(prefix.length) })),
  };
}

function loadInitialWorkspace(): WorkspaceContext | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    // Ранние версии хранили здесь личный токен GitHub. Теперь доступ идёт через привязанный
    // аккаунт на сервере, а старый токен из браузера убираем.
    const { gitToken: legacyToken, ...stored } = JSON.parse(raw) as WorkspaceContext & { gitToken?: string };
    if (legacyToken !== undefined) localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    return normalizeWorkspacePaths(stored);
  } catch {
    return null;
  }
}

const STORED_CONTENT_LIMIT = 4000;

/**
 * В localStorage хранится только начало файлов (квота ~5 МБ). Такие файлы помечаются `truncated`,
 * чтобы по обрезанной копии нельзя было ни «заменить фрагмент», ни показать её модели как целую.
 */
function sanitizeWorkspaceForStorage(ws: WorkspaceContext): WorkspaceContext {
  return {
    ...ws,
    files: (ws.files || []).map((f) => {
      const cut = !!f.content && f.content.length > STORED_CONTENT_LIMIT;
      return {
        path: f.path,
        size: f.size,
        language: f.language,
        content: cut ? f.content!.slice(0, STORED_CONTENT_LIMIT) : f.content,
        ...(cut || f.truncated ? { truncated: true } : {}),
      };
    }),
  };
}

export const useWorkspace = create<WorkspaceStore>((set) => ({
  activeWorkspace: loadInitialWorkspace(),
  selectedFile: null,
  isLinking: false,
  linkError: null,
  autoApply: loadInitialAutoApply(),

  setAutoApply: (autoApply) => {
    try {
      localStorage.setItem(AUTO_APPLY_KEY, String(autoApply));
    } catch {
      // noop
    }
    set({ autoApply });
  },

  setWorkspace: (workspace) => {
    try {
      if (workspace) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitizeWorkspaceForStorage(workspace)));
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      // Игнорируем ошибки квоты localStorage
    }
    set({ activeWorkspace: workspace, selectedFile: null, linkError: null });
  },

  unlinkWorkspace: () => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // noop
    }
    set({ activeWorkspace: null, selectedFile: null, linkError: null });
  },

  selectFile: (file) => set({ selectedFile: file }),
  setIsLinking: (isLinking) => set({ isLinking }),
  setLinkError: (linkError) => set({ linkError }),

  updateWorkspaceFiles: (updatedFiles) => {
    set((state) => {
      if (!state.activeWorkspace) return state;
      const currentFiles = [...(state.activeWorkspace.files || [])];
      for (const update of updatedFiles) {
        const idx = currentFiles.findIndex((f) => f.path === update.path);
        if (idx >= 0) {
          currentFiles[idx] = {
            ...currentFiles[idx],
            content: update.content,
            truncated: undefined,
            size: update.content ? new Blob([update.content]).size : currentFiles[idx].size,
          };
        } else {
          currentFiles.push({
            path: update.path,
            size: update.content ? new Blob([update.content]).size : 0,
            content: update.content,
            language: update.path.split('.').pop() || '',
          });
        }
      }

      const nextWs: WorkspaceContext = {
        ...state.activeWorkspace,
        files: currentFiles,
        filesCount: currentFiles.length,
      };

      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitizeWorkspaceForStorage(nextWs)));
      } catch {
        // noop
      }

      return { activeWorkspace: nextWs };
    });
  },

  removeWorkspaceFile: (path) => {
    set((state) => {
      if (!state.activeWorkspace) return state;
      const filtered = (state.activeWorkspace.files || []).filter((f) => f.path !== path);
      const nextWs: WorkspaceContext = {
        ...state.activeWorkspace,
        files: filtered,
        filesCount: filtered.length,
      };

      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitizeWorkspaceForStorage(nextWs)));
      } catch {
        // noop
      }

      return { activeWorkspace: nextWs };
    });
  },
}));
