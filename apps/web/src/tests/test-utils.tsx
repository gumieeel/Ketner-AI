import { render } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { ThemeSync } from '@/app/theme-sync';
import { useAuth } from '@/features/auth/auth-store';
import { useBilling } from '@/features/billing/billing-store';
import { resetFreeUsage } from '@/features/billing/free-usage';
import { useUpgradeModal } from '@/features/billing/upgrade-modal-store';
import { useChat } from '@/features/chat/chat-store';
import { DEFAULT_MODEL_ID, usePreferences } from '@/features/preferences/preferences-store';
import { routes } from '@/router/routes';

/** Рендерит приложение на заданном маршруте — так же, как это делает App. */
export function renderRoute(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  return render(
    <ThemeSync>
      <RouterProvider router={router} />
    </ThemeSync>,
  );
}

/** Возвращает UI-настройки к исходным: стор живёт на уровне модуля. */
export function resetPreferences(): void {
  usePreferences.setState({
    theme: 'dark',
    language: 'ru',
    sidebarOpen: false,
    chatModelId: DEFAULT_MODEL_ID,
  });
  window.localStorage.clear();
  document.documentElement.classList.remove('dark');
}

/** Возвращает стор чата к исходному состоянию: он живёт на уровне модуля. */
export function resetChat(): void {
  useUpgradeModal.getState().close();
  resetFreeUsage();
  useChat.setState({
    conversations: [],
    conversationsStatus: 'idle',
    activeId: null,
    messages: [],
    messagesStatus: 'idle',
    meta: null,
    streaming: false,
    streamingConversations: {},
    conversationMessages: {},
    search: '',
    draft: '',
  });
}

/** Сбрасывает состояние авторизации к гостевому. */
export function resetAuth(): void {
  useAuth.setState({
    user: null,
    token: null,
    status: 'unauthenticated',
    error: null,
  });
  window.localStorage.clear();
}

/** Сбрасывает состояние биллинга к исходному. */
export function resetBilling(): void {
  useBilling.setState({
    subscription: null,
    loading: false,
    error: null,
  });
}
