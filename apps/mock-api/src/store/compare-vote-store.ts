import { fileURLToPath } from 'node:url';
import { DocStore } from './doc-store.js';

/**
 * Выбор лучшего ответа в сравнении. Один документ на запуск сравнения (id = id запуска): смена
 * выбора перезаписывает голос, а не добавляет второй.
 */
export interface CompareVote {
  id: string;
  userId: string;
  conversationId: string;
  /** Тариф на момент голоса: по нему видно, что выбирают платящие. */
  plan: string;
  /** Модель, ответ которой выбрали (та, что реально ответила). */
  winnerModelId: string;
  /** Все модели, у которых был полноценный ответ: победитель среди них. */
  participantModelIds: string[];
  votedAt: string;
}

export interface CompareModelStat {
  modelId: string;
  /** В скольких сравнениях модель дала ответ, из которых можно было выбирать. */
  comparisons: number;
  wins: number;
  /** Доля побед, % (0–100, один знак). */
  winRatePct: number;
}

export class CompareVoteStore extends DocStore<CompareVote> {
  constructor(file?: string) {
    super('compare_votes', file);
  }

  /** Победы и участие по моделям: чаще всего выбираемые — первыми. */
  stats(): { totalVotes: number; models: CompareModelStat[] } {
    const votes = this.all();
    const byModel = new Map<string, { comparisons: number; wins: number }>();
    for (const vote of votes) {
      for (const modelId of new Set(vote.participantModelIds)) {
        const entry = byModel.get(modelId) ?? { comparisons: 0, wins: 0 };
        entry.comparisons += 1;
        if (modelId === vote.winnerModelId) entry.wins += 1;
        byModel.set(modelId, entry);
      }
    }
    const models = [...byModel.entries()]
      .map(([modelId, entry]) => ({
        modelId,
        comparisons: entry.comparisons,
        wins: entry.wins,
        winRatePct: Math.round((entry.wins / entry.comparisons) * 1000) / 10,
      }))
      .sort((a, b) => b.winRatePct - a.winRatePct || b.comparisons - a.comparisons);
    return { totalVotes: votes.length, models };
  }
}

/** Рабочее хранилище: файл на диске плюс зеркало в Postgres (см. db/sync.ts). */
export const compareVoteStore = new CompareVoteStore(
  process.env.COMPARE_VOTE_STORE_FILE ??
    fileURLToPath(new URL('../../data/compare-votes.json', import.meta.url)),
);
