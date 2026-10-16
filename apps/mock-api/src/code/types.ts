/** Общие типы модуля «Ketner Code»: проекты, файлы, лента агента. */

export type ProjectSourceType = 'empty' | 'template' | 'github' | 'local' | 'zip';

export interface ProjectSource {
  type: ProjectSourceType;
  /** Шаблон, URL репозитория или имя папки: для отображения. */
  ref?: string;
}

export interface ProjectMeta {
  id: string;
  userId: string;
  name: string;
  description?: string;
  source: ProjectSource;
  fileCount: number;
  totalBytes: number;
  createdAt: string;
  updatedAt: string;
}

/** Квоты проекта по тарифу. */
export interface ProjectQuota {
  maxFiles: number;
  maxFileBytes: number;
  maxProjectBytes: number;
}

export type AgentRunStatus =
  'completed' | 'cancelled' | 'error' | 'step_limit' | 'budget' | 'length';

/** Пункт плана агента: задача делится на подзадачи, агент проходит их по очереди. */
export interface PlanItem {
  text: string;
  status: 'pending' | 'in_progress' | 'done';
}

export interface ToolChange {
  path: string;
  action: 'create' | 'modify' | 'delete' | 'move';
  additions: number;
  deletions: number;
  /** Для move: прежний путь. */
  from?: string;
  /** Компактный патч правки (строки с префиксом ` `, `+`, `-`) для показа в ленте. */
  patch?: string;
}

/**
 * Запись ленты агента, как её видит пользователь. Лента хранится на сервере, поэтому открывается
 * с любого устройства; в контекст модели следующего запуска попадают только user/assistant.
 */
export type ThreadItem =
  | { id: string; kind: 'user'; text: string; createdAt: string }
  | {
      id: string;
      kind: 'assistant';
      text: string;
      runId: string;
      modelId?: string;
      createdAt: string;
    }
  | {
      id: string;
      kind: 'tool';
      runId: string;
      step: number;
      tool: string;
      /** Краткое описание вызова (путь, команда): аргументы целиком в ленту не пишутся. */
      label: string;
      ok: boolean;
      summary: string;
      change?: ToolChange;
      createdAt: string;
    }
  | {
      id: string;
      kind: 'run';
      runId: string;
      status: AgentRunStatus;
      steps: number;
      costUsd: number;
      modelId: string;
      message?: string;
      /** План запуска на момент завершения: показывается в списке задач после перезагрузки. */
      plan?: PlanItem[];
      createdAt: string;
    };

export const MAX_THREAD_ITEMS = 600;
