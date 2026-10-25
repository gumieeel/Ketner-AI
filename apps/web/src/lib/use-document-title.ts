import { useEffect } from 'react';

/** Задаёт заголовок вкладки на время жизни страницы и возвращает прежний при уходе. */
export function useDocumentTitle(title: string): void {
  useEffect(() => {
    const previous = document.title;
    document.title = title;
    return () => {
      document.title = previous;
    };
  }, [title]);
}
