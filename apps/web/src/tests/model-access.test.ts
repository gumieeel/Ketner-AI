import { describe, expect, it } from 'vitest';
import { DEFAULT_MODELS, MODEL_NAME_KEYS, planRank } from '@/features/chat/model-catalog';
import { translate } from '@/i18n';

describe('каталог моделей: доступ открыт всем, платит только баланс кредитов', () => {
  it('ранг уровня доступа нужен только лимитам сравнения: кредиты равны Ultra, подписки прежней системы доживают срок', () => {
    expect(planRank('free')).toBe(0);
    expect(planRank('credits')).toBe(3);
    expect(planRank('plus')).toBe(1);
    expect(planRank('pro')).toBe(2);
    expect(planRank('gpt-pro')).toBe(2);
    expect(planRank('claude-pro')).toBe(2);
    expect(planRank('gemini-pro')).toBe(2);
    expect(planRank('ultra')).toBe(3);
    expect(planRank('какой-то-тариф')).toBe(0);
    expect(planRank(undefined)).toBe(0);
  });

  it('каталог по умолчанию повторяет публичный каталог сервера: те же id, названия и порядок', () => {
    expect(DEFAULT_MODELS.map((model) => [model.id, model.name])).toEqual([
      ['auto', '✨ Auto'],
      ['ketner-mini', 'Ketner Mini'],
      ['ketner-pro', 'Ketner Pro'],
      ['claude-haiku-5.5', 'Claude Haiku 5.5'],
      ['deepseek-v4.1-flash', 'DeepSeek V4.1 Flash'],
      ['gpt-5.6-luna-pro', 'GPT-5.6 Luna Pro'],
      ['qwen3.8-27b', 'Qwen3.8 27B'],
      ['gemini-3.7-flash', 'Gemini 3.7 Flash'],
      ['glm-5.3', 'GLM-5.3'],
      ['gpt-6.1-sol', 'GPT-6.1 Sol'],
      ['claude-opus-5.5', 'Claude Opus 5.5'],
      ['claude-sonnet-5.5', 'Claude Sonnet 5.5'],
      ['gpt-6-astra', 'GPT-6 Astra'],
      ['grok-4.7', 'Grok 4.7 xhigh'],
      ['gpt-5.6-sol', 'GPT-5.6 Sol'],
      ['gpt-5.6-terra', 'GPT-5.6 Terra xhigh'],
    ]);
  });

  it('у моделей каталога нет привязки к тарифу', () => {
    for (const model of DEFAULT_MODELS) {
      expect(Object.keys(model), model.id).not.toContain('requiredPlan');
      expect(Object.keys(model), model.id).not.toContain('isPro');
    }
  });

  it('у каждой модели каталога есть название в словаре, совпадающее с названием каталога', () => {
    for (const model of DEFAULT_MODELS) {
      const key = MODEL_NAME_KEYS[model.id];
      expect(key, model.id).toBeDefined();
      for (const language of ['ru', 'en'] as const) {
        expect(model.name.replace(/^✨\s*/, ''), `${model.id}/${language}`).toBe(
          translate(language, key),
        );
      }
    }
  });
});
