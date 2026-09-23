import { useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { useAuth } from '@/features/auth/auth-store';
import { useChat } from '@/features/chat/chat-store';
import { Header } from './header';
import { Sidebar } from './sidebar';

/** Каркас авторизованной части продукта: список чатов, шапка, рабочая область. */
export function AppShell() {
  const loadConversations = useChat((state) => state.loadConversations);
  const loadMeta = useChat((state) => state.loadMeta);
  const restoreSession = useAuth((state) => state.restoreSession);
  const user = useAuth((state) => state.user);

  useEffect(() => {
    void restoreSession();
  }, [restoreSession]);

  useEffect(() => {
    // Список диалогов и каталог моделей нужны всем экранам рабочей области.
    void loadConversations();
    void loadMeta();
  }, [loadConversations, loadMeta, user]);

  return (
    <div className="flex h-full overflow-hidden bg-white dark:bg-zinc-900">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header />
        <main className="min-h-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
