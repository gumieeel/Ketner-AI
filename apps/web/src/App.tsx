import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { ThemeSync } from '@/app/theme-sync';
import { AuthProvider } from '@/features/auth/auth-provider';
import { routes } from '@/router/routes';

/** Экспортируется для main.tsx: перед заменой готовой разметки нужно дождаться кода страницы. */
export const router = createBrowserRouter(routes);

export function App() {
  return (
    <AuthProvider>
      <ThemeSync>
        <RouterProvider router={router} />
      </ThemeSync>
    </AuthProvider>
  );
}
