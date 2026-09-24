import { create } from 'zustand';
import { useAuth } from '../auth/auth-store';
import { cancelSubscription as apiCancel, checkout as apiCheckout, fetchSubscription } from './api';
import { PLANS } from './plans';
import type { Plan, PlanId, Subscription } from './types';

interface BillingState {
  subscription: Subscription | null;
  plans: Plan[];
  loading: boolean;
  error: string | null;
  loadSubscription: () => Promise<void>;
  checkout: (planId: PlanId) => Promise<void>;
  cancel: () => Promise<void>;
  setSubscription: (subscription: Subscription, userPlan: PlanId) => void;
}

export const useBilling = create<BillingState>((set) => ({
  subscription: null,
  plans: [...PLANS],
  loading: false,
  error: null,

  setSubscription: (subscription: Subscription, userPlan: PlanId) => {
    set({ subscription, loading: false });
    const currentUser = useAuth.getState().user;
    if (currentUser) {
      useAuth.setState({
        user: {
          ...currentUser,
          plan: userPlan,
        },
      });
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

  checkout: async (planId: PlanId) => {
    set({ loading: true, error: null });
    try {
      const result = await apiCheckout(planId);
      set({ subscription: result.subscription, loading: false });

      // Обновляем план у текущего пользователя в auth-store
      const currentUser = useAuth.getState().user;
      if (currentUser) {
        useAuth.setState({
          user: {
            ...currentUser,
            plan: result.user.plan,
          },
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Ошибка оформления подписки';
      set({ loading: false, error: message });
      throw error;
    }
  },

  cancel: async () => {
    set({ loading: true, error: null });
    try {
      const result = await apiCancel();
      set({ subscription: result.subscription, loading: false });

      const currentUser = useAuth.getState().user;
      if (currentUser) {
        useAuth.setState({
          user: {
            ...currentUser,
            plan: result.user.plan,
          },
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Ошибка отмены подписки';
      set({ loading: false, error: message });
      throw error;
    }
  },
}));
