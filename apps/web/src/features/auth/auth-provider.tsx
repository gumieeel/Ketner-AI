import { useEffect, type ReactNode } from 'react';
import { useAuth } from './auth-store';

export function AuthProvider({ children }: { children: ReactNode }) {
  const restoreSession = useAuth((state) => state.restoreSession);

  useEffect(() => {
    void restoreSession();
  }, [restoreSession]);

  return <>{children}</>;
}
