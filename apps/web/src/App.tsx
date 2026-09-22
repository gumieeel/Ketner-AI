import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { ThemeSync } from '@/app/theme-sync';
import { routes } from '@/router/routes';

const router = createBrowserRouter(routes);

export function App() {
  return (
    <ThemeSync>
      <RouterProvider router={router} />
    </ThemeSync>
  );
}
