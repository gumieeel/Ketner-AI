const NAMESPACE = 'ketner';

/**
 * Обёртка над localStorage: единый префикс ключей и безопасная работа
 * в приватном режиме браузера, где запись может бросать исключение.
 */
export const storage = {
  key(name: string): string {
    return `${NAMESPACE}.${name}`;
  },

  get(name: string): string | null {
    try {
      return window.localStorage.getItem(this.key(name));
    } catch {
      return null;
    }
  },

  set(name: string, value: string): void {
    try {
      window.localStorage.setItem(this.key(name), value);
    } catch {
      /* хранилище недоступно — молча игнорируем */
    }
  },

  remove(name: string): void {
    try {
      window.localStorage.removeItem(this.key(name));
    } catch {
      /* хранилище недоступно — молча игнорируем */
    }
  },
};
