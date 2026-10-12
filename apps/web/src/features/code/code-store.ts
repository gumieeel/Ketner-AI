import { create } from 'zustand';
import { usePreferences } from '@/features/preferences/preferences-store';
import { useAuth } from '@/features/auth/auth-store';
import { reasoningModeFor } from '@/features/chat/reasoning-mode';
import { codeApi, streamAgentRun, ApiError } from './api';
import { chunkFiles, readFolderFiles, readZipFile, type ReadLimits } from './import-readers';
import { parentDirectories } from './tree';
import type {
  AgentEvent,
  CodeCapabilities,
  CodeFileEntry,
  CodeProject,
  ImportSkip,
  PlanItem,
  ThreadItem,
} from './types';

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface FileBuffer {
  path: string;
  language: string;
  /** Текущий текст в редакторе. */
  content: string;
  /** Последняя сохранённая версия: по расхождению определяется «не сохранено». */
  saved: string;
  status: 'loading' | 'ready' | 'error' | 'binary';
  error?: string;
}

export interface LiveRun {
  runId: string;
  modelId: string;
  modelName: string;
  maxSteps: number;
  step: number;
  /** Текст текущего шага, ещё не превращённый в запись ленты. */
  text: string;
  plan: PlanItem[];
  routingReason: string | null;
}

export type ChangeKind = 'create' | 'modify' | 'delete' | 'move';

interface CodeState {
  capabilities: CodeCapabilities | null;
  projects: CodeProject[];
  projectsStatus: LoadStatus;
  /** Сервер ответил 401: проекты доступны только после входа в аккаунт. */
  authRequired: boolean;
  project: CodeProject | null;
  projectStatus: LoadStatus;
  files: CodeFileEntry[];
  openPaths: string[];
  activePath: string | null;
  buffers: Record<string, FileBuffer>;
  expanded: Record<string, boolean>;
  thread: ThreadItem[];
  running: boolean;
  live: LiveRun | null;
  modelId: string;
  /** Изменённые агентом файлы последнего запуска: для пометок в дереве. */
  changed: Record<string, ChangeKind>;
  notice:
    | { kind: 'message'; tone: 'info' | 'error'; text: string }
    | { kind: 'import'; tone: 'info'; written: number; skippedCount: number; details: ImportSkip[] }
    | null;

  loadCapabilities: () => Promise<void>;
  loadProjects: () => Promise<void>;
  createProject: (name: string, template: string) => Promise<CodeProject>;
  importGithub: (url: string) => Promise<CodeProject>;
  importFromFolder: (files: FileList | File[]) => Promise<CodeProject>;
  importFromZip: (file: File) => Promise<CodeProject>;
  deleteProject: (id: string) => Promise<void>;
  renameProject: (id: string, name: string) => Promise<void>;

  openProject: (id: string) => Promise<void>;
  closeProject: () => void;
  refreshFiles: () => Promise<void>;
  openFile: (path: string) => Promise<void>;
  closeFile: (path: string) => void;
  setActive: (path: string) => void;
  editFile: (path: string, content: string) => void;
  saveFile: (path: string) => Promise<boolean>;
  saveAll: () => Promise<boolean>;
  createFile: (path: string) => Promise<void>;
  deleteEntry: (path: string) => Promise<void>;
  renameEntry: (from: string, to: string) => Promise<void>;
  toggleDir: (path: string) => void;
  importIntoProject: (files: FileList | File[], zip?: boolean) => Promise<void>;
  exportZip: () => Promise<void>;

  setModel: (modelId: string) => void;
  runAgent: (task: string) => Promise<void>;
  stopAgent: () => void;
  clearThread: () => Promise<void>;
  dismissNotice: () => void;
}

const STREAM_FLUSH_MS = 60;
let controller: AbortController | null = null;

function errorText(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.name !== 'AbortError') return error.message;
  return 'Что-то пошло не так. Попробуйте ещё раз.';
}

function readLimits(capabilities: CodeCapabilities | null): ReadLimits {
  const limits = capabilities?.limits;
  return {
    maxFiles: limits?.maxFiles ?? 200,
    maxFileBytes: limits?.maxFileBytes ?? 200 * 1024,
    maxTotalBytes: limits?.maxProjectBytes ?? 1024 * 1024,
  };
}

let idCounter = 0;
const localId = (prefix: string): string => `${prefix}-${Date.now().toString(36)}-${(idCounter += 1)}`;

export const useCode = create<CodeState>((set, get) => {
  /** Сообщение пользователю: пропущенные при импорте файлы. */
  const importNotice = (written: number, skipped: ImportSkip[], skippedCount: number): void => {
    set({ notice: { kind: 'import', tone: 'info', written, skippedCount, details: skipped.slice(0, 50) } });
  };

  /** Создаёт проект и загружает в него файлы частями. */
  const createWithFiles = async (
    name: string,
    source: { files: Array<{ path: string; content: string }>; skipped: ImportSkip[] },
  ): Promise<CodeProject> => {
    if (source.files.length === 0) {
      throw new Error('no_files');
    }
    const project = await codeApi.createProject({ name });
    let written = 0;
    const skipped = [...source.skipped];
    try {
      for (const chunk of chunkFiles(source.files)) {
        const result = await codeApi.importFiles(project.id, chunk);
        written += result.written;
        skipped.push(...result.skipped);
      }
    } catch (error) {
      await codeApi.deleteProject(project.id).catch(() => undefined);
      throw error;
    }
    importNotice(written, skipped, skipped.length);
    const fresh = (await codeApi.getProject(project.id)).project;
    set((state) => ({ projects: [fresh, ...state.projects.filter((p) => p.id !== fresh.id)] }));
    return fresh;
  };

  const reloadCleanBuffers = async (): Promise<void> => {
    const { project, buffers } = get();
    if (!project) return;
    await Promise.all(
      Object.values(buffers)
        .filter((buffer) => buffer.status === 'ready' && buffer.content === buffer.saved)
        .map(async (buffer) => {
          try {
            const read = await codeApi.readFile(project.id, buffer.path);
            set((state) => {
              const current = state.buffers[buffer.path];
              // Пока шёл запрос, пользователь мог начать править файл: его правки важнее.
              if (!current || current.content !== current.saved) return state;
              return { buffers: { ...state.buffers, [buffer.path]: { ...current, content: read.content, saved: read.content } } };
            });
          } catch (error) {
            if (error instanceof ApiError && error.status === 404) get().closeFile(buffer.path);
          }
        }),
    );
  };

  return {
    capabilities: null,
    projects: [],
    projectsStatus: 'idle',
    authRequired: false,
    project: null,
    projectStatus: 'idle',
    files: [],
    openPaths: [],
    activePath: null,
    buffers: {},
    expanded: {},
    thread: [],
    running: false,
    live: null,
    modelId: 'auto',
    changed: {},
    notice: null,

    async loadCapabilities() {
      try {
        set({ capabilities: await codeApi.capabilities() });
      } catch {
        // экран покажет ошибку загрузки проектов; лимиты подтянутся при следующем входе
      }
    },

    async loadProjects() {
      set({ projectsStatus: 'loading' });
      try {
        const projects = await codeApi.listProjects();
        set({ projects, projectsStatus: 'ready', authRequired: false });
      } catch (error) {
        set({ projectsStatus: 'error', authRequired: error instanceof ApiError && error.status === 401 });
      }
    },

    async createProject(name, template) {
      const project = await codeApi.createProject({ name, template });
      set((state) => ({ projects: [project, ...state.projects] }));
      void get().loadCapabilities();
      return project;
    },

    async importGithub(url) {
      const result = await codeApi.importGithub({ url });
      importNotice(result.written, result.skipped, result.skippedCount);
      set((state) => ({ projects: [result.project, ...state.projects] }));
      void get().loadCapabilities();
      return result.project;
    },

    async importFromFolder(list) {
      const files = Array.from(list);
      const folderName = (files[0]?.webkitRelativePath || '').split('/')[0] || 'Проект';
      const read = await readFolderFiles(files, readLimits(get().capabilities));
      const project = await createWithFiles(folderName, { files: read.files, skipped: read.skipped });
      void get().loadCapabilities();
      return project;
    },

    async importFromZip(file) {
      const read = await readZipFile(file, readLimits(get().capabilities));
      const project = await createWithFiles(file.name.replace(/\.zip$/i, '') || 'Проект', {
        files: read.files,
        skipped: read.skipped,
      });
      void get().loadCapabilities();
      return project;
    },

    async deleteProject(id) {
      await codeApi.deleteProject(id);
      set((state) => ({ projects: state.projects.filter((p) => p.id !== id) }));
      void get().loadCapabilities();
    },

    async renameProject(id, name) {
      const updated = await codeApi.renameProject(id, name);
      set((state) => ({
        projects: state.projects.map((p) => (p.id === id ? updated : p)),
        project: state.project?.id === id ? updated : state.project,
      }));
    },

    async openProject(id) {
      if (get().project?.id === id && get().projectStatus === 'ready') return;
      controller?.abort();
      set({
        project: null,
        projectStatus: 'loading',
        files: [],
        openPaths: [],
        activePath: null,
        buffers: {},
        expanded: {},
        thread: [],
        running: false,
        live: null,
        changed: {},
        notice: null,
      });
      try {
        const [{ project }, { files }, { items }] = await Promise.all([
          codeApi.getProject(id),
          codeApi.listFiles(id),
          codeApi.getThread(id),
        ]);
        set({ project, files, thread: items, running: false, projectStatus: 'ready' });
        const readme = files.find((f) => /^readme(\.md)?$/i.test(f.path));
        if (readme) await get().openFile(readme.path);
      } catch (error) {
        set({
          projectStatus: 'error',
          authRequired: error instanceof ApiError && error.status === 401,
          notice: { kind: 'message', tone: 'error', text: errorText(error) },
        });
      }
    },

    closeProject() {
      controller?.abort();
      set({ project: null, projectStatus: 'idle', files: [], openPaths: [], activePath: null, buffers: {}, thread: [], live: null, running: false });
    },

    async refreshFiles() {
      const { project } = get();
      if (!project) return;
      try {
        const [{ files }, { project: fresh }] = await Promise.all([codeApi.listFiles(project.id), codeApi.getProject(project.id)]);
        if (get().project?.id !== project.id) return;
        set((state) => ({
          files,
          project: fresh,
          projects: state.projects.map((p) => (p.id === fresh.id ? fresh : p)),
        }));
      } catch {
        // список обновится при следующем действии
      }
    },

    async openFile(path) {
      const { project, buffers } = get();
      if (!project) return;
      set((state) => ({
        openPaths: state.openPaths.includes(path) ? state.openPaths : [...state.openPaths, path],
        activePath: path,
        expanded: {
          ...state.expanded,
          ...Object.fromEntries(parentDirectories(path).map((dir) => [dir, true])),
        },
      }));
      if (buffers[path]?.status === 'ready') return;
      set((state) => ({
        buffers: { ...state.buffers, [path]: { path, language: '', content: '', saved: '', status: 'loading' } },
      }));
      try {
        const read = await codeApi.readFile(project.id, path);
        set((state) => ({
          buffers: {
            ...state.buffers,
            [path]: { path, language: read.language, content: read.content, saved: read.content, status: 'ready' },
          },
        }));
      } catch (error) {
        const binary = error instanceof ApiError && error.code === 'binary_file';
        set((state) => ({
          buffers: {
            ...state.buffers,
            [path]: { path, language: '', content: '', saved: '', status: binary ? 'binary' : 'error', error: errorText(error) },
          },
        }));
      }
    },

    closeFile(path) {
      set((state) => {
        const index = state.openPaths.indexOf(path);
        if (index === -1) return state;
        const openPaths = state.openPaths.filter((p) => p !== path);
        const buffers = { ...state.buffers };
        delete buffers[path];
        const activePath =
          state.activePath === path ? (openPaths[index - 1] ?? openPaths[0] ?? null) : state.activePath;
        return { openPaths, buffers, activePath };
      });
    },

    setActive(path) {
      set({ activePath: path });
    },

    editFile(path, content) {
      set((state) => {
        const buffer = state.buffers[path];
        if (!buffer || buffer.status !== 'ready') return state;
        return { buffers: { ...state.buffers, [path]: { ...buffer, content } } };
      });
    },

    async saveFile(path) {
      const { project, buffers } = get();
      const buffer = buffers[path];
      if (!project || !buffer || buffer.status !== 'ready') return true;
      if (buffer.content === buffer.saved) return true;
      const content = buffer.content;
      try {
        await codeApi.writeFile(project.id, path, content);
        set((state) => {
          const current = state.buffers[path];
          return current ? { buffers: { ...state.buffers, [path]: { ...current, saved: content } } } : state;
        });
        void get().refreshFiles();
        return true;
      } catch (error) {
        set({ notice: { kind: 'message', tone: 'error', text: errorText(error) } });
        return false;
      }
    },

    async saveAll() {
      const dirty = Object.values(get().buffers).filter((b) => b.status === 'ready' && b.content !== b.saved);
      const results = await Promise.all(dirty.map((b) => get().saveFile(b.path)));
      return results.every(Boolean);
    },

    async createFile(path) {
      const { project } = get();
      if (!project) return;
      try {
        await codeApi.writeFile(project.id, path, '');
        await get().refreshFiles();
        await get().openFile(path);
      } catch (error) {
        set({ notice: { kind: 'message', tone: 'error', text: errorText(error) } });
      }
    },

    async deleteEntry(path) {
      const { project } = get();
      if (!project) return;
      try {
        const { removed } = await codeApi.deleteFile(project.id, path);
        for (const gone of removed) get().closeFile(gone);
        await get().refreshFiles();
      } catch (error) {
        set({ notice: { kind: 'message', tone: 'error', text: errorText(error) } });
      }
    },

    async renameEntry(from, to) {
      const { project, buffers } = get();
      if (!project) return;
      const buffer = buffers[from];
      if (buffer && buffer.content !== buffer.saved && !(await get().saveFile(from))) return;
      try {
        await codeApi.moveFile(project.id, from, to);
        const wasOpen = get().openPaths.includes(from);
        get().closeFile(from);
        await get().refreshFiles();
        if (wasOpen) await get().openFile(to);
      } catch (error) {
        set({ notice: { kind: 'message', tone: 'error', text: errorText(error) } });
      }
    },

    toggleDir(path) {
      set((state) => ({ expanded: { ...state.expanded, [path]: !state.expanded[path] } }));
    },

    async importIntoProject(list, zip = false) {
      const { project } = get();
      if (!project) return;
      try {
        const limits = readLimits(get().capabilities);
        const read = zip ? await readZipFile(Array.from(list)[0], limits) : await readFolderFiles(list, limits);
        let written = 0;
        const skipped = [...read.skipped];
        for (const chunk of chunkFiles(read.files)) {
          const result = await codeApi.importFiles(project.id, chunk);
          written += result.written;
          skipped.push(...result.skipped);
        }
        importNotice(written, skipped, skipped.length);
        await get().refreshFiles();
        await reloadCleanBuffers();
      } catch (error) {
        set({ notice: { kind: 'message', tone: 'error', text: errorText(error) } });
      }
    },

    async exportZip() {
      const { project } = get();
      if (!project) return;
      try {
        await get().saveAll();
        const { blob, fileName } = await codeApi.exportZip(project.id);
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = fileName;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
      } catch (error) {
        set({ notice: { kind: 'message', tone: 'error', text: errorText(error) } });
      }
    },

    setModel(modelId) {
      set({ modelId });
    },

    async runAgent(rawTask) {
      const task = rawTask.trim();
      const { project, running } = get();
      if (!project || running || !task) return;

      // Агент читает файлы с диска сервера: несохранённые правки сначала сохраняются.
      if (!(await get().saveAll())) return;

      const abort = new AbortController();
      controller = abort;
      const projectId = project.id;
      const optimistic: ThreadItem = { id: localId('user'), kind: 'user', text: task, createdAt: new Date().toISOString() };
      set((state) => ({ running: true, live: null, changed: {}, thread: [...state.thread, optimistic], notice: null }));

      let pendingText = '';
      let flushTimer: ReturnType<typeof setTimeout> | null = null;
      const flushText = (): void => {
        flushTimer = null;
        const text = pendingText;
        set((state) => (state.live ? { live: { ...state.live, text } } : state));
      };
      const commitText = (modelId?: string): void => {
        if (flushTimer) {
          clearTimeout(flushTimer);
          flushTimer = null;
        }
        const text = pendingText;
        pendingText = '';
        if (!text.trim()) {
          set((state) => (state.live ? { live: { ...state.live, text: '' } } : state));
          return;
        }
        set((state) => ({
          thread: [
            ...state.thread,
            { id: localId('assistant'), kind: 'assistant', text, runId: state.live?.runId ?? '', modelId, createdAt: new Date().toISOString() },
          ],
          live: state.live ? { ...state.live, text: '' } : state.live,
        }));
      };

      let needsFileRefresh = false;
      let refreshTimer: ReturnType<typeof setTimeout> | null = null;
      const scheduleRefresh = (): void => {
        needsFileRefresh = true;
        if (refreshTimer) return;
        refreshTimer = setTimeout(() => {
          refreshTimer = null;
          if (!needsFileRefresh) return;
          needsFileRefresh = false;
          void get().refreshFiles();
        }, 400);
      };

      // Отклонённый запуск (лимит, тариф) сервер в ленту не пишет: локальную запись с подсказкой нельзя затирать.
      let rejected = false;
      const handle = (event: AgentEvent): void => {
        switch (event.type) {
          case 'run_start':
            set({
              live: {
                runId: event.runId,
                modelId: event.modelId,
                modelName: event.modelName,
                maxSteps: event.maxSteps,
                step: 0,
                text: '',
                plan: [],
                routingReason: event.routingReason,
              },
            });
            break;
          case 'model_switch':
            set((state) =>
              state.live ? { live: { ...state.live, modelId: event.modelId, modelName: event.modelName } } : state,
            );
            break;
          case 'delta':
            pendingText += event.content;
            if (!flushTimer) flushTimer = setTimeout(flushText, STREAM_FLUSH_MS);
            break;
          case 'tool_call':
            commitText(get().live?.modelId);
            set((state) => ({
              live: state.live ? { ...state.live, step: event.step } : state.live,
              thread: [
                ...state.thread,
                {
                  id: `call-${event.callId}`,
                  kind: 'tool',
                  runId: state.live?.runId ?? '',
                  step: event.step,
                  tool: event.tool,
                  label: event.label,
                  ok: true,
                  summary: '',
                  pending: true,
                  createdAt: new Date().toISOString(),
                },
              ],
            }));
            break;
          case 'tool_result': {
            set((state) => ({
              thread: state.thread.map((item) =>
                item.kind === 'tool' && item.id === `call-${event.callId}`
                  ? { ...item, label: event.label, ok: event.ok, summary: event.summary, change: event.change, pending: false }
                  : item,
              ),
              changed: event.change
                ? { ...state.changed, [event.change.path]: event.change.action }
                : state.changed,
            }));
            if (event.change || event.tool === 'run_command') scheduleRefresh();
            if (event.change) {
              const { path, action } = event.change;
              if (action === 'delete') get().closeFile(path);
              else if (action === 'move' && event.change.from) get().closeFile(event.change.from);
              else void reloadCleanBuffers();
            } else if (event.tool === 'run_command') {
              void reloadCleanBuffers();
            }
            break;
          }
          case 'plan':
            set((state) => (state.live ? { live: { ...state.live, plan: event.items } } : state));
            break;
          case 'step_done':
            commitText(get().live?.modelId);
            set((state) => (state.live ? { live: { ...state.live, step: event.step } } : state));
            break;
          case 'done':
            commitText(event.modelId);
            set((state) => ({
              thread: [
                ...state.thread,
                {
                  id: localId('run'),
                  kind: 'run',
                  runId: event.runId,
                  status: event.status,
                  steps: event.steps,
                  costUsd: event.costUsd,
                  modelId: event.modelId,
                  message: event.message,
                  ...(event.plan && event.plan.length > 0 ? { plan: event.plan } : {}),
                  createdAt: new Date().toISOString(),
                },
              ],
            }));
            break;
          case 'error':
            if (!get().live) rejected = true;
            commitText();
            set((state) => ({
              thread: [
                ...state.thread,
                {
                  id: localId('run'),
                  kind: 'run',
                  runId: state.live?.runId ?? '',
                  status: 'error',
                  steps: 0,
                  costUsd: 0,
                  modelId: state.live?.modelId ?? '',
                  message: event.message,
                  code: event.code,
                  createdAt: new Date().toISOString(),
                },
              ],
            }));
            break;
        }
      };

      try {
        await streamAgentRun(
          {
            projectId,
            task,
            modelId: get().modelId,
            language: usePreferences.getState().language,
            signal: abort.signal,
            reasoningMode: reasoningModeFor(useAuth.getState().user, usePreferences.getState().maxMode),
          },
          handle,
        );
      } catch (error) {
        if (!(abort.signal.aborted)) {
          rejected = rejected || !get().live;
          set((state) => ({
            thread: [
              ...state.thread,
              {
                id: localId('run'),
                kind: 'run',
                runId: '',
                status: 'error',
                steps: 0,
                costUsd: 0,
                modelId: '',
                message: errorText(error),
                code: error instanceof ApiError ? error.code : 'network',
                createdAt: new Date().toISOString(),
              },
            ],
          }));
        }
      } finally {
        commitText();
        if (refreshTimer) clearTimeout(refreshTimer);
        if (controller === abort) controller = null;
        if (get().project?.id === projectId) {
          set({ running: false, live: null });
          // Сервер — источник истины: лента, файлы и счётчики подтягиваются заново.
          try {
            const [{ items }] = await Promise.all([codeApi.getThread(projectId), get().refreshFiles()]);
            if (get().project?.id === projectId && !get().running && !rejected) set({ thread: items });
          } catch {
            // остаётся локальная копия ленты
          }
          await reloadCleanBuffers();
          void get().loadCapabilities();
        }
      }
    },

    stopAgent() {
      const { project, running } = get();
      if (!running || !project) return;
      void codeApi.stop(project.id).catch(() => undefined);
      controller?.abort();
    },

    async clearThread() {
      const { project, running } = get();
      if (!project || running) return;
      try {
        await codeApi.clearThread(project.id);
        set({ thread: [], changed: {} });
      } catch (error) {
        set({ notice: { kind: 'message', tone: 'error', text: errorText(error) } });
      }
    },

    dismissNotice() {
      set({ notice: null });
    },
  };
});
