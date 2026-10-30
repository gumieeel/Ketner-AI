/**
 * Feasibility Engine: можно ли сделать возможность в Ketner AI сейчас. Считает код по каталогу
 * (capabilities.ts) и по тому, что подключено у пользователя; модель на статус не влияет.
 */

import type { Language } from '../types.js';
import { CAPABILITIES, type CapabilityAvailability, type CapabilityId } from './capabilities.js';

export type FeasibilityStatus = 'ready' | 'needs_setup' | 'needs_integration' | 'not_supported';

/** Что есть у пользователя: от этого зависят шаги «настроить» и «подключить». */
export interface UserCapabilities {
  /** Есть купленные кредиты (API-ключи выдаются после покупки). */
  hasPurchasedCredits: boolean;
  githubConnected: boolean;
}

export interface FeasibilityItem {
  capability: CapabilityId;
  label: string;
  /** Что сделать или почему нельзя. */
  hint: string;
  status: FeasibilityStatus;
}

export interface Feasibility {
  status: FeasibilityStatus;
  /** Что мешает запуску: пусто у `ready`. */
  blockers: FeasibilityItem[];
  /** Что уже есть. */
  available: FeasibilityItem[];
}

const RANK: Readonly<Record<FeasibilityStatus, number>> = {
  ready: 0,
  needs_setup: 1,
  needs_integration: 2,
  not_supported: 3,
};

function statusOf(
  availability: CapabilityAvailability,
  id: CapabilityId,
  user: UserCapabilities,
): FeasibilityStatus {
  switch (availability) {
    case 'available':
      return 'ready';
    case 'setup':
      return id === 'api_access' && user.hasPurchasedCredits ? 'ready' : 'needs_setup';
    case 'integration':
      return id === 'github_repo' && user.githubConnected ? 'ready' : 'needs_integration';
    case 'unavailable':
      return 'not_supported';
  }
}

export function assessFeasibility(
  requires: readonly CapabilityId[],
  user: UserCapabilities,
  language: Language,
  otherRequirement?: string | null,
): Feasibility {
  // Без требований возможность ни на что не опирается — это сигнал, что модель её не продумала:
  // честнее считать её неподдерживаемой, чем «готовой».
  const ids: CapabilityId[] = requires.length > 0 ? [...requires] : ['other'];
  const items = ids.map((id): FeasibilityItem => {
    const capability = CAPABILITIES[id];
    return {
      capability: id,
      label: id === 'other' && otherRequirement ? otherRequirement : capability.label[language],
      hint: capability.hint[language],
      status: statusOf(capability.availability, id, user),
    };
  });
  const worst = items.reduce<FeasibilityStatus>(
    (current, item) => (RANK[item.status] > RANK[current] ? item.status : current),
    'ready',
  );
  return {
    status: worst,
    blockers: items.filter((item) => item.status !== 'ready'),
    available: items.filter((item) => item.status === 'ready'),
  };
}

export function feasibilityRank(status: FeasibilityStatus): number {
  return RANK[status];
}
