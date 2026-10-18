import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { usePreferences } from '@/features/preferences/preferences-store';
import { hasEnglishTwin, isEnPath, localizePath } from '@/lib/locale-path';

/**
 * Связывает язык интерфейса с адресом страницы.
 * — Открыли /en/...: включается английский.
 * — Выбран английский, а открыли русский адрес страницы с английской версией: переходим на /en/...
 *   (посетитель без сохранённого языка остаётся на русской версии, автоопределения по браузеру нет).
 * Реагирует только на смену адреса: переключатель языка сам меняет и язык, и адрес.
 */
export function useLocaleSync(): void {
  const { pathname, search, hash } = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const { language, setLanguage } = usePreferences.getState();
    if (isEnPath(pathname)) {
      if (language !== 'en') setLanguage('en');
    } else if (language === 'en' && hasEnglishTwin(pathname)) {
      navigate(`${localizePath(pathname, 'en')}${search}${hash}`, { replace: true });
    }
    // search и hash не влияют на выбор языка
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, navigate]);

  const language = usePreferences((state) => state.language);
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);
}
