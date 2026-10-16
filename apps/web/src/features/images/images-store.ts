import { create } from 'zustand';
import { usePreferences } from '@/features/preferences/preferences-store';
import { ApiError, imagesApi } from './api';
import type { GeneratedImage, ImageAspect, ImageCapabilities } from './types';

type Status = 'idle' | 'loading' | 'ready' | 'error';

export interface ImageNotice {
  tone: 'error' | 'info';
  text: string;
  /** Код ошибки сервера: по нему интерфейс предлагает улучшить тариф. */
  code?: string;
}

interface ImagesState {
  capabilities: ImageCapabilities | null;
  images: GeneratedImage[];
  status: Status;
  authRequired: boolean;
  prompt: string;
  modelId: string;
  aspect: ImageAspect;
  /** Стиль: сервер дописывает к описанию подсказку этого стиля. */
  style: string;
  generating: boolean;
  /** Пропорции текущей генерации: заглушка рисуется в нужной форме. */
  pendingAspect: ImageAspect | null;
  notice: ImageNotice | null;
  load: () => Promise<void>;
  setPrompt: (prompt: string) => void;
  setModel: (modelId: string) => void;
  setAspect: (aspect: ImageAspect) => void;
  setStyle: (style: string) => void;
  generate: () => Promise<void>;
  remove: (id: string) => Promise<void>;
  dismissNotice: () => void;
}

let controller: AbortController | null = null;

const STYLE_KEY = 'ketner.imageStyle';

/** Выбранный стиль запоминается в браузере для удобства; без хранилища — «без стиля». */
function readStyle(): string {
  try {
    return window.localStorage.getItem(STYLE_KEY) || 'none';
  } catch {
    return 'none';
  }
}

function writeStyle(style: string): void {
  try {
    window.localStorage.setItem(STYLE_KEY, style);
  } catch {
    // хранилище недоступно — стиль просто не запомнится
  }
}

export const useImages = create<ImagesState>((set, get) => ({
  capabilities: null,
  images: [],
  status: 'idle',
  authRequired: false,
  prompt: '',
  modelId: 'flux-schnell',
  aspect: '1:1',
  style: readStyle(),
  generating: false,
  pendingAspect: null,
  notice: null,

  load: async () => {
    set({ status: 'loading', authRequired: false });
    try {
      const [capabilities, images] = await Promise.all([
        imagesApi.capabilities(),
        imagesApi.list(),
      ]);
      const current = capabilities.models.find((m) => m.id === get().modelId && !m.locked);
      const style =
        capabilities.styles && !capabilities.styles.includes(get().style)
          ? (capabilities.defaultStyleId ?? 'none')
          : get().style;
      set({
        style,
        capabilities,
        images,
        status: 'ready',
        modelId: current ? current.id : capabilities.defaultModelId,
      });
    } catch (error) {
      set({ status: 'error', authRequired: error instanceof ApiError && error.status === 401 });
    }
  },

  setPrompt: (prompt) => set({ prompt }),
  setModel: (modelId) => {
    const model = get().capabilities?.models.find((m) => m.id === modelId);
    const aspect = model && !model.aspects.includes(get().aspect) ? '1:1' : get().aspect;
    set({ modelId, aspect });
  },
  setAspect: (aspect) => set({ aspect }),
  setStyle: (style) => {
    writeStyle(style);
    set({ style });
  },
  dismissNotice: () => set({ notice: null }),

  generate: async () => {
    const { prompt, modelId, aspect, style, generating, capabilities } = get();
    const text = prompt.trim();
    if (!text || generating) return;
    const model = capabilities?.models.find((m) => m.id === modelId);
    const effectiveAspect = model && model.aspects.includes(aspect) ? aspect : '1:1';
    controller = new AbortController();
    set({ generating: true, pendingAspect: effectiveAspect, notice: null });
    try {
      const { image } = await imagesApi.generate(
        {
          prompt: text,
          modelId,
          aspect: effectiveAspect,
          style,
          language: usePreferences.getState().language,
        },
        controller.signal,
      );
      set((state) => ({
        images: [image, ...state.images],
        notice: null,
        capabilities: state.capabilities
          ? {
              ...state.capabilities,
              models: state.capabilities.models.map((m) =>
                m.id === image.modelId ? { ...m, usedToday: m.usedToday + 1 } : m,
              ),
            }
          : state.capabilities,
      }));
    } catch (error) {
      if (!controller?.signal.aborted) {
        set({
          notice: {
            tone: 'error',
            text: error instanceof Error ? error.message : String(error),
            code: error instanceof ApiError ? error.code : undefined,
          },
        });
      }
    } finally {
      controller = null;
      set({ generating: false, pendingAspect: null });
    }
  },

  remove: async (id) => {
    const before = get().images;
    set({ images: before.filter((image) => image.id !== id) });
    try {
      await imagesApi.remove(id);
    } catch (error) {
      set({
        images: before,
        notice: { tone: 'error', text: error instanceof Error ? error.message : String(error) },
      });
    }
  },
}));
