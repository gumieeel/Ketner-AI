import { create } from 'zustand';

/**
 * Окно «Купите кредиты». Открывается, когда сервер отказал по лимитам бесплатного доступа
 * (до первой покупки они строже): оно предлагает пакеты и ведёт к оплате.
 */
interface CreditsModalState {
  isOpen: boolean;
  open: () => void;
  close: () => void;
}

export const useCreditsModal = create<CreditsModalState>((set) => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
}));
