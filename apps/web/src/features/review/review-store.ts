import { create } from 'zustand';
import { ApiError } from '../chat/api';
import type { Language } from '../chat/types';
import { streamAnswerReview } from './api';
import type { AnswerReview, ReviewQuota, ReviewerInfo } from './types';

export interface LiveReview {
  status: 'running' | 'error';
  reviewer?: ReviewerInfo;
  error?: string;
  errorCode?: string;
}

interface ReviewState {
  /** Свежие итоги проверок по id сообщения (сохранённые приходят в `message.review`). */
  results: Record<string, AnswerReview>;
  /** Идущие и неудачные проверки по id сообщения. */
  live: Record<string, LiveReview>;
  /** Остаток проверок на сутки (после первой проверки в сессии). */
  quota: ReviewQuota | null;
  reviewAnswer: (conversationId: string, messageId: string, language: Language) => Promise<void>;
  dismissError: (messageId: string) => void;
  setQuota: (quota: ReviewQuota | null) => void;
}

function describe(error: unknown): { message: string; code?: string } {
  if (error instanceof ApiError) return { message: error.message, code: error.code };
  if (error instanceof Error) return { message: error.message };
  return { message: String(error) };
}

export const useReview = create<ReviewState>((set, get) => ({
  results: {},
  live: {},
  quota: null,

  reviewAnswer: async (conversationId, messageId, language) => {
    if (get().live[messageId]?.status === 'running') return;
    const patchLive = (patch: LiveReview | null) =>
      set((state) => {
        const live = { ...state.live };
        if (patch) live[messageId] = patch;
        else delete live[messageId];
        return { live };
      });
    patchLive({ status: 'running' });
    try {
      await streamAnswerReview(
        { conversationId, messageId, language },
        {
          onReviewer: (reviewer) => patchLive({ status: 'running', reviewer }),
          onDone: (review, quota) => {
            set((state) => ({
              results: { ...state.results, [messageId]: review },
              quota: quota ?? state.quota,
            }));
          },
        },
      );
      patchLive(null);
    } catch (error) {
      const { message, code } = describe(error);
      patchLive({ status: 'error', error: message, errorCode: code });
    }
  },

  dismissError: (messageId) =>
    set((state) => {
      if (!(messageId in state.live)) return state;
      const live = { ...state.live };
      delete live[messageId];
      return { live };
    }),

  setQuota: (quota) => set({ quota }),
}));
