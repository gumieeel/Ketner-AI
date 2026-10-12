export type ImageAspect = '1:1' | '4:3' | '3:4' | '16:9' | '9:16';

export interface ImageModelInfo {
  id: string;
  name: string;
  aspects: ImageAspect[];
  requiredPlan: string;
  locked: boolean;
  dailyLimit: number;
  usedToday: number;
}

export interface ImageCapabilities {
  plan: string;
  available: boolean;
  defaultModelId: string;
  maxPromptChars: number;
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
