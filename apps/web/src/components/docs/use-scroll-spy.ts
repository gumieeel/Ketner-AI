import { useEffect, useState } from 'react';

/** Возвращает id раздела, который сейчас в верхней части экрана. */
export function useScrollSpy(ids: readonly string[]): string {
  const [activeId, setActiveId] = useState<string>(ids[0] ?? '');
  // Страницы передают новый массив на каждый рендер: подписку держим по содержимому.
  const key = ids.join('|');

  useEffect(() => {
    if (typeof window === 'undefined' || typeof IntersectionObserver === 'undefined') {
      return;
    }
    const sectionIds = key ? key.split('|') : [];
    const elements = sectionIds
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);

    if (elements.length === 0) return;

    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            visible.add(entry.target.id);
          } else {
            visible.delete(entry.target.id);
          }
        }
        // Из видимых берём самый верхний по порядку в списке.
        const first = sectionIds.find((id) => visible.has(id));
        if (first) {
          setActiveId(first);
        }
      },
      { rootMargin: '-120px 0px -60% 0px', threshold: 0 },
    );

    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [key]);

  return activeId;
}
