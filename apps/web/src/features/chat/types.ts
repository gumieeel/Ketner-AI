import type { Language } from '@/features/preferences/preferences-store';

/**
 * Типы контракта чата. Совпадают по форме с mock-API и docs/data-model.md:
 * при переходе на реальный бэкенд меняется источник данных, а не структуры.
 */
export type { Language };

export type PlanId = 'free' | 'gpt-pro' | 'claude-pro' | 'gemini-pro' | 'ultra' | 'plus' | 'pro';
export type MessageRole = 'user' | 'assistant';

/** `pending` и `streaming` живут только на клиенте во время генерации. */
export type MessageStatus = 'pending' | 'streaming' | 'complete' | 'error';

export interface Conversation {
  id: string;
  userId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationSummary extends Conversation {
  messageCount: number;
}

export type AttachmentCategory =
  | 'image'
  | 'video'
  | 'audio'
  | 'document'
  | 'code'
  | 'archive'
  | 'file';

export interface MessageAttachment {
  id: string;
  name: string;
  size: number;
  type: string;
  category: AttachmentCategory;
  url: string;
  contentPreview?: string;
}

export type WorkspaceType = 'local_folder' | 'git_repo';

export interface WorkspaceFile {
  path: string;
  size: number;
  content?: string;
  language?: string;
}

export interface WorkspaceContext {
  id: string;
  type: WorkspaceType;
  name: string;
  pathOrUrl: string;
  branch?: string;
  gitToken?: string;
  filesCount: number;
  files: WorkspaceFile[];
  indexedAt: string;
}

export type FileActionType = 'write' | 'replace' | 'delete';

export interface FileChangeItem {
  action: FileActionType;
  path: string;
  description?: string;
  content?: string;
  targetContent?: string;
  replacementContent?: string;
  originalContent?: string;
  modifiedContent?: string;
  additions?: number;
  deletions?: number;
}

export interface FileProposal {
  id: string;
  messageId: string;
  summary?: string;
  changes: FileChangeItem[];
  status: 'pending' | 'applying' | 'applied' | 'discarded' | 'error';
  error?: string;
  appliedAt?: string;
  gitResult?: {
    type: 'commit' | 'pull_request';
    url?: string;
    branch?: string;
    commitSha?: string;
    prNumber?: number;
  };
}

export interface Message {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  createdAt: string;
  status: MessageStatus;
  modelId?: string;
  /** Только на клиенте: текст ошибки для сообщения со статусом `error`. */
  error?: string;
  errorCode?: string;
  attachments?: MessageAttachment[];
  workspaceContext?: {
    name: string;
    type: WorkspaceType;
    pathOrUrl?: string;
    branch?: string;
    filesCount?: number;
    files?: WorkspaceFile[];
    summary?: string;
  };
}

export interface ModelInfo {
  id: string;
  name: string;
  contextMessages: number;
  isPro?: boolean;
  requiredPlan?: PlanId;
}

export interface PlanLimits {
  messagesPerDay: number | null;
  contextMessages: number;
}

export interface ChatMeta {
  models: ModelInfo[];
  defaultModelId: string;
  limits: Record<PlanId, PlanLimits>;
}
