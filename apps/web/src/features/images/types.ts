export type ImageAspect = '1:1' | '4:3' | '3:4' | '16:9' | '9:16';

export interface ImageModelInfo {
  id: string;
  name: string;
  aspects: ImageAspect[];
  requiredPlan: string;
  locked: boolean;
  dailyLimit: number;
  usedToday: number;
  /** Цена одной картинки 1024×1024 в кредитах (с десятыми). */
  priceCredits?: number;
}

/** Кредиты пользователя: общие с чатом и Ketner Code. */
export interface ImageCredits {
  balance: number;
  /** Кредиты кончились: рисует только модель по умолчанию, не больше `freePerDay` в сутки. */
  exhausted: boolean;
  freePerDay: number;
}

export interface ImageCapabilities {
  plan: string;
  available: boolean;
  defaultModelId: string;
  /** Стили, которые принимает сервер (старый сервер их не присылает). */
  styles?: string[];
  defaultStyleId?: string;
  maxPromptChars: number;
  credits?: ImageCredits;
  models: ImageModelInfo[];
}

export interface GeneratedImage {
  id: string;
  prompt: string;
  modelId: string;
  modelName: string;
  width: number;
  height: number;
  createdAt: string;
  url: string;
  downloadUrl: string;
}
