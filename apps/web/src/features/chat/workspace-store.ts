import { create } from 'zustand';
import type { WorkspaceContext, WorkspaceFile } from './types';

const STORAGE_KEY = 'ketner.workspace';

interface WorkspaceStore {
  activeWorkspace: WorkspaceContext | null;
  selectedFile: WorkspaceFile | null;
  isLinking: boolean;
  linkError: string | null;

  setWorkspace: (workspace: WorkspaceContext | null) => void;
  unlinkWorkspace: () => void;
  selectFile: (file: WorkspaceFile | null) => void;
  setIsLinking: (isLinking: boolean) => void;
  setLinkError: (error: string | null) => void;
  updateWorkspaceFiles: (updatedFiles: Array<{ path: string; content?: string }>) => void;
  removeWorkspaceFile: (path: string) => void;
  setGitToken: (token: string) => void;
}

function loadInitialWorkspace(): WorkspaceContext | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as WorkspaceContext;
  } catch {
    return null;
  }
}

function sanitizeWorkspaceForStorage(ws: WorkspaceContext): WorkspaceContext {
  return {
    ...ws,
    files: (ws.files || []).map((f) => ({
      path: f.path,
      size: f.size,
      language: f.language,
      content: f.content && f.content.length > 4000 ? f.content.slice(0, 4000) : f.content,
    })),
  };
}

export const useWorkspace = create<WorkspaceStore>((set) => ({
  activeWorkspace: loadInitialWorkspace(),
  selectedFile: null,
  isLinking: false,
  linkError: null,

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

  setGitToken: (token) => {
    set((state) => {
      if (!state.activeWorkspace) return state;
      const updated: WorkspaceContext = {
        ...state.activeWorkspace,
        gitToken: token,
      };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitizeWorkspaceForStorage(updated)));
      } catch {
        // noop
      }
      return { activeWorkspace: updated };
    });
  },

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
