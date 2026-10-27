/** Типы Ketner Code: зеркало ответов сервера (apps/mock-api/src/routes/code.ts). */

export type ProjectSourceType = 'empty' | 'template' | 'github' | 'local' | 'zip';

export interface CodeProject {
  id: string;
  name: string;
  description?: string;
  source: { type: ProjectSourceType; ref?: string };
  fileCount: number;
  totalBytes: number;
  createdAt: string;
  updatedAt: string;
}

export interface CodeFileEntry {
  path: string;
  size: number;
  language: string;
  modifiedAt: string;
}

export interface CodeLimits {
  maxProjects: number;
  maxFiles: number;
  maxProjectBytes: number;
  maxFileBytes: number;
  runsPerDay: number;
  maxSteps: number;
  maxRunCostUsd: number;
  /** Добавочные бюджеты ступеней дешевле: агент продолжает на них, когда бюджет выбранной модели исчерпан. */
  continueWorkUsd?: number;
  continueLiteUsd?: number;
  commands: boolean;
  commandTimeoutSec: number;
  maxTaskChars: number;
}

export interface CodeModelOption {
  id: string;
  name: string;
  costClass: 'lite' | 'work' | 'strong' | 'top';
}

export interface CodeCapabilities {
  plan: string;
  limits: CodeLimits;
  usage: { projects: number; runsToday: number };
  commands: { available: boolean; reason: 'plan' | 'server_disabled' | null; network: boolean };
  templates: string[];
  models: CodeModelOption[];
  defaultModelId: string;
}

export type AgentRunStatus =
  'completed' | 'cancelled' | 'error' | 'step_limit' | 'budget' | 'length';

export interface ToolChange {
  path: string;
  action: 'create' | 'modify' | 'delete' | 'move';
  additions: number;
  deletions: number;
  from?: string;
  patch?: string;
}

export interface PlanItem {
  text: string;
  status: 'pending' | 'in_progress' | 'done';
}

/** Запись ленты агента (как на сервере; в живом запуске дополняется записями текущего запуска). */
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
      label: string;
      ok: boolean;
      summary: string;
      change?: ToolChange;
      createdAt: string;
      /** Только на клиенте: вызов отправлен, результата ещё нет. */
      pending?: boolean;
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
      /** План запуска на момент завершения (сервер сохраняет его в ленте). */
      plan?: PlanItem[];
      /** Только на клиенте: код ошибки запуска, по нему подбирается подсказка. */
      code?: string;
      createdAt: string;
    }
  | {
      id: string;
      kind: 'review';
      /** Запуск, правки которого проверялись. */
      runId: string;
      verdict: 'approve' | 'changes' | 'unknown';
      summary: string;
      issues: CodeReviewIssue[];
      reviewer: { modelId: string; modelName: string; developer: string };
      authorModelId?: string;
      filesReviewed: number;
      createdAt: string;
    };

/** Замечание ревью правок агента моделью другой компании. */
export interface CodeReviewIssue {
  severity: 'high' | 'medium' | 'low';
  file?: string;
  line?: number;
  problem: string;
  fix?: string;
}

/** События SSE запуска агента. */
export type AgentEvent =
  | {
      type: 'run_start';
      runId: string;
      modelId: string;
      modelName: string;
      maxSteps: number;
      budgetUsd: number;
      commands: boolean;
      routingReason: string | null;
    }
  | { type: 'model_switch'; modelId: string; modelName: string; reason: string }
  | { type: 'delta'; step: number; content: string }
  | { type: 'tool_call'; step: number; callId: string; tool: string; label: string }
  | {
      type: 'tool_result';
      step: number;
      callId: string;
      tool: string;
      label: string;
      ok: boolean;
      summary: string;
      change?: ToolChange;
    }
  | { type: 'plan'; items: PlanItem[] }
  | { type: 'step_done'; step: number; costUsd: number; totalCostUsd: number }
  | {
      type: 'done';
      runId: string;
      status: AgentRunStatus;
      steps: number;
      costUsd: number;
      modelId: string;
      message?: string;
      plan?: PlanItem[];
    }
  | { type: 'error'; code: string; message: string };

export interface ImportSkip {
  path: string;
  reason: string;
}

export interface ImportResult {
  written: number;
  skipped: ImportSkip[];
  skippedCount: number;
  project?: CodeProject;
}
