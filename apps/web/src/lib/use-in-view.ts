import { useEffect, useRef, useState, type RefObject } from 'react';

export interface UseInViewOptions {
  once?: boolean;
  threshold?: number;
  rootMargin?: string;
}

export function useInView<T extends HTMLElement = HTMLDivElement>(
  options: UseInViewOptions = {},
): [RefObject<T | null>, boolean] {
  const { once = true, threshold = 0.1, rootMargin = '0px' } = options;
  const ref = useRef<T | null>(null);

  // В тестах или при отсутствии IntersectionObserver сразу видно
  const [isInView, setIsInView] = useState(() => {
    if (typeof window === 'undefined') return true;
    if (typeof IntersectionObserver === 'undefined') return true;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return true;
    return false;
  });

  useEffect(() => {
    if (isInView && once) return;
    if (typeof IntersectionObserver === 'undefined') return;

    const element = ref.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsInView(true);
          if (once) {
            observer.unobserve(element);
          }
        } else if (!once) {
          setIsInView(false);
        }
      },
      { threshold, rootMargin },
    );

    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [once, threshold, rootMargin, isInView]);

  return [ref, isInView];
}
