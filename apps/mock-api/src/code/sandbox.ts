/**
 * Песочница для команд агента («запусти тесты», «собери проект»).
 *
 * Исполнение чужого кода — самая опасная часть продукта, поэтому по умолчанию песочница ВЫКЛЮЧЕНА
 * (`SANDBOX_MODE=off`): инструмента run_command у агента тогда нет вообще. Режимы:
 *
 *  - `docker` — каждая команда в отдельном одноразовом контейнере без привилегий, с лимитами памяти,
 *    процессов и процессора, по умолчанию без сети. Единственный режим, подходящий для чужих
 *    пользователей; нужен доступ API-процесса к Docker (VPS или своя машина, на Render недоступен).
 *  - `local` — процесс на самом сервере с очищенным окружением, таймаутом и убийством всей группы
 *    процессов. НЕ изолирует файловую систему и память: только для своей машины и доверенных
 *    пользователей. В production без явного `SANDBOX_ALLOW_LOCAL_IN_PRODUCTION=true` не включается.
 */

import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export interface SandboxRunOptions {
  /** Каталог проекта: рабочая директория команды. */
  cwd: string;
  command: string;
  timeoutMs: number;
  /** Сколько байт вывода сохранять (начало и конец, середина вырезается). */
  maxOutputBytes: number;
  /** Разрешён ли выход в сеть (npm install, pip install). */
  network: boolean;
  signal?: AbortSignal;
}

export interface SandboxResult {
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  cancelled: boolean;
  output: string;
  truncated: boolean;
  durationMs: number;
}

export interface SandboxRunner {
  readonly kind: 'local' | 'docker';
  /** Изолирует ли раннер команду от сервера (файловая система, память, процессы). */
  readonly isolated: boolean;
  /** Умеет ли раннер по-настоящему запрещать сеть (`network: false`). */
  readonly canBlockNetwork: boolean;
  run(options: SandboxRunOptions): Promise<SandboxResult>;
}

// ─────────────────────────────────────────────────────────────
// Сбор вывода
// ─────────────────────────────────────────────────────────────

/**
 * Хранит начало вывода и «хвост» фиксированного размера: ошибки сборки и тестов обычно в конце,
 * а команда может напечатать мегабайты.
 */
export class OutputCollector {
  private head = '';
  private tail = '';
  private omitted = 0;
  private readonly headLimit: number;
  private readonly tailLimit: number;

  constructor(maxBytes: number) {
    this.headLimit = Math.floor(maxBytes * 0.3);
    this.tailLimit = Math.max(0, maxBytes - this.headLimit);
  }

  push(text: string): void {
    if (this.head.length < this.headLimit) {
      const room = this.headLimit - this.head.length;
      this.head += text.slice(0, room);
      text = text.slice(room);
      if (!text) return;
    }
    this.tail += text;
    if (this.tail.length > this.tailLimit) {
      const cut = this.tail.length - this.tailLimit;
      this.omitted += cut;
      this.tail = this.tail.slice(cut);
    }
  }

  get truncated(): boolean {
    return this.omitted > 0;
  }

  toString(): string {
    if (this.omitted === 0) return this.head + this.tail;
    return `${this.head}\n[... вырезано ${this.omitted} симв. вывода ...]\n${this.tail}`;
  }
}

function killGroup(pid: number | undefined, signal: NodeJS.Signals = 'SIGKILL'): void {
  if (!pid) return;
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      // процесс уже завершён
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Локальный раннер
// ─────────────────────────────────────────────────────────────

let networkIsolationSupport: boolean | undefined;

/** Проверяет, умеет ли система запускать процесс в отдельном сетевом пространстве (unshare -rn). */
export function detectNetworkIsolation(): boolean {
  if (networkIsolationSupport !== undefined) return networkIsolationSupport;
  try {
    const probe = spawnSync('unshare', ['-rn', 'true'], { timeout: 3000, stdio: 'ignore' });
    networkIsolationSupport = probe.status === 0;
  } catch {
    networkIsolationSupport = false;
  }
  return networkIsolationSupport;
}

/** Окружение команды: ничего из окружения сервера (ключи OpenRouter, Stripe, БД) в процесс не попадает. */
export function buildSandboxEnv(homeDir: string): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
    HOME: homeDir,
    TMPDIR: homeDir,
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    TERM: 'dumb',
    CI: '1',
    NO_COLOR: '1',
    FORCE_COLOR: '0',
    npm_config_cache: path.join(homeDir, '.npm'),
    npm_config_update_notifier: 'false',
    npm_config_fund: 'false',
    npm_config_audit: 'false',
    PIP_DISABLE_PIP_VERSION_CHECK: '1',
    PYTHONDONTWRITEBYTECODE: '1',
  };
}

export class LocalProcessSandbox implements SandboxRunner {
  readonly kind = 'local' as const;
  readonly isolated = false;
  readonly canBlockNetwork: boolean;

  constructor(options: { networkIsolation?: boolean } = {}) {
    this.canBlockNetwork = options.networkIsolation ?? detectNetworkIsolation();
  }

  async run(options: SandboxRunOptions): Promise<SandboxResult> {
    const started = Date.now();
    const home = await mkdtemp(path.join(os.tmpdir(), 'ketner-run-'));
    const collector = new OutputCollector(options.maxOutputBytes);

    // Лимиты процесса: время процессора, размер создаваемых файлов, число открытых файлов.
    const seconds = Math.max(1, Math.ceil(options.timeoutMs / 1000) + 5);
    const script = `ulimit -t ${seconds} 2>/dev/null; ulimit -f 524288 2>/dev/null; ulimit -n 2048 2>/dev/null; ${options.command}`;

    const useUnshare = !options.network && this.canBlockNetwork;
    const [file, args] = useUnshare
      ? ['unshare', ['-rn', '/bin/sh', '-c', script]]
      : ['/bin/sh', ['-c', script]];

    return new Promise<SandboxResult>((resolve) => {
      let timedOut = false;
      let cancelled = false;
      let settled = false;
      const child = spawn(file, args, {
        cwd: options.cwd,
        env: buildSandboxEnv(home),
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const finish = (exitCode: number | null, signal: string | null, extra = ''): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', onAbort);
        // Фоновые процессы команды не должны пережить запуск.
        killGroup(child.pid);
        if (extra) collector.push(extra);
        void rm(home, { recursive: true, force: true }).finally(() =>
          resolve({
            exitCode,
            signal,
            timedOut,
            cancelled,
            output: collector.toString(),
            truncated: collector.truncated,
            durationMs: Date.now() - started,
          }),
        );
      };

      const timer = setTimeout(() => {
        timedOut = true;
        killGroup(child.pid);
      }, options.timeoutMs);

      const onAbort = (): void => {
        cancelled = true;
        killGroup(child.pid);
      };
      if (options.signal?.aborted) onAbort();
      else options.signal?.addEventListener('abort', onAbort, { once: true });

      child.stdout?.setEncoding('utf8');
      child.stderr?.setEncoding('utf8');
      child.stdout?.on('data', (chunk: string) => collector.push(chunk));
      child.stderr?.on('data', (chunk: string) => collector.push(chunk));
      child.on('error', (error) => finish(null, null, `\n[не удалось запустить команду: ${error.message}]`));
      child.on('close', (code, signal) => finish(code, signal));
    });
  }
}

// ─────────────────────────────────────────────────────────────
// Docker-раннер
// ─────────────────────────────────────────────────────────────

export interface DockerSandboxConfig {
  image: string;
  memory: string;
  cpus: string;
  pidsLimit: number;
  /** uid:gid, под которым запускается контейнер (владелец файлов проекта). */
  user?: string;
}

export const DEFAULT_DOCKER_CONFIG: DockerSandboxConfig = {
  image: 'node:22-bookworm',
  memory: '768m',
  cpus: '1',
  pidsLimit: 256,
};

/** Аргументы `docker run` вынесены в чистую функцию: их проверяют тесты, а не живой Docker. */
export function buildDockerArgs(
  options: SandboxRunOptions,
  containerName: string,
  config: DockerSandboxConfig,
): string[] {
  const args = [
    'run',
    '--rm',
    '--name',
    containerName,
    '--network',
    options.network ? 'bridge' : 'none',
    '--memory',
    config.memory,
    '--memory-swap',
    config.memory,
    '--cpus',
    config.cpus,
    '--pids-limit',
    String(config.pidsLimit),
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    '--ulimit',
    'nofile=2048:2048',
    '--ulimit',
    'fsize=536870912',
    '-v',
    `${options.cwd}:/work`,
    '-w',
    '/work',
    '-e',
    'HOME=/tmp/home',
    '-e',
    'CI=1',
    '-e',
    'NO_COLOR=1',
    '-e',
    'npm_config_cache=/tmp/home/.npm',
    '-e',
    'PIP_DISABLE_PIP_VERSION_CHECK=1',
    '--tmpfs',
    '/tmp:rw,exec,size=256m',
  ];
  if (config.user) args.push('--user', config.user);
  args.push(config.image, '/bin/sh', '-c', `mkdir -p /tmp/home; ${options.command}`);
  return args;
}

export class DockerSandbox implements SandboxRunner {
  readonly kind = 'docker' as const;
  readonly isolated = true;
  readonly canBlockNetwork = true;

  constructor(private readonly config: DockerSandboxConfig = DEFAULT_DOCKER_CONFIG) {}

  async run(options: SandboxRunOptions): Promise<SandboxResult> {
    const started = Date.now();
    const name = `ketner-${randomBytes(6).toString('hex')}`;
    const collector = new OutputCollector(options.maxOutputBytes);
    const user =
      this.config.user ??
      (typeof process.getuid === 'function' && typeof process.getgid === 'function'
        ? `${process.getuid()}:${process.getgid()}`
        : undefined);
    const args = buildDockerArgs(options, name, { ...this.config, user });

    return new Promise<SandboxResult>((resolve) => {
      let timedOut = false;
      let cancelled = false;
      let settled = false;
      const stop = (): void => {
        spawn('docker', ['kill', name], { stdio: 'ignore' }).on('error', () => undefined);
      };
      const child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });

      const finish = (exitCode: number | null, signal: string | null, extra = ''): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', onAbort);
        if (extra) collector.push(extra);
        resolve({
          exitCode,
          signal,
          timedOut,
          cancelled,
          output: collector.toString(),
          truncated: collector.truncated,
          durationMs: Date.now() - started,
        });
      };

      const timer = setTimeout(() => {
        timedOut = true;
        stop();
      }, options.timeoutMs);
      const onAbort = (): void => {
        cancelled = true;
        stop();
      };
      if (options.signal?.aborted) onAbort();
      else options.signal?.addEventListener('abort', onAbort, { once: true });

      child.stdout?.setEncoding('utf8');
      child.stderr?.setEncoding('utf8');
      child.stdout?.on('data', (chunk: string) => collector.push(chunk));
      child.stderr?.on('data', (chunk: string) => collector.push(chunk));
      child.on('error', (error) => finish(null, null, `\n[docker недоступен: ${error.message}]`));
      child.on('close', (code, signal) => finish(code, signal));
    });
  }
}

// ─────────────────────────────────────────────────────────────
// Выбор раннера по конфигурации
// ─────────────────────────────────────────────────────────────

export type SandboxMode = 'off' | 'local' | 'docker';

export interface SandboxSettings {
  mode: SandboxMode;
  dockerImage?: string;
  isProduction: boolean;
  allowLocalInProduction: boolean;
}

export function createSandbox(settings: SandboxSettings): SandboxRunner | null {
  if (settings.mode === 'docker') {
    return new DockerSandbox({
      ...DEFAULT_DOCKER_CONFIG,
      ...(settings.dockerImage ? { image: settings.dockerImage } : {}),
    });
  }
  if (settings.mode === 'local') {
    if (settings.isProduction && !settings.allowLocalInProduction) {
      console.warn(
        '[code] SANDBOX_MODE=local в production отключён: локальный раннер не изолирует код пользователей. ' +
          'Используйте SANDBOX_MODE=docker или задайте SANDBOX_ALLOW_LOCAL_IN_PRODUCTION=true на свой риск.',
      );
      return null;
    }
    return new LocalProcessSandbox();
  }
  return null;
}
