import type { WorkspaceContext, WorkspaceFile } from './types';
import { getFileExtension } from './attachment-utils';

export interface ParseRepoResult {
  owner: string;
  repo: string;
  branch?: string;
}

export function parseGitHubUrl(input: string): ParseRepoResult | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Формат 1: owner/repo или owner/repo#branch
  const simpleMatch = trimmed.match(/^([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)(?:#([a-zA-Z0-9_.-]+))?$/);
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

const MAX_REPO_FILES = 120;

/**
 * Загружает дерево репозитория GitHub через публичный REST API.
 */
export async function fetchGitHubRepo(
  owner: string,
  repo: string,
  branch = 'main',
  token?: string,
): Promise<WorkspaceContext> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
  };
  if (token?.trim()) {
    headers['Authorization'] = `token ${token.trim()}`;
  }

  // 1. Пытаемся получить дерево репозитория
  let targetBranch = branch;
  let treeUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${targetBranch}?recursive=1`;
  let res = await fetch(treeUrl, { headers });

  if (res.status === 404 && targetBranch === 'main') {
    // Пробуем master, если main не существует
    targetBranch = 'master';
    treeUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${targetBranch}?recursive=1`;
    res = await fetch(treeUrl, { headers });
  }

  if (!res.ok) {
    if (res.status === 403 || res.status === 429) {
      throw new Error('Лимит запросов к GitHub API исчерпан. Пожалуйста, укажите GitHub Personal Access Token или попробуйте позже.');
    }
    if (res.status === 404) {
      throw new Error(`Репозиторий ${owner}/${repo} не найден. Проверьте правильность ссылки или укажите токен для приватного репозитория.`);
    }
    throw new Error(`Ошибка загрузки репозитория (${res.status}): ${res.statusText}`);
  }

  const data = (await res.json()) as {
    tree?: Array<{ path: string; mode: string; type: string; size?: number; url?: string }>;
    truncated?: boolean;
  };

  const rawTree = data.tree || [];
  const codeFiles = rawTree
    .filter((node) => node.type === 'blob')
    .filter((node) => {
      const path = node.path;
      return (
        !path.includes('node_modules/') &&
        !path.startsWith('.git/') &&
        !path.includes('dist/') &&
        !path.includes('build/') &&
        !path.endsWith('.lock') &&
        !path.endsWith('-lock.json')
      );
    })
    .slice(0, MAX_REPO_FILES);

  // 2. Скачиваем содержимое ключевых файлов (package.json, README, tsconfig, etc.)
  const priorityPatterns = [/package\.json$/i, /readme\.md$/i, /tsconfig.*\.json$/i, /src\/.*index\.[jt]sx?$/i, /main\.[a-z]+$/i];
  const filesToFetch = codeFiles
    .filter((f) => priorityPatterns.some((pattern) => pattern.test(f.path)))
    .slice(0, 10);

  const contentMap = new Map<string, string>();
  await Promise.all(
    filesToFetch.map(async (fileNode) => {
      try {
        const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${targetBranch}/${fileNode.path}`;
        const contentRes = await fetch(rawUrl);
        if (contentRes.ok) {
          const text = await contentRes.text();
          if (text.length <= 128 * 1024) {
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
