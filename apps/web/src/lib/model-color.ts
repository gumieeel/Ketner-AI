import { getModelBrand, type ModelBrand } from '@/components/icons/brands';

/** Цвет бренда модели — переменная из дизайн-токенов, поэтому сам подстраивается под тему. */
const BRAND_COLOR: Record<ModelBrand, string> = {
  openai: 'var(--model-gpt)',
  anthropic: 'var(--model-claude)',
  google: 'var(--model-gemini)',
  xai: 'var(--model-grok)',
  deepseek: 'var(--model-deepseek)',
  ketner: 'var(--model-ketner)',
};

/** CSS-значение цвета модели. Для `auto` — акцент бренда. */
export function modelColor(modelId: string): string {
  if (modelId === 'auto') {
    return 'var(--accent)';
  }
  return BRAND_COLOR[getModelBrand(modelId)];
}
