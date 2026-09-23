import { render } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { ThemeSync } from '@/app/theme-sync';
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
  useChat.setState({
    conversations: [],
    conversationsStatus: 'idle',
    activeId: null,
    messages: [],
    messagesStatus: 'idle',
    meta: null,
    streaming: false,
    search: '',
    draft: '',
  });
}
