import { useAuth } from '@/features/auth/auth-store';
import { DEFAULT_MODELS } from './can-access-model';
import { useChat } from './chat-store';
import { maxCompareModels, sanitizeCompareModelIds } from './compare-policy';
import { useCompare } from './compare-store';
import type { ModelInfo } from './types';

/** Модели, отобранные для сравнения: из сохранённого выбора остаются доступные на тарифе. */
export function useCompareSelection(): {
  ids: string[];
  max: number;
  models: readonly ModelInfo[];
} {
  const user = useAuth((state) => state.user);
  const meta = useChat((state) => state.meta);
  const stored = useCompare((state) => state.modelIds);
  const models = meta && meta.models.length > 0 ? meta.models : DEFAULT_MODELS;
  return {
    ids: sanitizeCompareModelIds(stored, models, user?.plan),
    max: maxCompareModels(user?.plan),
    models,
  };
}
