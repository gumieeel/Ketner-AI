import type { FileChangeItem } from '../types';
import { useWorkspace } from '../workspace-store';
import { sanitizeChangePath } from './path-safety';
import { applyTextEdits } from './text-patch';

export interface GitHubCommitParams {
  owner: string;
  repo: string;
  branch: string;
  token: string;
  changes: FileChangeItem[];
  commitMessage?: string;
}

export interface GitHubCommitResponse {
  commitSha: string;
  url: string;
  branch: string;
}

export interface GitHubPRParams extends GitHubCommitParams {
  title?: string;
  body?: string;
  newBranch?: string;
}

export interface GitHubPRResponse {
  prNumber: number;
  url: string;
  branch: string;
  commitSha: string;
}

function getHeaders(token: string): Record<string, string> {
  return {
    Accept: 'application/vnd.github.v3+json',
    Authorization: `token ${token.trim()}`,
    'Content-Type': 'application/json',
  };
}

interface AtomicCommitResult {
  newCommitSha: string;
  baseCommitSha: string;
  /** Что реально записано в коммит (для точечных правок — результат применения к файлу из репозитория). */
  finalContents: Map<string, string>;
}

/** Текущее содержимое файла в базовом коммите (а не снимок, загруженный при привязке проекта). */
async function fetchFileAtCommit(
  baseUrl: string,
  token: string,
  path: string,
  commitSha: string,
): Promise<string> {
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  const res = await fetch(`${baseUrl}/contents/${encodedPath}?ref=${commitSha}`, {
    headers: { ...getHeaders(token), Accept: 'application/vnd.github.raw+json' },
  });
  if (!res.ok) {
    throw new Error(`Не удалось получить актуальный файл ${path} из репозитория (${res.status}). Изменения не отправлены.`);
  }
  return await res.text();
}

/**
 * Создаёт атомарный коммит через GitHub Git Data API (Blobs -> Tree -> Commit).
 */
async function createAtomicCommit(
  owner: string,
  repo: string,
  baseBranch: string,
  token: string,
  changes: FileChangeItem[],
  commitMessage: string,
): Promise<AtomicCommitResult> {
  // Пути проверяются ещё раз: модель — недоверенный источник, а коммит необратим для пользователя.
  for (const change of changes) {
    const checked = sanitizeChangePath(change.path);
    if (!checked.ok || checked.path !== change.path) {
      throw new Error(`Недопустимый путь «${change.path}»: ${checked.ok ? 'путь не нормализован' : checked.reason}`);
    }
  }

  const finalContents = new Map<string, string>();
  const headers = getHeaders(token);
  const baseUrl = `https://api.github.com/repos/${owner}/${repo}`;

  // 1. Получаем SHA текущего коммита ветки
  const refRes = await fetch(`${baseUrl}/git/ref/heads/${baseBranch}`, { headers });
  if (!refRes.ok) {
    if (refRes.status === 401) {
      throw new Error('Неверный токен GitHub или истёк срок его действия.');
    }
    if (refRes.status === 404) {
      throw new Error(`Ветка "${baseBranch}" или репозиторий "${owner}/${repo}" не найдены (проверьте права токена на запись).`);
    }
    throw new Error(`Ошибка получения ветки GitHub (${refRes.status}): ${refRes.statusText}`);
  }
  const refData = (await refRes.json()) as { object: { sha: string } };
  const baseCommitSha = refData.object.sha;

  // 2. Получаем дерево базового коммита
  const commitRes = await fetch(`${baseUrl}/git/commits/${baseCommitSha}`, { headers });
  if (!commitRes.ok) {
    throw new Error(`Ошибка получения коммита (${commitRes.status}): ${commitRes.statusText}`);
  }
  const commitData = (await commitRes.json()) as { tree: { sha: string } };
  const baseTreeSha = commitData.tree.sha;

  // 3. Создаем Blob'ы для каждого измененного/нового файла
  const treeEntries: Array<{
    path: string;
    mode: string;
    type: string;
    sha: string | null;
  }> = [];

  for (const change of changes) {
    if (change.action === 'delete') {
      treeEntries.push({
        path: change.path,
        mode: '100644',
        type: 'blob',
        sha: null, // sha: null в GitHub API означает удаление файла из дерева
      });
    } else {
      let content = change.modifiedContent ?? change.content ?? '';
      if (change.action === 'replace' && change.edits && change.edits.length > 0) {
        const fresh = await fetchFileAtCommit(baseUrl, token, change.path, baseCommitSha);
        const result = applyTextEdits(fresh, change.edits);
        if (!result.ok) {
          throw new Error(`${change.path}: ${result.reason}. Изменения не отправлены, файл в репозитории не тронут.`);
        }
        content = result.text;
      }
      finalContents.set(change.path, content);
      const blobRes = await fetch(`${baseUrl}/git/blobs`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          content,
          encoding: 'utf-8',
        }),
      });

      if (!blobRes.ok) {
        throw new Error(`Не удалось создать blob для ${change.path} (${blobRes.status})`);
      }
      const blobData = (await blobRes.json()) as { sha: string };

      treeEntries.push({
        path: change.path,
        mode: '100644',
        type: 'blob',
        sha: blobData.sha,
      });
    }
  }

  // 4. Создаем новое дерево
  const treeRes = await fetch(`${baseUrl}/git/trees`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      base_tree: baseTreeSha,
      tree: treeEntries,
    }),
  });

  if (!treeRes.ok) {
    throw new Error(`Не удалось создать Git-дерево (${treeRes.status}): ${treeRes.statusText}`);
  }
  const treeData = (await treeRes.json()) as { sha: string };
  const newTreeSha = treeData.sha;

  // 5. Создаем коммит
  const newCommitRes = await fetch(`${baseUrl}/git/commits`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      message: commitMessage,
      tree: newTreeSha,
      parents: [baseCommitSha],
    }),
  });

  if (!newCommitRes.ok) {
    throw new Error(`Не удалось зафиксировать коммит (${newCommitRes.status}): ${newCommitRes.statusText}`);
  }
  const newCommitData = (await newCommitRes.json()) as { sha: string };

  return {
    newCommitSha: newCommitData.sha,
    baseCommitSha,
    finalContents,
  };
}

/**
 * Создаёт прямой коммит в существующую ветку GitHub-репозитория.
 */
export async function commitDirectlyToGitHub(
  params: GitHubCommitParams,
): Promise<GitHubCommitResponse> {
  const { owner, repo, branch, token, changes } = params;
  const commitMessage = params.commitMessage || `Ketner AI: обновление ${changes.length} файлов`;

  const { newCommitSha, finalContents } = await createAtomicCommit(
    owner,
    repo,
    branch,
    token,
    changes,
    commitMessage,
  );

  const headers = getHeaders(token);
  const baseUrl = `https://api.github.com/repos/${owner}/${repo}`;

  // Обновляем ссылку ветки
  const updateRefRes = await fetch(`${baseUrl}/git/refs/heads/${branch}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({
      sha: newCommitSha,
      force: false,
    }),
  });

  if (!updateRefRes.ok) {
    throw new Error(`Не удалось обновить ветку ${branch} (${updateRefRes.status}): ${updateRefRes.statusText}`);
  }

  // Обновляем файлы в локальном сторе
  syncWorkspaceStore(changes, finalContents);

  return {
    commitSha: newCommitSha,
    url: `https://github.com/${owner}/${repo}/commit/${newCommitSha}`,
    branch,
  };
}

/**
 * Создаёт отдельную ветку и открывает Pull Request на GitHub.
 */
export async function createGitHubPullRequest(
  params: GitHubPRParams,
): Promise<GitHubPRResponse> {
  const { owner, repo, branch, token, changes } = params;
  const newBranch = params.newBranch || `ai-patch-${Date.now().toString(36)}`;
  const commitMessage = params.commitMessage || `Ketner AI: правки для ${changes.map((c) => c.path).join(', ')}`;
  const title = params.title || `Ketner AI: обновление ${changes.length} файлов`;
  const body =
    params.body ||
    `### Изменения от Ketner AI\n\nБыли внесены следующие изменения:\n` +
      changes
        .map((c) => `- **${c.action.toUpperCase()}** \`${c.path}\`${c.description ? `: ${c.description}` : ''}`)
        .join('\n') +
      `\n\n*Сгенерировано автоматически Ketner AI Gateway.*`;

  const { newCommitSha, finalContents } = await createAtomicCommit(
    owner,
    repo,
    branch,
    token,
    changes,
    commitMessage,
  );

  const headers = getHeaders(token);
  const baseUrl = `https://api.github.com/repos/${owner}/${repo}`;

  // 1. Создаём новую ветку
  const createRefRes = await fetch(`${baseUrl}/git/refs`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      ref: `refs/heads/${newBranch}`,
      sha: newCommitSha,
    }),
  });

  if (!createRefRes.ok) {
    throw new Error(`Не удалось создать ветку ${newBranch} (${createRefRes.status}): ${createRefRes.statusText}`);
  }

  // 2. Создаём Pull Request
  const prRes = await fetch(`${baseUrl}/pulls`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      title,
      head: newBranch,
      base: branch,
      body,
    }),
  });

  if (!prRes.ok) {
    throw new Error(`Не удалось открыть Pull Request (${prRes.status}): ${prRes.statusText}`);
  }
  const prData = (await prRes.json()) as { number: number; html_url: string };

  // Обновляем файлы в сторе
  syncWorkspaceStore(changes, finalContents);

  return {
    prNumber: prData.number,
    url: prData.html_url,
    branch: newBranch,
    commitSha: newCommitSha,
  };
}

function syncWorkspaceStore(changes: FileChangeItem[], finalContents: Map<string, string>): void {
  const updatedFiles: Array<{ path: string; content?: string }> = [];
  for (const change of changes) {
    if (change.action === 'delete') {
      useWorkspace.getState().removeWorkspaceFile(change.path);
    } else {
      updatedFiles.push({
        path: change.path,
        content: finalContents.get(change.path) ?? change.modifiedContent ?? change.content,
      });
    }
  }
  if (updatedFiles.length > 0) {
    useWorkspace.getState().updateWorkspaceFiles(updatedFiles);
  }
}
