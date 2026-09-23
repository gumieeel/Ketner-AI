import { useEffect } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { ThemeSync } from '@/app/theme-sync';
import { useAuth } from '@/features/auth/auth-store';
import { routes } from '@/router/routes';

const router = createBrowserRouter(routes);

export function App() {
  const restoreSession = useAuth((state) => state.restoreSession);

  useEffect(() => {
    void restoreSession();
  }, [restoreSession]);

  return (
    <ThemeSync>
      <RouterProvider router={router} />
    </ThemeSync>
  );
}
