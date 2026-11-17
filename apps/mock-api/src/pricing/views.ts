/**
 * Что видит клиент, а что — только администратор.
 *
 * Клиенту: работы (названия, что входит, сложность, на проверке ли), итоговый диапазон цены,
 * сроки, уверенность, допущения, неизвестные, исключения, ежемесячные расходы. Не видит: часы и
 * деньги по строкам, ставку, множители, резерв, внутренние заметки, назначенного администратора,
 * фактические затраты — по ним восстанавливается внутренняя экономика.
 *
 * Цена в тенге и сроки — только у работы команды (pricing/delivery.ts): то, что клиент делает сам в
 * Ketner, оплачивается тарифом, а того, чего в Ketner нет, никто не оценивает. Когда сметы выключены
 * администратором, скрыты и цена, и сроки.
 */

import { deliveryOf, type DeliveryContext } from './delivery.js';
import { PricingService } from './service.js';
import type { ImplementationRequest, StoredEstimate } from './types.js';

const NO_CONTEXT: DeliveryContext = { catalogPositions: null, monthlyRequests: null };

export function publicEstimate(
  stored: StoredEstimate,
  pricingEnabled: boolean,
  context: DeliveryContext = NO_CONTEXT,
  language: 'ru' | 'en' = 'ru',
) {
  const result = stored.result;
  const delivery = deliveryOf(result, context, language);
  const team = delivery.kind === 'team';
  const showPrice = pricingEnabled && team && result.priceKzt !== null;
  return {
    id: stored.id,
    scope: stored.scope,
    scopeKey: stored.scopeKey,
    opportunityIds: stored.opportunityIds,
    opportunityTitles: stored.opportunityTitles,
    solutionTypes: result.solutionTypes,
    /** null — цены нет: нужна техническая проверка или сметы временно выключены. */
    priceKzt: showPrice ? result.priceKzt : null,
    pricingDisabled: !pricingEnabled,
    minimumApplied: showPrice ? result.minimumApplied : false,
    sharedSavingsKzt: showPrice ? result.sharedSavingsKzt : null,
    workingDays: showPrice
      ? { min: result.duration.workingDaysMin, max: result.duration.workingDaysMax }
      : null,
    externalApproval: team && result.duration.externalApproval,
    delivery,
    confidence: result.confidence,
    confidenceReasons: result.confidenceReasons,
    requiresManualReview: result.requiresManualReview,
    technicalVerificationRequired: result.technicalVerificationRequired,
    work: result.lines
      .filter((line) => !line.projectTask)
      .map((line) => ({
        capabilityId: line.capabilityId,
        name: line.name,
        category: line.category,
        complexity: line.complexity,
        quantity: line.quantity,
        requiresManualReview: line.requiresManualReview,
        shared: line.sharedBy.length > 1,
        includes: line.includes,
        prerequisites: line.prerequisites,
      })),
    projectWork: result.lines.filter((line) => line.projectTask).map((line) => line.name),
    excluded: result.excluded.map((item) => ({
      capabilityId: item.capabilityId,
      name: item.name,
      reason: item.reason,
    })),
    unknownDirectCosts: result.unknownDirectCosts,
    assumptions: result.assumptions,
    unknowns: result.unknowns,
    exclusions: result.exclusions,
    monthly: {
      usdToKztRate: stored.monthly.usdToKztRate,
      // Прежняя подписка $15 / 7 500 кредитов больше не показывается (тариф — в `delivery.tier`).
      recurring: stored.monthly.recurring
        .filter((cost) => cost.kind === 'support')
        .map((cost) => ({ kind: cost.kind, amount: cost.amount })),
      usage: {
        status: stored.monthly.usage.status,
        monthlyRequests: stored.monthly.usage.monthlyRequests,
        // Микро-доллары → центы для показа; токены и модель клиенту не нужны.
        aiUsdCents: stored.monthly.usage.aiMicroUsd
          ? {
              min: Math.round(stored.monthly.usage.aiMicroUsd.min / 10_000),
              expected: Math.round(stored.monthly.usage.aiMicroUsd.expected / 10_000),
              max: Math.round(stored.monthly.usage.aiMicroUsd.max / 10_000),
            }
          : null,
        aiKzt: stored.monthly.usage.aiKzt,
        externalProviderFees: stored.monthly.usage.externalProviderFees,
      },
    },
    calculatedAt: stored.createdAt,
  };
}

export type PublicEstimate = ReturnType<typeof publicEstimate>;

export function publicRequest(request: ImplementationRequest, pricingEnabled = true) {
  const proposal = PricingService.proposalVisible(request) ? request.reviewed : null;
  return {
    id: request.id,
    analysisId: request.analysisId,
    scope: request.scope,
    status: request.status,
    opportunityTitles: request.snapshot.opportunityTitles,
    customerMessage: request.customerMessage,
    contact: request.contact,
    preliminary: publicEstimate(request.snapshot, pricingEnabled),
    proposal: proposal
      ? {
          priceKzt: proposal.priceKzt,
          workingDays: proposal.workingDays,
          customerNote: proposal.customerNote,
          approvedAt: proposal.approvedAt,
        }
      : null,
    canCancel: [
      'new',
      'reviewing',
      'clarification_needed',
      'technical_review',
      'proposal_preparing',
      'proposal_sent',
    ].includes(request.status),
    canAccept: request.status === 'proposal_sent' && Boolean(proposal),
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
  };
}
