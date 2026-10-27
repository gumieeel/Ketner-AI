import { create } from 'zustand';
import { useAuth } from '../auth/auth-store';
import { cancelSubscription as apiCancel, fetchSubscription } from './api';
import type { PlanId, Subscription } from './types';

/**
 * Подписка прежней системы. Новые подписки не продаются, но у тех, кто оплатил период раньше,
 * она действует до конца срока — её видно в настройках и можно отключить.
 */
interface BillingState {
  subscription: Subscription | null;
  loading: boolean;
  error: string | null;
  loadSubscription: () => Promise<void>;
  cancel: () => Promise<void>;
  setSubscription: (subscription: Subscription | null, userPlan: PlanId) => void;
}

export const useBilling = create<BillingState>((set) => ({
  subscription: null,
  loading: false,
  error: null,

  setSubscription: (subscription, userPlan) => {
    set({ subscription, loading: false });
    const currentUser = useAuth.getState().user;
    if (currentUser) {
      useAuth.setState({ user: { ...currentUser, plan: userPlan } });
    }
  },

  loadSubscription: async () => {
    try {
      set({ loading: true, error: null });
      const subscription = await fetchSubscription();
      set({ subscription, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  cancel: async () => {
    set({ loading: true, error: null });
    try {
      const result = await apiCancel();
      set({ subscription: result.subscription, loading: false });
      const currentUser = useAuth.getState().user;
      if (currentUser) {
        useAuth.setState({ user: { ...currentUser, plan: result.user.plan } });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Ошибка отмены подписки';
      set({ loading: false, error: message });
      throw error;
    }
  },
}));
