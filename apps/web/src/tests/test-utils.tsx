import { render } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { ThemeSync } from '@/app/theme-sync';
import { usePreferences } from '@/features/preferences/preferences-store';
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
  usePreferences.setState({ theme: 'dark', language: 'ru', sidebarOpen: false });
  window.localStorage.clear();
  document.documentElement.classList.remove('dark');
}
