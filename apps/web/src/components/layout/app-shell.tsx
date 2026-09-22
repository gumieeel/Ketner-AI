import { Outlet } from 'react-router-dom';
import { Header } from './header';
import { Sidebar } from './sidebar';

/** Каркас авторизованной части продукта: список чатов, шапка, рабочая область. */
export function AppShell() {
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
