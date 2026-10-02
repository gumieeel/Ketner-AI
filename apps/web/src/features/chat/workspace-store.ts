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

export const useWorkspace = create<WorkspaceStore>((set) => ({
  activeWorkspace: loadInitialWorkspace(),
  selectedFile: null,
  isLinking: false,
  linkError: null,

  setWorkspace: (workspace) => {
    try {
      if (workspace) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace));
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
}));
