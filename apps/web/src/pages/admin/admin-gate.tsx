import { useEffect, useState, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/features/auth/auth-store';
import { NotFoundPage } from '@/pages/not-found-page';

/**
 * Вход в /admin. Данные и так защищены сервером (403), но гостю не нужно видеть каркас админки и
 * запросы к /api/admin: гость — на вход с возвратом сюда, вошедший не-администратор — «не найдено».
 * Решение — после проверки сессии (одна на всех, auth-store): у входа только через cookie
 * сохранённой копии может не быть, и без проверки его увело бы на страницу входа.
 */
export function AdminGate({ children }: { children: ReactNode }) {
  const location = useLocation();
  const user = useAuth((state) => state.user);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let alive = true;
    void useAuth
      .getState()
      .restoreSession()
      .finally(() => {
        if (alive) setChecked(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  if (!checked) return <div aria-busy="true" className="min-h-dvh bg-canvas" />;
  if (!user) {
    const back = `${location.pathname}${location.search}`;
    return <Navigate to={`/login?redirect=${encodeURIComponent(back)}`} replace />;
  }
  if (!user.isAdmin) return <NotFoundPage />;
  return <>{children}</>;
}
