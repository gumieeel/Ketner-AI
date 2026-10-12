import { useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { useAuth } from '@/features/auth/auth-store';
import { useChat } from '@/features/chat/chat-store';
import { canAccessModel, findModel } from '@/features/chat/can-access-model';
import { usePreferences } from '@/features/preferences/preferences-store';
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
  const authStatus = useAuth((state) => state.status);
  const meta = useChat((state) => state.meta);
  const chatModelId = usePreferences((state) => state.chatModelId);
  const setChatModelId = usePreferences((state) => state.setChatModelId);

  useEffect(() => {
    void restoreSession();
  }, [restoreSession]);

  useEffect(() => {
    // Список диалогов и каталог моделей нужны всем экранам рабочей области.
    void loadConversations();
    void loadMeta();
  }, [loadConversations, loadMeta, user]);

  useEffect(() => {
    // Выбор модели хранится в браузере и переживает смену аккаунта: после входа под тарифом ниже
    // (или выхода) недоступная модель сбрасывается на Auto, а не остаётся выбранной с замком.
    if (authStatus === 'loading') return;
    const model = findModel(meta?.models, chatModelId);
    if (model.id !== chatModelId || !canAccessModel(user?.plan, model)) {
      if (chatModelId !== 'auto') setChatModelId('auto');
    }
  }, [authStatus, user?.plan, meta, chatModelId, setChatModelId]);

  const { t } = useTranslation();

  return (
    <div className="flex h-full h-[100dvh] overflow-hidden bg-canvas text-text">
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
