import { create } from 'zustand';

export type UpgradeReason = 'free_limit' | 'paid_model';

interface UpgradeModalOptions {
  reason: UpgradeReason;
  modelName?: string;
  requiredPlan?: string;
}

interface UpgradeModalState {
  isOpen: boolean;
  reason: UpgradeReason;
  modelName: string;
  requiredPlan: string;
  open: (options: UpgradeModalOptions) => void;
  close: () => void;
}

export const useUpgradeModal = create<UpgradeModalState>((set) => ({
  isOpen: false,
  reason: 'free_limit',
  modelName: '',
  requiredPlan: 'PRO',
  open: (options) =>
    set({
      isOpen: true,
      reason: options.reason,
      modelName: options.modelName ?? '',
      requiredPlan: options.requiredPlan ?? 'PRO',
    }),
  close: () => set({ isOpen: false }),
}));
