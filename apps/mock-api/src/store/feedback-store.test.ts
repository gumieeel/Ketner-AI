import test from 'node:test';
import assert from 'node:assert/strict';
import { FeedbackStore } from './feedback-store.js';
import { resolveEngineForModel } from '../ai/gateway.js';

test('FeedbackStore: сохранение лайков/дизлайков и обновление существующей оценки', () => {
  const store = new FeedbackStore();

  const r1 = store.recordFeedback({
    messageId: 'msg-1',
    conversationId: 'conv-1',
    modelId: 'gpt-6-astra',
    engineModelId: 'deepseek/deepseek-chat',
    complexityLevel: 'simple',
    rating: 'like',
  });

  assert.equal(r1.rating, 'like');
  assert.equal(store.list().length, 1);

  // Пользователь передумал и поставил дизлайк
  const r2 = store.recordFeedback({
    messageId: 'msg-1',
    conversationId: 'conv-1',
    modelId: 'gpt-6-astra',
    engineModelId: 'deepseek/deepseek-chat',
    complexityLevel: 'simple',
    rating: 'dislike',
    reason: 'hallucination',
  });

  assert.equal(r2.rating, 'dislike');
  assert.equal(r2.reason, 'hallucination');
  assert.equal(store.list().length, 1, 'Запись должна обновиться, а не дублироваться');
});

test('FeedbackStore: расчёт аналитики и порога авто-эскалации', () => {
  const store = new FeedbackStore();

  // До 3 оценок: авто-эскалация не включается из-за нехватки данных
  store.recordFeedback({
    messageId: 'msg-1',
    conversationId: 'c1',
    modelId: 'claude-fable',
    engineModelId: 'deepseek/deepseek-chat',
    complexityLevel: 'simple',
    rating: 'dislike',
  });

  let analytics = store.getAnalytics();
  assert.equal(analytics.summary.total, 1);
  assert.equal(analytics.summary.dislikes, 1);
  assert.equal(analytics.escalation.autoEscalateActive, false);
  assert.equal(store.shouldEscalateFromLightModel('claude-fable', 'simple'), false);

  // Добавляем ещё 2 дизлайка (всего 3 дизлайка из 3 оценок на light engine = 100% дизлайков)
  store.recordFeedback({
    messageId: 'msg-2',
    conversationId: 'c1',
    modelId: 'claude-fable',
    engineModelId: 'deepseek/deepseek-chat',
    complexityLevel: 'simple',
    rating: 'dislike',
  });
  store.recordFeedback({
    messageId: 'msg-3',
    conversationId: 'c1',
    modelId: 'gpt-6-astra',
    engineModelId: 'deepseek/deepseek-chat',
    complexityLevel: 'simple',
    rating: 'dislike',
  });

  analytics = store.getAnalytics();
  assert.equal(analytics.summary.total, 3);
  assert.equal(analytics.summary.dislikes, 3);
  assert.equal(analytics.escalation.lightEngineDislikeRate, 1.0);
  assert.equal(analytics.escalation.escalateToHeavyRecommended, true);
  assert.equal(analytics.escalation.autoEscalateActive, true);
  assert.equal(store.shouldEscalateFromLightModel('claude-fable', 'simple'), true);

  // Проверяем динамический роутер в gateway: простой запрос должен эскалироваться на Haiku 4.5
  const escalatedClaude = resolveEngineForModel('claude-fable', 'Привет', undefined, store);
  assert.equal(escalatedClaude.modelId, 'anthropic/claude-haiku-4.5');
  assert.match(escalatedClaude.engineName, /Escalated from Light/);

  // Проверяем роутер для GPT-6 Astra: простой запрос должен эскалироваться на Luna Pro
  const escalatedAstra = resolveEngineForModel('gpt-6-astra', 'Привет', undefined, store);
  assert.equal(escalatedAstra.modelId, 'openai/gpt-6-luna-pro');
  assert.match(escalatedAstra.engineName, /Escalated from Light/);
});

test('FeedbackStore: высокая удовлетворённость не вызывает эскалацию', () => {
  const store = new FeedbackStore();

  // Добавляем 4 положительных отзыва на лёгкие модели
  for (let i = 1; i <= 4; i++) {
    store.recordFeedback({
      messageId: `msg-${i}`,
      conversationId: 'c2',
      modelId: 'gpt-6-astra',
      engineModelId: 'deepseek/deepseek-chat',
      complexityLevel: 'simple',
      rating: 'like',
    });
  }

  const analytics = store.getAnalytics();
  assert.equal(analytics.summary.total, 4);
  assert.equal(analytics.summary.likes, 4);
  assert.equal(analytics.summary.satisfactionRate, 1.0);
  assert.equal(analytics.escalation.escalateToHeavyRecommended, false);
  assert.equal(analytics.escalation.autoEscalateActive, false);
  assert.equal(store.shouldEscalateFromLightModel('gpt-6-astra', 'simple'), false);

  // При отличных оценках простой запрос сохраняет лёгкий быстрый движок
  const routedAstra = resolveEngineForModel('gpt-6-astra', 'Привет', undefined, store);
  assert.equal(routedAstra.modelId, 'deepseek/deepseek-chat');
  assert.match(routedAstra.engineName, /DeepSeek Chat/);
});
