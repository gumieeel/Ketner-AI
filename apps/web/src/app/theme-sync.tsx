import { useEffect, type ReactNode } from 'react';
import { applyTheme, usePreferences } from '@/features/preferences/preferences-store';

/**
 * Приводит DOM в соответствие с выбранной темой.
 *
 * Тему до первой отрисовки применяет инлайновый скрипт в index.html;
 * этот компонент синхронизирует разметку при смене темы и используется
 * в тестах, где index.html не участвует.
 */
export function ThemeSync({ children }: { children: ReactNode }) {
  const theme = usePreferences((state) => state.theme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  return <>{children}</>;
}
