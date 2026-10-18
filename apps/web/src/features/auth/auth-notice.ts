import { create } from 'zustand';

/** Короткое уведомление после входа, регистрации или смены пароля (показывает AuthNoticeToast). */
export type AuthNotice = 'signed-up' | 'logged-in' | 'password-reset';

interface AuthNoticeState {
  notice: AuthNotice | null;
  show: (notice: AuthNotice) => void;
  dismiss: () => void;
}

export const useAuthNotice = create<AuthNoticeState>((set) => ({
  notice: null,
  show: (notice) => set({ notice }),
  dismiss: () => set({ notice: null }),
}));
