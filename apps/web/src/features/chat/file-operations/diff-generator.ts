export interface DiffLine {
  type: 'add' | 'delete' | 'equal';
  text: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

export interface FileDiffResult {
  path: string;
  additions: number;
  deletions: number;
  lines: DiffLine[];
}

/**
 * Вычисляет построчный diff (Longest Common Subsequence) между старой и новой версиями файла.
 */
export function generateLineDiff(
  oldText = '',
  newText = '',
  filePath = '',
): FileDiffResult {
  const oldLines = oldText ? oldText.split('\n') : [];
  const newLines = newText ? newText.split('\n') : [];

  const n = oldLines.length;
  const m = newLines.length;

  // Ограничитель матрицы для сверхбольших файлов (> 2000 строк) для защиты от O(N*M) памяти
  if (n * m > 1_500_000) {
    // Упрощённый фоллбек diff для гигантских файлов
    const fallbackLines: DiffLine[] = [];
    let additions = 0;
    let deletions = 0;

    for (let i = 0; i < n; i++) {
      fallbackLines.push({
        type: 'delete',
        text: oldLines[i],
        oldLineNumber: i + 1,
      });
      deletions++;
    }
    for (let j = 0; j < m; j++) {
      fallbackLines.push({
        type: 'add',
        text: newLines[j],
        newLineNumber: j + 1,
      });
      additions++;
    }

    return { path: filePath, additions, deletions, lines: fallbackLines };
  }

  // Матрица длин LCS
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Восстановление диффа с обратным проходом
  const diff: DiffLine[] = [];
  let i = n;
  let j = m;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      diff.unshift({
        type: 'equal',
        text: oldLines[i - 1],
        oldLineNumber: i,
        newLineNumber: j,
      });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      diff.unshift({
        type: 'add',
        text: newLines[j - 1],
        newLineNumber: j,
      });
      j--;
    } else if (i > 0 && (j === 0 || dp[i][j - 1] < dp[i - 1][j])) {
      diff.unshift({
        type: 'delete',
        text: oldLines[i - 1],
        oldLineNumber: i,
      });
      i--;
    }
  }

  let additions = 0;
  let deletions = 0;
  for (const line of diff) {
    if (line.type === 'add') additions++;
    else if (line.type === 'delete') deletions++;
  }

  return {
    path: filePath,
    additions,
    deletions,
    lines: diff,
  };
}
