import {
  DEFAULT_LANGUAGE,
  usePreferences,
  type Language,
} from '@/features/preferences/preferences-store';
import { en } from './en';
import { ru, type TranslationKey } from './ru';

export const dictionaries: Record<Language, Record<TranslationKey, string>> = { ru, en };

export type { TranslationKey };

export function translate(
  language: Language,
  key: TranslationKey,
  vars?: Record<string, string | number>,
): string {
  const template = dictionaries[language]?.[key] ?? dictionaries[DEFAULT_LANGUAGE][key] ?? key;
  if (!vars) {
    return template;
  }
  return Object.entries(vars).reduce(
    (result, [name, value]) => result.replaceAll(`{${name}}`, String(value)),
    template,
  );
}

export interface Translator {
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
  language: Language;
}

/** Хук перевода. Словари маленькие, поэтому мемоизация здесь не нужна. */
export function useTranslation(): Translator {
  const language = usePreferences((state) => state.language);
  return {
    language,
    t: (key, vars) => translate(language, key, vars),
  };
}
