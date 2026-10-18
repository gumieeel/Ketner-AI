import { useEffect, type ReactNode } from 'react';
import { AuthNoticeToast } from '@/components/auth/auth-notice-toast';
import { GithubNoticeToast } from '@/components/github/github-notice';
import { useGithub } from '@/features/github/github-store';
import { useAuth } from './auth-store';

export function AuthProvider({ children }: { children: ReactNode }) {
  const restoreSession = useAuth((state) => state.restoreSession);
  const status = useAuth((state) => state.status);
  const userId = useAuth((state) => state.user?.id);

  useEffect(() => {
    void restoreSession();
  }, [restoreSession]);

  useEffect(() => {
    // Статус GitHub принадлежит аккаунту: при смене или выходе забываем его.
    useGithub.getState().reset();
  }, [userId]);

  useEffect(() => {
    // Возврат с GitHub: код обменивается на токен только в той сессии, что начала подключение.
    if (status === 'authenticated') void useGithub.getState().completeFromLocation();
  }, [status, userId]);

  return (
    <>
      {children}
      <GithubNoticeToast />
      <AuthNoticeToast />
    </>
  );
}
