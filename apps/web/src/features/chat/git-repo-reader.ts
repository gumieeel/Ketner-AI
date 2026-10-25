import type { WorkspaceContext, WorkspaceFile } from './types';
import { getFileExtension, isReadableTextPath } from './attachment-utils';
import { isSensitivePath } from './file-operations/path-safety';
import { githubFetch } from '../github/api';

export interface ParseRepoResult {
  owner: string;
  repo: string;
  branch?: string;
}

export function parseGitHubUrl(input: string): ParseRepoResult | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Формат 1: owner/repo или owner/repo#branch
  const simpleMatch = trimmed.match(
    /^([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)(?:#([a-zA-Z0-9_.-]+))?$/,
  );
  if (simpleMatch) {
    return {
      owner: simpleMatch[1],
      repo: simpleMatch[2].replace(/\.git$/, ''),
      branch: simpleMatch[3],
    };
  }

  // Формат 2: https://github.com/owner/repo...
  try {
    const url = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
    if (!url.hostname.includes('github.com')) return null;

    const parts = url.pathname.replace(/^\//, '').split('/');
    if (parts.length >= 2) {
      const owner = parts[0];
      const repo = parts[1].replace(/\.git$/, '');
      let branch: string | undefined = undefined;

      if (parts[2] === 'tree' && parts[3]) {
        branch = parts.slice(3).join('/');
      }

      return { owner, repo, branch };
    }
  } catch {
    // Невалидный URL
  }

  return null;
}

const MAX_REPO_FILES = 150;
/** Сколько файлов загружать с содержимым и сколько символов суммарно — чтобы привязка была быстрой. */
const MAX_FETCHED_FILES = 40;
const MAX_FETCHED_TOTAL_BYTES = 600 * 1024;
const MAX_FETCHED_FILE_BYTES = 128 * 1024;

const SKIPPED_SEGMENTS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  'out',
  'target',
  'coverage',
  '.turbo',
  '.cache',
  'vendor',
  '__pycache__',
  'venv',
]);

const NON_SOURCE_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'ico',
  'avif',
  'bmp',
  'svg',
  'pdf',
  'zip',
  'gz',
  'tgz',
  'rar',
  '7z',
  'woff',
  'woff2',
  'ttf',
  'eot',
  'otf',
  'mp3',
  'mp4',
  'mov',
  'webm',
  'wasm',
  'exe',
  'dll',
  'so',
  'bin',
  'lock',
  'map',
]);

function isUsefulRepoPath(path: string): boolean {
  const segments = path.split('/');
  if (segments.some((s) => SKIPPED_SEGMENTS.has(s))) return false;
  if (path.endsWith('-lock.json') || path.endsWith('pnpm-lock.yaml') || path.endsWith('yarn.lock'))
    return false;
  return !NON_SOURCE_EXTENSIONS.has(getFileExtension(path));
}

/** Чем выше балл, тем раньше файл попадает в контекст модели. */
export function repoFileScore(path: string): number {
  const depth = path.split('/').length - 1;
  let score = 10;
  if (/^package\.json$/i.test(path)) score = 100;
  else if (/^readme(\.md)?$/i.test(path)) score = 90;
  else if (/^tsconfig.*\.json$/i.test(path)) score = 80;
  else if (
    /(^|\/)(pyproject\.toml|requirements\.txt|Cargo\.toml|go\.mod|pom\.xml|Gemfile|composer\.json)$/i.test(
      path,
    )
  )
    score = 75;
  else if (/(^|\/)(index|main|app|server)\.(ts|tsx|js|jsx|py|go|rs)$/i.test(path)) score = 70;
  else if (
    /(^|\/)(Dockerfile|docker-compose\.ya?ml|vite\.config\.[jt]s|next\.config\.[jt]s)$/i.test(path)
  )
    score = 60;
  else if (/(^|\/)package\.json$/i.test(path)) score = 55;
  else if (/^(src|app|lib|apps|packages|server|api)\//i.test(path)) score = 40;
  else if (/^(tests?|docs?)\//i.test(path)) score = 15;
  return score - Math.min(depth, 6);
}

/** Ветка в пути API: сегменты экранируются по отдельности, слэши (`feat/x`) остаются. */
export function branchPath(branch: string): string {
  return branch.split('/').map(encodeURIComponent).join('/');
}

/** Путь в API GitHub для репозитория: owner и repo экранируются. */
export function repoPath(owner: string, repo: string): string {
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

async function readFailure(res: Response, owner: string, repo: string): Promise<never> {
  if (res.status === 403 || res.status === 429) {
    throw new Error('GitHub временно ограничил запросы. Попробуйте через минуту.');
  }
  if (res.status === 404) {
    throw new Error(
      `Репозиторий ${owner}/${repo} или ветка не найдены, либо у подключённого аккаунта GitHub нет к ним доступа.`,
    );
  }
  throw new Error(`Ошибка загрузки репозитория (${res.status})`);
}

/**
 * Загружает дерево репозитория через привязанный аккаунт GitHub (`/api/github/api`): работают и
 * приватные репозитории, токен остаётся на сервере. Без ветки берётся ветка по умолчанию.
 */
export async function fetchGitHubRepo(
  owner: string,
  repo: string,
  branch?: string,
): Promise<WorkspaceContext> {
  const base = repoPath(owner, repo);

  let targetBranch = branch?.trim();
  if (!targetBranch) {
    const info = await githubFetch(base);
    if (!info.ok) await readFailure(info, owner, repo);
    targetBranch = ((await info.json()) as { default_branch?: string }).default_branch || 'main';
  }

  // 1. Дерево репозитория целиком
  const res = await githubFetch(`${base}/git/trees/${branchPath(targetBranch)}?recursive=1`);
  if (!res.ok) await readFailure(res, owner, repo);

  const data = (await res.json()) as {
    tree?: Array<{ path: string; mode: string; type: string; size?: number; url?: string }>;
    truncated?: boolean;
  };

  const rawTree = data.tree || [];
  const codeFiles = rawTree
    .filter((node) => node.type === 'blob' && isUsefulRepoPath(node.path))
    .sort((x, y) => repoFileScore(y.path) - repoFileScore(x.path) || x.path.localeCompare(y.path))
    .slice(0, MAX_REPO_FILES);

  // 2. Скачиваем содержимое самых важных текстовых файлов (в пределах лимитов).
  let fetchedBytes = 0;
  const filesToFetch = codeFiles
    .filter((f) => {
      if (isSensitivePath(f.path) || !isReadableTextPath(f.path)) return false;
      const size = f.size ?? 0;
      if (size > MAX_FETCHED_FILE_BYTES) return false;
      if (fetchedBytes + size > MAX_FETCHED_TOTAL_BYTES) return false;
      fetchedBytes += size;
      return true;
    })
    .slice(0, MAX_FETCHED_FILES);

  const encodePath = (path: string) => path.split('/').map(encodeURIComponent).join('/');
  const contentMap = new Map<string, string>();
  const ref = encodeURIComponent(targetBranch);
  await Promise.all(
    filesToFetch.map(async (fileNode) => {
      try {
        const contentRes = await githubFetch(
          `${base}/contents/${encodePath(fileNode.path)}?ref=${ref}`,
          {
            accept: 'application/vnd.github.raw+json',
          },
        );
        if (contentRes.ok) {
          const text = await contentRes.text();
          if (text.length <= MAX_FETCHED_FILE_BYTES) {
            contentMap.set(fileNode.path, text);
          }
        }
      } catch {
        // Игнорируем ошибки загрузки конкретных файлов
      }
    }),
  );

  const collected: WorkspaceFile[] = codeFiles.map((node) => ({
    path: node.path,
    size: node.size || 0,
    content: contentMap.get(node.path),
    language: getFileExtension(node.path),
  }));

  return {
    id: `github-${owner}-${repo}-${Date.now()}`,
    type: 'git_repo',
    name: `${owner}/${repo}`,
    pathOrUrl: `https://github.com/${owner}/${repo}`,
    branch: targetBranch,
    filesCount: collected.length,
    files: collected,
    indexedAt: new Date().toISOString(),
  };
}
