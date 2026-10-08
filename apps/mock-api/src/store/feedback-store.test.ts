import test from 'node:test';
import assert from 'node:assert/strict';
import { FeedbackStore } from './feedback-store.js';
import { chooseReasoningEffort } from '../ai/reasoning-policy.js';

test('FeedbackStore: сохранение лайков/дизлайков и обновление существующей оценки', () => {
  const store = new FeedbackStore();

  const r1 = store.recordFeedback({
    messageId: 'msg-1',
    conversationId: 'conv-1',
    modelId: 'ketner-mini',
    engineModelId: 'openai/gpt-6-luna',
    complexityLevel: 'simple',
    rating: 'like',
  });

  assert.equal(r1.rating, 'like');
  assert.equal(store.list().length, 1);

  // Пользователь передумал и поставил дизлайк
  const r2 = store.recordFeedback({
    messageId: 'msg-1',
    conversationId: 'conv-1',
    modelId: 'ketner-mini',
    engineModelId: 'openai/gpt-6-luna',
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
    modelId: 'claude-haiku-5.5',
    engineModelId: 'openai/gpt-6-luna',
    complexityLevel: 'simple',
    rating: 'dislike',
  });

  let analytics = store.getAnalytics();
  assert.equal(analytics.summary.total, 1);
  assert.equal(analytics.summary.dislikes, 1);
  assert.equal(analytics.escalation.autoEscalateActive, false);
  assert.equal(store.shouldEscalateFromLightModel('claude-haiku-5.5', 'simple'), false);

  // Добавляем ещё 2 дизлайка (всего 3 дизлайка из 3 оценок на light engine = 100% дизлайков)
  store.recordFeedback({
    messageId: 'msg-2',
    conversationId: 'c1',
    modelId: 'claude-haiku-5.5',
    engineModelId: 'openai/gpt-6-luna',
    complexityLevel: 'simple',
    rating: 'dislike',
  });
  store.recordFeedback({
    messageId: 'msg-3',
    conversationId: 'c1',
    modelId: 'ketner-mini',
    engineModelId: 'openai/gpt-6-luna',
    complexityLevel: 'simple',
    rating: 'dislike',
  });

  analytics = store.getAnalytics();
  assert.equal(analytics.summary.total, 3);
  assert.equal(analytics.summary.dislikes, 3);
  assert.equal(analytics.escalation.lightEngineDislikeRate, 1.0);
  assert.equal(analytics.escalation.escalateToHeavyRecommended, true);
  assert.equal(analytics.escalation.autoEscalateActive, true);
  assert.equal(store.shouldEscalateFromLightModel('claude-haiku-5.5', 'simple'), true);

  // При высокой доле дизлайков глубина размышлений простого запроса растёт на шаг, модель не меняется
  const escalate = store.shouldEscalateFromLightModel('ketner-mini', 'simple');
  assert.equal(
    chooseReasoningEffort({ level: 'simple', category: 'general', plan: 'plus', stage: 'normal', costClass: 'lite', escalate }),
    'low',
  );
  assert.equal(
    chooseReasoningEffort({ level: 'moderate', category: 'general', plan: 'plus', stage: 'normal', costClass: 'work', escalate }),
    'medium',
  );
});

test('FeedbackStore: высокая удовлетворённость не вызывает эскалацию', () => {
  const store = new FeedbackStore();

  // Добавляем 4 положительных отзыва на лёгкие модели
  for (let i = 1; i <= 4; i++) {
    store.recordFeedback({
      messageId: `msg-${i}`,
      conversationId: 'c2',
      modelId: 'ketner-mini',
      engineModelId: 'openai/gpt-6-luna',
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
  assert.equal(store.shouldEscalateFromLightModel('ketner-mini', 'simple'), false);

  // При отличных оценках простой запрос остаётся на быстром ответе без размышлений
  const escalate = store.shouldEscalateFromLightModel('ketner-mini', 'simple');
  assert.equal(
    chooseReasoningEffort({ level: 'simple', category: 'general', plan: 'plus', stage: 'normal', costClass: 'lite', escalate }),
    'none',
  );
});
