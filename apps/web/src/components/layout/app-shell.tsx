import { useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { useAuth } from '@/features/auth/auth-store';
import { useChat } from '@/features/chat/chat-store';
import { useTranslation } from '@/i18n';
import { UpgradeModal } from '@/components/chat/upgrade-modal';
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

  const { t } = useTranslation();

  return (
    <div className="flex h-full overflow-hidden bg-canvas text-text">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-accent focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-accent-text focus:shadow-lg focus:outline-none"
      >
        {t('nav.skipToContent')}
      </a>
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header />
        <main
          id="main-content"
          tabIndex={-1}
          className="min-h-0 flex-1 overflow-y-auto outline-none"
        >
          <Outlet />
        </main>
      </div>
      <UpgradeModal />
    </div>
  );
}
