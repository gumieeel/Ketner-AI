import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MODELS,
  MODEL_NAME_KEYS,
  canAccessModel,
  planRank,
  requiredPlanOf,
} from '@/features/chat/can-access-model';
import { REQUIRED_PLANS, canAccessModel as canAccessById } from '@/features/models/entitlements';
import { translate } from '@/i18n';
import type { ModelInfo, PlanId } from '@/features/chat/types';

const byId = (id: string): ModelInfo => {
  const model = DEFAULT_MODELS.find((item) => item.id === id);
  if (!model) {
    throw new Error(`Нет модели ${id} в каталоге`);
  }
  return model;
};

describe('доступ к моделям по тарифу (зеркало правила сервера)', () => {
  it('ранг тарифа: legacy-планы равны Pro, неизвестный тариф считается Free', () => {
    expect(planRank('free')).toBe(0);
    expect(planRank('plus')).toBe(1);
    expect(planRank('pro')).toBe(2);
    expect(planRank('gpt-pro')).toBe(2);
    expect(planRank('claude-pro')).toBe(2);
    expect(planRank('gemini-pro')).toBe(2);
    expect(planRank('ultra')).toBe(3);
    expect(planRank('какой-то-тариф')).toBe(0);
    expect(planRank(undefined)).toBe(0);
  });

  it('каталог по умолчанию повторяет публичный каталог сервера', () => {
    expect(
      DEFAULT_MODELS.map((model) => [model.id, model.name, model.requiredPlan ?? null]),
    ).toEqual([
      ['auto', '✨ Auto', null],
      ['ketner-mini', 'Ketner Mini', null],
      ['ketner-pro', 'Ketner Pro', 'plus'],
      ['claude-haiku-5.5', 'Claude Haiku 5.5', 'plus'],
      ['deepseek-v4.1-flash', 'DeepSeek V4.1 Flash', 'plus'],
      ['gpt-5.6-luna-pro', 'GPT-5.6 Luna Pro', 'plus'],
      ['qwen3.8-27b', 'Qwen3.8 27B', 'plus'],
      ['gemini-3.7-flash', 'Gemini 3.7 Flash', 'plus'],
      ['gpt-6.1-sol', 'GPT-6.1 Sol', 'plus'],
      ['claude-opus-5.5', 'Claude Opus 5.5', 'pro'],
      ['claude-sonnet-5.5', 'Claude Sonnet 5.5', 'pro'],
      ['gpt-6-astra', 'GPT-6 Astra', 'pro'],
      ['grok-4.7', 'Grok 4.7 xhigh', 'pro'],
      ['gpt-5.6-sol', 'GPT-5.6 Sol', 'pro'],
      ['gpt-5.6-terra', 'GPT-5.6 Terra xhigh', 'pro'],
    ]);
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

  it('REQUIRED_PLANS совпадает с requiredPlan каталога', () => {
    for (const model of DEFAULT_MODELS) {
      expect(REQUIRED_PLANS[model.id], model.id).toBe(requiredPlanOf(model) ?? 'free');
    }
  });

  const matrix: Array<[PlanId | undefined, string, boolean]> = [
    [undefined, 'auto', true],
    ['free', 'auto', true],
    ['free', 'ketner-mini', true],
    ['free', 'ketner-pro', false],
    ['free', 'gpt-6.1-sol', false],
    ['plus', 'ketner-pro', true],
    ['plus', 'claude-haiku-5.5', true],
    ['plus', 'deepseek-v4.1-flash', true],
    ['plus', 'gpt-6.1-sol', true],
    ['plus', 'claude-opus-5.5', false],
    ['plus', 'grok-4.7', false],
    ['plus', 'gpt-6-astra', false],
    ['plus', 'gpt-5.6-terra', false],
    ['pro', 'claude-opus-5.5', true],
    ['pro', 'grok-4.7', true],
    ['pro', 'gpt-6-astra', true],
    ['ultra', 'gpt-5.6-terra', true],
    ['gpt-pro', 'claude-opus-5.5', true],
    ['claude-pro', 'gpt-6.1-sol', true],
    ['gemini-pro', 'grok-4.7', true],
    ['ultra', 'claude-opus-5.5', true],
    ['ultra', 'ketner-pro', true],
  ];

  it.each(matrix)('тариф %s, модель %s → доступ: %s', (plan, modelId, expected) => {
    expect(canAccessModel(plan, byId(modelId))).toBe(expected);
    expect(canAccessById(plan, modelId)).toBe(expected);
  });

  it('платная модель без requiredPlan считается моделью Plus, а requiredPlan бесплатной модели игнорируется', () => {
    expect(requiredPlanOf({ id: 'x', name: 'X', contextMessages: 1, isPro: true })).toBe('plus');
    expect(
      requiredPlanOf({ id: 'x', name: 'X', contextMessages: 1, isPro: false, requiredPlan: 'pro' }),
    ).toBeNull();
  });
});
